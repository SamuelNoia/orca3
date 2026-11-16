// Camada HTTP: roteador, cookies, corpo de formulario, multipart e estaticos.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- roteador
const ROUTES = [];

function compile(pattern) {
  const keys = [];
  const src = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })
    .replace(/\*/g, '(.*)');
  return { regex: new RegExp(`^${src}/?$`), keys };
}

export function route(method, pattern, handler) {
  const { regex, keys } = compile(pattern);
  ROUTES.push({ method, pattern, regex, keys, handler });
}

export const get = (p, h) => route('GET', p, h);
export const post = (p, h) => route('POST', p, h);

export function matchRoute(method, pathname) {
  const want = method === 'HEAD' ? 'GET' : method;
  for (const r of ROUTES) {
    if (r.method !== want) continue;
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] ?? ''); });
    return { handler: r.handler, params };
  }
  return null;
}

// ---------------------------------------------------------------- cookies
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(idx + 1).trim()); } catch { out[k] = ''; }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value ?? '')}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  return parts.join('; ');
}

// ---------------------------------------------------------------- corpo
export function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Arquivo maior que o limite permitido (40 MB).'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseUrlEncoded(buffer) {
  const fields = {};
  const text = buffer.toString('utf8');
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = decodeURIComponent((idx < 0 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
    const v = idx < 0 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    if (fields[k] === undefined) fields[k] = v;
    else if (Array.isArray(fields[k])) fields[k].push(v);
    else fields[k] = [fields[k], v];
  }
  return { fields, files: [] };
}

export function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = buffer.indexOf(delim);
  if (pos < 0) return { fields, files };

  for (;;) {
    pos += delim.length;
    if (buffer.slice(pos, pos + 2).toString() === '--') break;
    if (buffer.slice(pos, pos + 2).toString() === '\r\n') pos += 2;

    const next = buffer.indexOf(delim, pos);
    if (next < 0) break;
    const partBuf = buffer.slice(pos, next - 2);

    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd < 0) { pos = next; continue; }

    const rawHeaders = partBuf.slice(0, headerEnd).toString('utf8');
    const content = partBuf.slice(headerEnd + 4);

    const nameM = /name="([^"]*)"/i.exec(rawHeaders);
    const fileM = /filename="([^"]*)"/i.exec(rawHeaders);
    const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders);
    const name = nameM ? nameM[1] : '';

    if (fileM) {
      if (fileM[1]) {
        files.push({
          field: name,
          filename: fileM[1],
          contentType: typeM ? typeM[1].trim() : 'application/octet-stream',
          data: content,
          size: content.length,
        });
      }
    } else if (name) {
      const value = content.toString('utf8');
      if (fields[name] === undefined) fields[name] = value;
      else if (Array.isArray(fields[name])) fields[name].push(value);
      else fields[name] = [fields[name], value];
    }
    pos = next;
  }
  return { fields, files };
}

export async function parseBody(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct) return { fields: {}, files: [] };
  if (ct.includes('application/json')) {
    const buf = await readBody(req);
    try { return { fields: JSON.parse(buf.toString('utf8') || '{}'), files: [] }; } catch { return { fields: {}, files: [] }; }
  }
  const buf = await readBody(req);
  if (ct.includes('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    const boundary = m ? (m[1] || m[2]).trim() : '';
    if (!boundary) throw new HttpError(400, 'Requisicao multipart sem boundary.');
    return parseMultipart(buf, boundary);
  }
  return parseUrlEncoded(buf);
}

// ---------------------------------------------------------------- respostas
export function htmlPage(body, status = 200) {
  return { type: 'html', body, status };
}

export function redirect(location) {
  return { type: 'redirect', location };
}

export function json(data, status = 200) {
  return { type: 'json', data, status };
}

export function download(filename, buffer, contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  return { type: 'file', filename, buffer, contentType };
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function sendResponse(res, result) {
  if (!result) {
    res.writeHead(204).end();
    return;
  }
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
  };

  if (result.type === 'redirect') {
    res.writeHead(303, { ...headers, Location: result.location }).end();
    return;
  }
  if (result.type === 'json') {
    const body = JSON.stringify(result.data);
    res.writeHead(result.status || 200, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    }).end(body);
    return;
  }
  if (result.type === 'file') {
    res.writeHead(200, {
      ...headers,
      'Content-Type': result.contentType,
      'Content-Length': result.buffer.length,
      'Content-Disposition': contentDisposition(result.filename),
      'Cache-Control': 'no-store',
    }).end(result.buffer);
    return;
  }
  const body = Buffer.from(result.body ?? '', 'utf8');
  res.writeHead(result.status || 200, {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }).end(body);
}

export function serveStatic(publicDir, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  if (rel.includes('..')) return null;
  const file = path.join(publicDir, rel);
  if (!file.startsWith(path.resolve(publicDir))) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const ext = path.extname(file).toLowerCase();
  return {
    type: 'file',
    filename: path.basename(file),
    buffer: fs.readFileSync(file),
    contentType: MIME[ext] || 'application/octet-stream',
  };
}

// ---------------------------------------------------------------- utilidades
export function uuid() {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Aceita string ou array do formulario. */
export function str(value, fallback = '') {
  if (Array.isArray(value)) return str(value[value.length - 1], fallback);
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function num(value, fallback = 0) {
  const s = str(value).trim().replace(/\s/g, '');
  if (!s) return fallback;
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalizado.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function bool(value) {
  const s = str(value).toLowerCase();
  return s === '1' || s === 'on' || s === 'true' || s === 'sim';
}
