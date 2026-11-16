import { get as routeGet, post, str, htmlPage, redirect, HttpError } from '../web.js';
import {
  verifyPassword, createSession, destroySession, throttle, clearThrottle, sessionUser,
} from '../auth.js';
import { get, run, nowIso } from '../db.js';
import { esc, field, button, csrfField, flash } from '../ui.js';

function loginPage(ctx, { error = '', email = '', next = '' } = {}) {
  const body = `<div class="login-wrap">
  <div class="login-card">
    <div class="brand-mark">CO</div>
    <h1>Central de Orçamentos</h1>
    <p class="sub">Acesse com seu e-mail corporativo</p>
    ${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
    <form method="post" action="/login">
      ${csrfField(ctx)}
      <input type="hidden" name="next" value="${esc(next)}">
      ${field({ label: 'E-mail', name: 'email', type: 'email', value: email, required: true, placeholder: 'voce@empresa.com.br', autofocus: true })}
      ${field({ label: 'Senha', name: 'password', type: 'password', required: true, placeholder: '••••••••' })}
      ${button('Entrar', { kind: 'primary' })}
    </form>
    <p class="small muted" style="text-align:center;margin:18px 0 0">
      Primeiro acesso? Use o usuário administrador criado na instalação.
    </p>
  </div>
</div>`;
  return htmlPage(body, error ? 401 : 200);
}

export function registerAuthRoutes() {
  routeGet('/login', (ctx) => {
    if (ctx.user) return redirect('/');
    const next = ctx.url.searchParams.get('next') || '';
    return loginPage(ctx, { next });
  });

  post('/login', (ctx) => {
    const email = str(ctx.fields.email).trim().toLowerCase();
    const password = str(ctx.fields.password);
    const next = str(ctx.fields.next) || '/';

    const limited = throttle(`login:${ctx.ip}:${email}`);
    if (limited) return loginPage(ctx, { error: limited, email });

    const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      return loginPage(ctx, { error: 'E-mail ou senha inválidos.', email, next });
    }

    clearThrottle(`login:${ctx.ip}:${email}`);
    const session = createSession(user.id, ctx.req.headers['user-agent'] || '');
    ctx.setCookies.push({
      name: 'sid',
      value: session.token,
      maxAge: session.maxAge,
      httpOnly: true,
    });
    run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), user.id);
    return redirect(next.startsWith('/') ? next : '/');
  });

  post('/logout', (ctx) => {
    destroySession(ctx.cookies.sid);
    ctx.setCookies.push({ name: 'sid', value: '', maxAge: 0 });
    return redirect('/login');
  });

  routeGet('/trocar-senha', (ctx) => {
    const user = ctx.user;
    if (!user) return redirect('/login');
    return htmlPage(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/usuarios/${user.id}"></head><body></body></html>`);
  });
}
