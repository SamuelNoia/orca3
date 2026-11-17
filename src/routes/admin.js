import { get as routeGet, post, str, num, bool, htmlPage, redirect, HttpError } from '../web.js';
import {
  requireAdmin, requireUser, listUsers, getUser, countAdmins, createUser,
  hashPassword, passwordProblems,
} from '../auth.js';
import { get, run, all, setting, setSetting, nowIso, audit } from '../db.js';
import { ownSupplier, saveSupplier } from '../repo.js';
import { layoutOptions } from '../layouts.js';
import {
  layout, esc, field, select, textarea, card, pageHeader, button, csrfField,
  badge, emptyState, flash, statusBadge,
} from '../ui.js';

function render(ctx, title, body) {
  return htmlPage(layout(ctx, { title, body }));
}

function userForm(ctx, { user = null, values = {}, error = '' }) {
  const isNew = !user;
  const v = { ...(user || {}), ...values };
  const body = `
  ${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
  <form method="post" action="${isNew ? '/usuarios' : `/usuarios/${user.id}`}">
    ${csrfField(ctx)}
    <div class="form-grid">
      ${field({ label: 'Nome completo', name: 'name', value: v.name || '', required: true })}
      ${field({ label: 'E-mail', name: 'email', type: 'email', value: v.email || '', required: true })}
      ${field({ label: 'Telefone', name: 'phone', value: v.phone || '', placeholder: '(94) 99999-0000' })}
      ${select({
        label: 'Perfil de acesso',
        name: 'role',
        value: v.role || 'user',
        options: [{ value: 'user', label: 'Usuário — cria e edita orçamentos' }, { value: 'admin', label: 'Administrador — acesso total' }],
      })}
      ${isNew ? field({ label: 'Senha inicial', name: 'password', type: 'password', required: true, hint: 'Mínimo 8 caracteres, com letras e números.' }) : ''}
    </div>
    <div class="form-actions">
      ${button('Salvar', { kind: 'primary' })}
      ${button('Cancelar', { kind: 'ghost', href: '/usuarios' })}
    </div>
  </form>`;
  return render(ctx, isNew ? 'Novo usuário' : `Editar ${user.name}`, `
    ${pageHeader({ title: isNew ? 'Novo usuário' : 'Editar usuário', back: { href: '/usuarios', label: 'Usuários' } })}
    ${card(null, body)}
  `);
}

