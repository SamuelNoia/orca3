// Servidor da Central de Orcamentos. Sem dependencias externas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, DB_FILE, PUBLIC_DIR, PORT, HOST, TMP_DIR } from './src/config.js';
import { openDb, get, run, nowIso, setting } from './src/db.js';
import { hashPassword, sessionUser, purgeExpiredSessions, checkCsrf } from './src/auth.js';
import { matchRoute, parseCookies, parseBody, sendResponse, serveStatic, HttpError } from './src/web.js';
import { registerRoutes } from './src/routes/index.js';
import { layout, esc, button } from './src/ui.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

openDb(DB_FILE);
bootstrapAdmin();
cleanTmp();
registerRoutes();

function bootstrapAdmin() {
  const count = Number(get('SELECT COUNT(*) AS n FROM users')?.n || 0);
  if (count > 0) return;

  const email = process.env.ADMIN_EMAIL || 'admin@empresa.local';
  // sem senha definida, gera uma aleatoria por instalacao (nunca uma senha fixa)
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');

  run(
    'INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?,?,?,?,1,?)',
    'Administrador', email, hashPassword(password), 'admin', nowIso(),
  );

  const arquivo = path.join(DATA_DIR, 'PRIMEIRO_ACESSO.txt');
  const note = [
    'Primeiro acesso criado',
    '',
    `E-mail: ${email}`,
    `Senha:  ${password}`,
    '',
    'Troque a senha em Usuarios > Administrador apos entrar.',
    'Apague este arquivo depois de guardar a senha.',
    '',
  ].join('\n');

  try { fs.writeFileSync(arquivo, note, 'utf8'); } catch { /* ignore */ }

  console.log('\n' + '='.repeat(64));
  console.log('  PRIMEIRO ACESSO CRIADO');
  console.log(`  E-mail: ${email}`);
  console.log(`  Senha:  ${password}`);
  console.log(`  Tambem salvo em: ${arquivo}`);
  console.log('  Troque a senha apos o primeiro login.');
  console.log('='.repeat(64) + '\n');
}

function cleanTmp() {
  try {
    const cutoff = Date.now() - 6 * 3600 * 1000;
    for (const f of fs.readdirSync(TMP_DIR)) {
      const p = path.join(TMP_DIR, f);
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch { /* ignore */ }
}

function errorPage(ctx, status, message) {
  const friendly = {
    400: 'Requisição inválida',
    401: 'Acesso não autorizado',
    403: 'Acesso negado',
    404: 'Página não encontrada',
    413: 'Arquivo muito grande',
    500: 'Erro interno',
  }[status] || 'Erro';

  const body = `
    <div class="card"><div class="card-body" style="text-align:center;padding:48px 24px">
      <h1 style="font-size:20px;margin:0 0 8px">${esc(friendly)}</h1>
      <p class="muted" style="margin:0 0 22px">${esc(message)}</p>
      ${button('Voltar ao painel', { kind: 'primary', href: '/' })}
    </div></div>`;

  const html = layout(ctx, { title: friendly, body });
  return { type: 'html', body: html, status };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];

  const ctx = {
    req,
    res,
    url,
    method: req.method,
    params: {},
    cookies,
    setCookies,
    fields: {},
    files: [],
    user: null,
    ip: (req.socket.remoteAddress || '').replace('::ffff:', '') || 'local',
  };

  try {
    ctx.user = sessionUser(cookies.sid);

    // estaticos
    if (req.method === 'GET' || req.method === 'HEAD') {
      const staticFile = serveStatic(PUBLIC_DIR, url.pathname);
      if (staticFile) {
        res.writeHead(200, {
          'Content-Type': staticFile.contentType,
          'Content-Length': staticFile.buffer.length,
          'Cache-Control': 'public, max-age=300',
        }).end(staticFile.buffer);
        return;
      }
    }

    const matched = matchRoute(req.method, url.pathname);
    if (!matched) {
      throw new HttpError(404, 'O endereço acessado não existe.');
    }
    ctx.params = matched.params;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const body = await parseBody(req);
      ctx.fields = body.fields || {};
      ctx.files = body.files || [];
      checkCsrf(ctx);
    }

    const result = await matched.handler(ctx);

    const cookiesOut = setCookies.map((c) => {
      const parts = [`${c.name}=${encodeURIComponent(c.value ?? '')}`, `Path=${c.path || '/'}`];
      if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`);
      if (c.httpOnly !== false) parts.push('HttpOnly');
      parts.push('SameSite=Lax');
      return parts.join('; ');
    });
    if (cookiesOut.length) res.setHeader('Set-Cookie', cookiesOut);

    sendResponse(res, result);
    if (url.pathname !== '/app.css' && url.pathname !== '/app.js') {
      const dur = Date.now() - started;
      if (dur > 700) console.log(`  [lento ${dur}ms] ${req.method} ${url.pathname}`);
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;

    if (status === 401 && String(err.message).startsWith('login:')) {
      const next = String(err.message).slice(6);
      res.writeHead(303, { Location: `/login?next=${next}` }).end();
      return;
    }

    if (!(err instanceof HttpError)) {
      console.error(`ERRO ${req.method} ${url.pathname}:`, err?.stack || err);
    }

    if (setCookies.length) {
      res.setHeader('Set-Cookie', setCookies.map((c) => `${c.name}=${encodeURIComponent(c.value ?? '')}; Path=/; Max-Age=${c.maxAge ?? 0}`));
    }
    try {
      sendResponse(res, errorPage(ctx, status, err.message || 'Erro inesperado.'));
    } catch {
      res.writeHead(500).end('Erro interno');
    }
  }
});

setInterval(() => {
  try { purgeExpiredSessions(); } catch { /* ignore */ }
}, 60 * 60 * 1000);

server.listen(PORT, HOST, () => {
  const name = setting('app_name', 'Central de Orcamentos');
  console.log('='.repeat(58));
  console.log(`  ${name}`);
  console.log(`  Rodando em:  http://${HOST}:${PORT}`);
  console.log(`  Banco:       ${DB_FILE}`);
  console.log('  Para encerrar: Ctrl+C');
  console.log('='.repeat(58));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nEncerrando...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} ja esta em uso. Rode com outra porta:\n  set PORT=3001 && node server.js\n`);
    process.exit(1);
  }
  throw err;
});
