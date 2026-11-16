// Componentes de interface: layout, formularios e tabelas.
import { csrfToken } from './auth.js';
import { fmtMoney, fmtQty } from './calc.js';
import { setting } from './db.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export { fmtMoney, fmtQty };

const ICONS = {
  painel: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10',
  orcamento: 'M9 3h6l1 2h3v16H5V5h3l1-2zM9 11h6M9 15h6',
  cliente: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-3.3 3.6-6 8-6s8 2.7 8 6',
  fornecedor: 'M3 9l3-6h12l3 6M4 9h16v11H4zM9 20v-6h6v6',
  produto: 'M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8',
  projeto: 'M3 7h6l2 2h10v11H3zM3 7V5h5l2 2',
  usuario: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 21c0-3 3.1-5 7-5s7 2 7 5',
  config: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 2h-4l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z',
  sair: 'M15 17l5-5-5-5M20 12H9M12 3H5v18h7',
};

function icon(name) {
  const d = ICONS[name];
  if (!d) return '';
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

const NAV = [
  { href: '/', label: 'Painel', icon: 'painel', match: (p) => p === '/' },
  { href: '/orcamentos', label: 'Orçamentos', icon: 'orcamento', match: (p) => p.startsWith('/orcamentos') },
  { href: '/projetos', label: 'Projetos', icon: 'projeto', match: (p) => p.startsWith('/projetos') },
  { href: '/clientes', label: 'Clientes', icon: 'cliente', match: (p) => p.startsWith('/clientes') },
  { href: '/fornecedores', label: 'Fornecedores', icon: 'fornecedor', match: (p) => p.startsWith('/fornecedores') },
  { href: '/produtos', label: 'Produtos', icon: 'produto', match: (p) => p.startsWith('/produtos') },
  { href: '/usuarios', label: 'Usuários', icon: 'usuario', adminOnly: true, match: (p) => p.startsWith('/usuarios') },
  { href: '/configuracoes', label: 'Configurações', icon: 'config', adminOnly: true, match: (p) => p.startsWith('/configuracoes') },
];

export function layout(ctx, { title, body, wide = false, bare = false }) {
  const user = ctx.user;
  const path = ctx.url.pathname;
  const appName = setting('app_name', 'Central de Orçamentos');
  const nav = NAV
    .filter((n) => !n.adminOnly || user?.role === 'admin')
    .map((n) => `<a href="${n.href}" class="nav-item${n.match(path) ? ' active' : ''}">${icon(n.icon)}<span>${esc(n.label)}</span></a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(appName)}</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5' fill='%231F4E78'/><path d='M6 18V9h3v9zM11 18V6h3v12zM16 18v-5h3v5z' fill='white'/></svg>">
</head>
<body class="${wide ? 'wide' : ''}">
${bare ? '' : `<aside class="sidebar">
  <div class="brand">
    <div class="brand-mark">CO</div>
    <div class="brand-text"><strong>${esc(appName)}</strong><small>Painel de gestão</small></div>
  </div>
  <nav>${nav}</nav>
  <div class="sidebar-foot">
    <div class="who"><strong>${esc(user?.name || '')}</strong><small>${esc(user?.role === 'admin' ? 'Administrador' : 'Usuário')}</small></div>
    <form method="post" action="/logout">${csrfField(ctx)}<button class="link" title="Sair">${icon('sair')}</button></form>
  </div>
</aside>`}
<main class="content">
${flash(ctx)}
${body}
</main>
<script src="/app.js"></script>
</body>
</html>`;
}

export function flash(ctx) {
  const msg = ctx.url.searchParams.get('msg');
  const err = ctx.url.searchParams.get('err');
  if (!msg && !err) return '';
  return `<div class="flash-wrap">${msg ? `<div class="flash ok">${esc(msg)}</div>` : ''}${err ? `<div class="flash bad">${esc(err)}</div>` : ''}</div>`;
}

export function pageHeader({ title, subtitle, actions = '', back = null }) {
  return `<header class="page-head">
  <div>
    ${back ? `<a class="back" href="${esc(back.href)}">← ${esc(back.label)}</a>` : ''}
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p class="sub">${subtitle}</p>` : ''}
  </div>
  ${actions ? `<div class="actions">${actions}</div>` : ''}
</header>`;
}

export function card(title, body, opts = {}) {
  return `<section class="card${opts.className ? ` ${opts.className}` : ''}">
  ${title ? `<div class="card-head"><h2>${esc(title)}</h2>${opts.aside || ''}</div>` : ''}
  <div class="card-body${opts.flush ? ' flush' : ''}">${body}</div>
</section>`;
}

export function field({ label, name, value = '', type = 'text', required = false, placeholder = '', hint = '', step = null, min = null, max = null, className = '', autofocus = false }) {
  return `<label class="field ${className}">
  <span>${esc(label)}${required ? ' <b class="req">*</b>' : ''}</span>
  <input type="${type}" name="${esc(name)}" value="${esc(value)}"${required ? ' required' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${step !== null ? ` step="${step}"` : ''}${min !== null ? ` min="${min}"` : ''}${max !== null ? ` max="${max}"` : ''}${autofocus ? ' autofocus' : ''}>
  ${hint ? `<small>${hint}</small>` : ''}
</label>`;
}

export function textarea({ label, name, value = '', rows = 3, hint = '', placeholder = '' }) {
  return `<label class="field">
  <span>${esc(label)}</span>
  <textarea name="${esc(name)}" rows="${rows}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(value)}</textarea>
  ${hint ? `<small>${hint}</small>` : ''}
</label>`;
}

export function select({ label, name, value, options, hint = '', required = false }) {
  const opts = options.map((o) => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('');
  return `<label class="field">
  <span>${esc(label)}${required ? ' <b class="req">*</b>' : ''}</span>
  <select name="${esc(name)}"${required ? ' required' : ''}>${opts}</select>
  ${hint ? `<small>${hint}</small>` : ''}
</label>`;
}

export function csrfField(ctx) {
  return `<input type="hidden" name="_csrf" value="${esc(csrfToken(ctx))}">`;
}

export function badge(text, kind = 'neutral') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

const STATUS = {
  draft: { label: 'Rascunho', kind: 'neutral' },
  sent: { label: 'Enviado', kind: 'info' },
  approved: { label: 'Aprovado', kind: 'ok' },
  rejected: { label: 'Recusado', kind: 'bad' },
};

export function statusBadge(status) {
  const s = STATUS[status] || STATUS.draft;
  return badge(s.label, s.kind);
}

export function emptyState(text, action = '') {
  return `<div class="empty"><p>${esc(text)}</p>${action}</div>`;
}

const BUTTONS = {
  primary: 'btn primary',
  ghost: 'btn',
  danger: 'btn danger',
  soft: 'btn soft',
};

export function button(label, { kind = 'primary', type = 'submit', href = null, icon: ico = null, small = false, attrs = '' } = {}) {
  const cls = `${BUTTONS[kind] || BUTTONS.ghost}${small ? ' sm' : ''}`;
  if (href) return `<a class="${cls}" href="${esc(href)}">${ico ? icon(ico) : ''}${esc(label)}</a>`;
  return `<button class="${cls}" type="${type}" ${attrs}>${ico ? icon(ico) : ''}${esc(label)}</button>`;
}

export function form(method, action, body, opts = {}) {
  return `<form method="${method}" action="${esc(action)}"${opts.multipart ? ' enctype="multipart/form-data"' : ''}${opts.className ? ` class="${opts.className}"` : ''}>${body}</form>`;
}