export function registerAdminRoutes() {
  routeGet('/usuarios', (ctx) => {
    requireAdmin(ctx);
    const users = listUsers();
    const rows = users.map((u) => `<tr>
      <td class="strong">${esc(u.name)}</td>
      <td>${esc(u.email)}</td>
      <td>${u.role === 'admin' ? badge('Administrador', 'info') : badge('Usuário')}</td>
      <td>${u.active ? badge('Ativo', 'ok') : badge('Inativo', 'bad')}</td>
      <td class="nowrap small muted">${u.last_login ? esc(new Date(u.last_login).toLocaleString('pt-BR')) : 'nunca'}</td>
      <td class="right nowrap">
        <a class="btn sm" href="/usuarios/${u.id}">Editar</a>
        ${u.id !== ctx.user.id ? `<form class="inline-form" method="post" action="/usuarios/${u.id}/status">
          ${csrfField(ctx)}<input type="hidden" name="active" value="${u.active ? 0 : 1}">
          <button class="btn sm">${u.active ? 'Desativar' : 'Ativar'}</button></form>` : ''}
        ${u.id !== ctx.user.id ? `<form class="inline-form" method="post" action="/usuarios/${u.id}/excluir" data-confirm="Excluir o usuário ${esc(u.name)}?">
          ${csrfField(ctx)}<button class="btn sm danger">Excluir</button></form>` : ''}
      </td>
    </tr>`).join('');

    const body = users.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
      : emptyState('Nenhum usuário cadastrado.');

    return render(ctx, 'Usuários', `
      ${pageHeader({
        title: 'Usuários',
        subtitle: 'Quem pode entrar na plataforma e o que pode fazer.',
        actions: button('Novo usuário', { href: '/usuarios/novo' }),
      })}
      ${card(null, body, { flush: true })}
    `);
  });

  routeGet('/usuarios/novo', (ctx) => {
    requireAdmin(ctx);
    return userForm(ctx, {});
  });

  post('/usuarios', (ctx) => {
    requireAdmin(ctx);
    const name = str(ctx.fields.name).trim();
    const email = str(ctx.fields.email).trim().toLowerCase();
    const password = str(ctx.fields.password);
    const role = str(ctx.fields.role) === 'admin' ? 'admin' : 'user';

    if (!name) return userForm(ctx, { values: ctx.fields, error: 'Informe o nome.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return userForm(ctx, { values: ctx.fields, error: 'E-mail inválido.' });
    const pwdError = passwordProblems(password);
    if (pwdError) return userForm(ctx, { values: ctx.fields, error: pwdError });

    try {
      const id = createUser({ name, email, password, role, phone: str(ctx.fields.phone) });
      audit(ctx.user.id, 'user.create', 'users', id, email);
      return redirect(`/usuarios?msg=${encodeURIComponent('Usuário criado com sucesso.')}`);
    } catch (err) {
      return userForm(ctx, { values: ctx.fields, error: err.message });
    }
  });

  routeGet('/usuarios/:id', (ctx) => {
    requireAdmin(ctx);
    const user = getUser(Number(ctx.params.id));
    if (!user) throw new HttpError(404, 'Usuário não encontrado.');
    const body = `
      ${card('Dados', `
        <form method="post" action="/usuarios/${user.id}">
          ${csrfField(ctx)}
          <div class="form-grid">
            ${field({ label: 'Nome completo', name: 'name', value: user.name, required: true })}
            ${field({ label: 'E-mail', name: 'email', type: 'email', value: user.email, required: true })}
            ${field({ label: 'Telefone', name: 'phone', value: user.phone || '' })}
            ${select({ label: 'Perfil', name: 'role', value: user.role, options: [{ value: 'user', label: 'Usuário' }, { value: 'admin', label: 'Administrador' }] })}
          </div>
          <div class="form-actions">${button('Salvar alterações', { kind: 'primary' })}</div>
        </form>
      `)}
      ${card('Redefinir senha', `
        <form method="post" action="/usuarios/${user.id}/senha">
          ${csrfField(ctx)}
          <div class="form-grid">
            ${field({ label: 'Nova senha', name: 'password', type: 'password', required: true, hint: 'Mínimo 8 caracteres, com letras e números.' })}
            ${field({ label: 'Repita a nova senha', name: 'password2', type: 'password', required: true })}
          </div>
          <div class="form-actions">${button('Redefinir senha', { kind: 'soft' })}</div>
        </form>
      `)}
      ${card('Histórico de acesso', `
        <p class="small muted">Criado em ${esc(new Date(user.created_at).toLocaleString('pt-BR'))} · Último acesso: ${user.last_login ? esc(new Date(user.last_login).toLocaleString('pt-BR')) : 'nunca'}</p>
      `)}
    `;
    return render(ctx, user.name, `
      ${pageHeader({ title: user.name, subtitle: user.email, back: { href: '/usuarios', label: 'Usuários' } })}
      ${flash(ctx)}
      ${body}
    `);
  });

  post('/usuarios/:id', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const user = getUser(id);
    if (!user) throw new HttpError(404, 'Usuário não encontrado.');

    const name = str(ctx.fields.name).trim();
    const email = str(ctx.fields.email).trim().toLowerCase();
    const role = str(ctx.fields.role) === 'admin' ? 'admin' : 'user';

    if (role !== 'admin' && user.role === 'admin' && countAdmins(id) === 0) {
      return redirect(`/usuarios/${id}?err=${encodeURIComponent('É preciso manter pelo menos um administrador ativo.')}`);
    }
    run(
      'UPDATE users SET name=?, email=?, phone=?, role=?, password_hash=password_hash WHERE id=?',
      name, email, str(ctx.fields.phone) || null, role, id,
    );
    audit(ctx.user.id, 'user.update', 'users', id, email);
    return redirect(`/usuarios/${id}?msg=${encodeURIComponent('Dados atualizados.')}`);
  });

  post('/usuarios/:id/senha', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const password = str(ctx.fields.password);
    const password2 = str(ctx.fields.password2);
    if (password !== password2) {
      return redirect(`/usuarios/${id}?err=${encodeURIComponent('As senhas não conferem.')}`);
    }
    const problem = passwordProblems(password);
    if (problem) return redirect(`/usuarios/${id}?err=${encodeURIComponent(problem)}`);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
    audit(ctx.user.id, 'user.password', 'users', id, null);
    return redirect(`/usuarios/${id}?msg=${encodeURIComponent('Senha redefinida.')}`);
  });

  post('/usuarios/:id/status', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) return redirect(`/usuarios?err=${encodeURIComponent('Você não pode desativar o próprio acesso.')}`);
    const active = bool(ctx.fields.active) || str(ctx.fields.active) === '1' ? 1 : 0;
    if (!active) {
      const user = getUser(id);
      if (user?.role === 'admin' && countAdmins(id) === 0) {
        return redirect(`/usuarios?err=${encodeURIComponent('É preciso manter pelo menos um administrador ativo.')}`);
      }
    }
    run('UPDATE users SET active = ? WHERE id = ?', active, id);
    audit(ctx.user.id, 'user.status', 'users', id, String(active));
    return redirect(`/usuarios?msg=${encodeURIComponent(active ? 'Usuário ativado.' : 'Usuário desativado.')}`);
  });

  post('/usuarios/:id/excluir', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) return redirect(`/usuarios?err=${encodeURIComponent('Você não pode excluir o próprio usuário.')}`);
    const user = getUser(id);
    if (user?.role === 'admin' && countAdmins(id) === 0) {
      return redirect(`/usuarios?err=${encodeURIComponent('É preciso manter pelo menos um administrador ativo.')}`);
    }
    run('DELETE FROM users WHERE id = ?', id);
    audit(ctx.user.id, 'user.delete', 'users', id, user?.email || null);
    return redirect(`/usuarios?msg=${encodeURIComponent('Usuário excluído.')}`);
  });

  // ------------------------------------------------------------ configuracoes
  routeGet('/configuracoes', (ctx) => {
    requireAdmin(ctx);
    const company = ownSupplier() || {};
    const body = `
      <form method="post" action="/configuracoes">
        ${csrfField(ctx)}
        ${card('Identificação do sistema', `
          <div class="form-grid">
            ${field({ label: 'Nome exibido no sistema', name: 'app_name', value: setting('app_name'), required: true })}
          </div>
        `)}
        ${card('Empresa emitente (dados que aparecem na proposta)', `
          <div class="form-grid">
            ${field({ label: 'Razão social', name: 'legal_name', value: company.legal_name || '', required: true })}
            ${field({ label: 'Nome fantasia', name: 'name', value: company.name || '', required: true })}
            ${field({ label: 'CNPJ', name: 'cnpj', value: company.cnpj || '' })}
            ${field({ label: 'Inscrição estadual', name: 'ie', value: company.ie || '' })}
            ${field({ label: 'Endereço', name: 'address', value: company.address || '', className: 'span2' })}
            ${field({ label: 'Contato (telefone / e-mail)', name: 'contact', value: company.contact || '' })}
            ${field({ label: 'E-mail', name: 'email', type: 'email', value: company.email || '' })}
            ${textarea({ label: 'Dados bancários', name: 'bank_info', value: company.bank_info || '', rows: 4, hint: 'Uma linha por informação. Aparece no rodapé da proposta.' })}
            ${select({
              label: 'Layout do orçamento',
              name: 'layout',
              value: company.layout || 'classico',
              options: layoutOptions(),
              hint: 'Modelo visual da planilha/PDF desta empresa.',
            })}
          </div>
        `)}
        ${card('Padrões dos novos orçamentos', `
          <div class="form-grid three">
            ${field({ label: 'Margem sobre o custo (%)', name: 'default_margin_pct', type: 'number', step: '0.01', value: setting('default_margin_pct'), hint: 'Ex.: 60 para vender com 60% acima do custo.' })}
            ${select({ label: 'Forma de cálculo', name: 'default_margin_mode', value: setting('default_margin_mode'), options: [{ value: 'markup', label: 'Acréscimo sobre o custo (markup)' }, { value: 'margin', label: 'Margem sobre o preço de venda' }] })}
            ${field({ label: 'Serviço de instalação (%)', name: 'default_service_pct', type: 'number', step: '0.01', value: setting('default_service_pct') })}
            ${field({ label: 'Validade da proposta (dias)', name: 'default_valid_days', type: 'number', value: setting('default_valid_days') })}
          </div>
        `)}
        <div class="form-actions">${button('Salvar configurações', { kind: 'primary' })}</div>
      </form>`;
    return render(ctx, 'Configurações', `
      ${pageHeader({ title: 'Configurações', subtitle: 'Empresa emitente, padrões de cálculo e identidade do sistema.' })}
      ${flash(ctx)}
      ${body}
    `);
  });

  post('/configuracoes', (ctx) => {
    requireAdmin(ctx);
    const company = ownSupplier();
    setSetting('app_name', str(ctx.fields.app_name) || 'Central de Orçamentos');
    setSetting('default_margin_pct', String(num(ctx.fields.default_margin_pct, 60)));
    setSetting('default_margin_mode', str(ctx.fields.default_margin_mode) === 'margin' ? 'margin' : 'markup');
    setSetting('default_service_pct', String(num(ctx.fields.default_service_pct, 0)));
    setSetting('default_valid_days', String(num(ctx.fields.default_valid_days, 15)));

    saveSupplier(company?.id || null, {
      name: str(ctx.fields.name) || str(ctx.fields.legal_name) || 'Empresa',
      legal_name: str(ctx.fields.legal_name),
      cnpj: str(ctx.fields.cnpj),
      ie: str(ctx.fields.ie),
      address: str(ctx.fields.address),
      contact: str(ctx.fields.contact),
      email: str(ctx.fields.email),
      phone: company?.phone || '',
      bank_info: str(ctx.fields.bank_info),
      layout: str(ctx.fields.layout) || company?.layout || 'classico',
      is_own: 1,
      active: 1,
    });
    audit(ctx.user.id, 'settings.update', 'settings', null, null);
    return redirect(`/configuracoes?msg=${encodeURIComponent('Configurações salvas.')}`);
  });
}
