// Autenticacao: senhas com scrypt, sessoes persistidas, CSRF e controle de acesso.
import crypto from 'node:crypto';
import { all, get, run, nowIso } from './db.js';
import { HttpError, randomToken } from './web.js';

const SESSION_DAYS = 7;
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(String(password), salt, KEYLEN);
    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== test.length) return false;
    return crypto.timingSafeEqual(test, expected);
  } catch {
    return false;
  }
}

export function passwordProblems(password) {
  const p = String(password || '');
  if (p.length < 8) return 'A senha deve ter no minimo 8 caracteres.';
  if (!/[a-zA-Z]/.test(p)) return 'A senha deve conter ao menos uma letra.';
  if (!/[0-9]/.test(p)) return 'A senha deve conter ao menos um numero.';
  return null;
}

// ---------------------------------------------------------------- sessoes
export function createSession(userId, userAgent = '') {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000);
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)',
    token, userId, now.toISOString(), expires.toISOString(), String(userAgent).slice(0, 200),
  );
  return { token, expires, maxAge: SESSION_DAYS * 24 * 3600 };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

export function sessionUser(token) {
  if (!token) return null;
  const row = get(
    `SELECT s.token, s.expires_at, u.id, u.name, u.email, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token,
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  if (!row.active) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
}

// ---------------------------------------------------------------- guardas
export function requireUser(ctx) {
  if (!ctx.user) {
    const next = encodeURIComponent(ctx.url.pathname + (ctx.url.search || ''));
    throw new HttpError(401, `login:${next}`);
  }
  return ctx.user;
}

export function requireAdmin(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'admin') throw new HttpError(403, 'Acesso restrito a administradores.');
  return user;
}

// ---------------------------------------------------------------- CSRF
export function csrfToken(ctx) {
  let token = ctx.cookies.csrf;
  if (!token || token.length < 20) {
    token = randomToken(24);
    ctx.setCookies.push({ name: 'csrf', value: token, maxAge: 60 * 60 * 24 * 30 });
  }
  return token;
}

export function checkCsrf(ctx) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) return;
  const sent = String(ctx.fields._csrf || '');
  const cookie = String(ctx.cookies.csrf || '');
  if (!sent || !cookie) throw new HttpError(400, 'Sessao expirada. Recarregue a pagina e tente novamente.');
  const a = Buffer.from(sent);
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(400, 'Token de seguranca invalido. Recarregue a pagina.');
  }
}

// ---------------------------------------------------------------- usuarios
export function listUsers() {
  return all('SELECT * FROM users ORDER BY name COLLATE NOCASE');
}

export function getUser(id) {
  return get('SELECT * FROM users WHERE id = ?', id);
}

export function countAdmins(excludeId = 0) {
  const row = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", excludeId);
  return Number(row?.n || 0);
}

export function createUser({ name, email, password, role = 'user', phone = '' }) {
  const exists = get('SELECT id FROM users WHERE lower(email) = lower(?)', email);
  if (exists) throw new HttpError(400, 'Ja existe um usuario com este e-mail.');
  const r = run(
    'INSERT INTO users (name, email, password_hash, role, active, phone, created_at) VALUES (?,?,?,?,1,?,?)',
    name.trim(), email.trim().toLowerCase(), hashPassword(password), role === 'admin' ? 'admin' : 'user',
    phone || null, nowIso(),
  );
  return r.lastId;
}

// ---------------------------------------------------------------- rate limit
const attempts = new Map();

export function throttle(key, max = 8, windowMs = 5 * 60 * 1000) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start > windowMs) {
    attempts.set(key, { start: now, count: 1 });
    return null;
  }
  entry.count += 1;
  if (entry.count > max) {
    const wait = Math.ceil((windowMs - (now - entry.start)) / 1000);
    return `Muitas tentativas. Tente novamente em ${Math.ceil(wait / 60)} minuto(s).`;
  }
  return null;
}

export function clearThrottle(key) {
  attempts.delete(key);
}
