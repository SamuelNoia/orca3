import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { get as routeGet, post, str, num, bool, htmlPage, redirect, HttpError, download } from '../web.js';
import {
  requireAdmin, requireUser, listUsers, getUser, countAdmins, createUser,
  hashPassword, passwordProblems,
} from '../auth.js';
import { get, run, all, setting, setSetting, nowIso, audit, db, openDb, closeDb, ftsDisponivel } from '../db.js';
import { DB_FILE, TMP_DIR } from '../config.js';
import { ownSupplier, saveSupplier } from '../repo.js';
import { layoutOptions } from '../layouts.js';
import {
  layout, esc, field, select, textarea, card, pageHeader, button, csrfField,
  badge, emptyState, flash, statusBadge, APP_VERSION, DB_NOME,
} from '../ui.js';

function render(ctx, title, body) {
  return htmlPage(layout(ctx, { title, body }));
}

function tamanhoBanco() {
  try {
    const b = fs.statSync(DB_FILE).size;
    return b >= 1024 * 1024
      ? `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB`
      : `${(b / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  } catch {
    return '—';
  }
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
        ${card('Empresa principal (padrão das novas propostas)', `
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
      </form>
      ${card('Backup do banco de dados', `
        <p class="small muted" style="margin-top:0">
          O banco é um arquivo único (<code>${esc(DB_FILE)}</code>). O download gera uma cópia
          consistente — inclusive com o que estiver em uso agora.
        </p>
        <dl class="summary" style="max-width:420px">
          <div class="row"><span>Tamanho atual</span><span>${tamanhoBanco()}</span></div>
          <div class="row"><span>Documentos guardados</span><span>${get('SELECT COUNT(*) AS n FROM quote_files')?.n || 0}</span></div>
        </dl>
        <div class="form-actions">
          ${button('Baixar backup do banco', { kind: 'primary', href: '/configuracoes/backup.db' })}
        </div>
        <p class="small muted">
          Guarde o arquivo fora do servidor (pen drive, nuvem). É o backup completo:
          clientes, fornecedores, produtos, orçamentos, usuários e arquivos guardados.
        </p>
      `)}
      ${card('Restaurar backup', `
        <p class="small muted" style="margin-top:0">
          Envie um arquivo <code>.db</code> gerado por esta plataforma. O banco atual é
          <strong>substituído</strong> — uma cópia dele é salva antes, em <code>data/backups/</code>.
        </p>
        <form method="post" action="/configuracoes/restaurar" enctype="multipart/form-data">
          ${csrfField(ctx)}
          <label class="field">
            <span>Arquivo de backup (.db) <b class="req">*</b></span>
            <input type="file" name="file" accept=".db,.sqlite,.sqlite3" required>
            <small>Você será desconectado e precisará entrar com um usuário do backup.</small>
          </label>
          <div class="form-actions">
            <button class="btn danger" type="submit"
                    data-confirm="Substituir o banco atual pelo backup enviado? Uma cópia do banco atual será guardada antes.">
              Restaurar backup
            </button>
          </div>
        </form>
      `)}
      ${card('Diagnóstico', `
        <dl class="summary" style="max-width:520px">
          <div class="row"><span>Versão do sistema</span><span>${esc(APP_VERSION)}</span></div>
          <div class="row"><span>Banco de dados</span><span>${esc(DB_NOME)} (${tamanhoBanco()})</span></div>
          <div class="row"><span>Busca em texto completo</span><span>${ftsDisponivel() ? 'índice ativo (FTS5)' : 'modo por termos (sem FTS5)'}</span></div>
          <div class="row"><span>Produtos ativos</span><span>${get('SELECT COUNT(*) AS n FROM products WHERE active = 1')?.n || 0}</span></div>
          <div class="row"><span>Produtos no índice</span><span>${ftsDisponivel() ? (get('SELECT COUNT(*) AS n FROM products_fts')?.n || 0) : '—'}</span></div>
        </dl>
        <p class="small muted" style="margin:14px 0 0">
          O índice é rebuildado sozinho quando a quantidade não confere com a tabela de produtos.
        </p>
      `)}`;
    return render(ctx, 'Configurações', `
      ${pageHeader({ title: 'Configurações', subtitle: 'Empresa principal, padrões de cálculo e identidade do sistema.' })}
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

  // ------------------------------------------------------------ backup
  routeGet('/configuracoes/backup.db', (ctx) => {
    requireAdmin(ctx);
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const tmp = path.join(TMP_DIR, `backup-${Date.now()}.db`);

    try {
      // VACUUM INTO gera uma copia consistente mesmo com o banco em uso
      db().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const buf = fs.readFileSync(tmp);
      audit(ctx.user.id, 'backup.download', 'settings', null, `${buf.length} bytes`);
      return download(`orcamentos-backup-${stamp}.db`, buf, 'application/x-sqlite3');
    } catch (err) {
      throw new HttpError(500, `Não foi possível gerar o backup: ${err.message}`);
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  });

  post('/configuracoes/restaurar', (ctx) => {
    const user = requireAdmin(ctx);
    const voltarErro = (msg) => redirect(`/configuracoes?err=${encodeURIComponent(msg)}`);

    const arquivo = (ctx.files || [])[0];
    if (!arquivo || !arquivo.data || !arquivo.data.length) {
      return voltarErro('Selecione o arquivo de backup (.db).');
    }

    const dados = arquivo.data;
    const assinatura = dados.subarray(0, 16).toString('latin1');
    if (!assinatura.startsWith('SQLite format 3')) {
      return voltarErro('O arquivo enviado não é um banco SQLite válido.');
    }

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const tmp = path.join(TMP_DIR, `restore-${Date.now()}.db`);
    fs.writeFileSync(tmp, dados);

    // confere se o arquivo tem as tabelas da plataforma
    let valido = false;
    try {
      const teste = new DatabaseSync(tmp, { readOnly: true });
      const tabelas = teste.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      teste.close();
      valido = ['users', 'quotes', 'products', 'clients', 'suppliers'].every((t) => tabelas.includes(t));
    } catch {
      valido = false;
    }

    if (!valido) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return voltarErro('Este arquivo não parece ser um backup da Central de Orçamentos.');
    }

    // guarda o banco atual antes de substituir
    const pastaBackups = path.join(path.dirname(DB_FILE), 'backups');
    fs.mkdirSync(pastaBackups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const anterior = path.join(pastaBackups, `antes-restauracao-${stamp}.db`);
    try {
      db().exec(`VACUUM INTO '${anterior.replace(/'/g, "''")}'`);
    } catch {
      try { fs.copyFileSync(DB_FILE, anterior); } catch { /* segue sem backup */ }
    }

    // troca o arquivo
    const antigo = `${DB_FILE}.substituido`;
    try {
      closeDb();
      try { if (fs.existsSync(antigo)) fs.unlinkSync(antigo); } catch { /* ignore */ }
      fs.renameSync(DB_FILE, antigo);
      fs.copyFileSync(tmp, DB_FILE);
      // os arquivos -wal/-shm pertenciam ao banco antigo
      for (const ext of ['-wal', '-shm']) {
        try { if (fs.existsSync(DB_FILE + ext)) fs.unlinkSync(DB_FILE + ext); } catch { /* ignore */ }
      }
      openDb(DB_FILE);
    } catch (err) {
      // tenta voltar ao banco anterior
      try {
        if (fs.existsSync(antigo)) {
          try { fs.unlinkSync(DB_FILE); } catch { /* ignore */ }
          fs.renameSync(antigo, DB_FILE);
        }
        openDb(DB_FILE);
      } catch { /* ignore */ }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return voltarErro(`Não foi possível restaurar: ${err.message}`);
    }

    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    try { fs.unlinkSync(antigo); } catch { /* ignore */ }

    try { audit(user.id, 'backup.restore', 'settings', null, arquivo.filename || 'backup.db'); } catch { /* ignore */ }

    // as sessões vieram do backup: precisa entrar de novo
    ctx.setCookies.push({ name: 'sid', value: '', maxAge: 0 });
    return redirect(`/login?msg=${encodeURIComponent('Backup restaurado. Entre com um usuário do arquivo restaurado.')}`);
  });
}
