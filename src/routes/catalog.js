import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get as routeGet, post, str, num, bool, htmlPage, redirect, HttpError, download } from '../web.js';
import { requireUser } from '../auth.js';
import { get, run, all, tx, nowIso, audit } from '../db.js';
import { TMP_DIR } from '../config.js';
import { buildModeloXlsx, buildModeloCsv } from '../modelo.js';
import { layoutOptions, layoutInfo, layoutExampleLinks, LAYOUTS } from '../layouts.js';
import {
  listClients, getClient, listSuppliers, getSupplier, saveSupplier,
  searchProducts, countProducts, getProduct,
} from '../repo.js';
import {
  FIELDS, detectMapping, extractRecords, previewFile, importProducts,
  saveMapping, getMapping, lastBatch,
} from '../importer.js';
import { readTable } from '../xlsx.js';
import {
  layout, esc, field, select, textarea, card, pageHeader, button, csrfField,
  badge, emptyState, flash, statusBadge,
} from '../ui.js';
import { fmtQty, fmtMoney } from '../calc.js';

function render(ctx, title, body, wide = false) {
  return htmlPage(layout(ctx, { title, body, wide }));
}

const PAGE_SIZE = 50;

/** Lista de produtos do catalogo (usada na pagina e na busca ao vivo). */
function blocoListaProdutos(ctx, { products, q, fornecedor, total, page, pages }) {
  const rows = products.map((p) => `<tr>
      <td class="small mono">${esc(p.internal_code || '—')}</td>
      <td>${esc(p.description)}<div class="small muted">${[p.brand, p.ean ? `EAN ${p.ean}` : null, p.reference ? `ref ${p.reference}` : null, p.ncm ? `NCM ${p.ncm}` : null].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td class="small">${esc(p.supplier_name)}</td>
      <td class="num">${p.unit_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
      <td class="center small">${fmtQty(p.stock)}</td>
      <td class="right nowrap">
        <a class="btn sm" href="/produtos/${p.id}/editar">Editar</a>
        <form class="inline-form" method="post" action="/produtos/${p.id}/excluir" data-confirm="Remover este produto do catálogo?">
          ${csrfField(ctx)}<button class="btn sm danger">Excluir</button>
        </form>
      </td>
    </tr>`).join('');

  const contagem = `<p class="small muted" style="margin:0 0 12px">${total} produto(s) encontrado(s)</p>`;

  if (!products.length) {
    return contagem + emptyState(q
      ? 'Nenhum produto encontrado para esta busca.'
      : 'Nenhum produto no catálogo. Envie uma planilha em Fornecedores.');
  }

  const pager = pages > 1 ? `<div class="inline" style="justify-content:center;margin-top:16px">
      ${Array.from({ length: Math.min(pages, 12) }, (_, i) => {
        const n = i + 1;
        return `<a class="btn sm${n === page ? ' primary' : ''}" href="/produtos?q=${encodeURIComponent(q)}&fornecedor=${fornecedor || ''}&page=${n}">${n}</a>`;
      }).join('')}
    </div>` : '';

  return `${contagem}<div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Descrição</th><th>Fornecedor</th><th class="num">Valor unit.</th><th class="center">Estoque</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>${pager}`;
}

// ---------------------------------------------------------------- clientes
export function registerCatalogRoutes() {
  routeGet('/clientes', (ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams.get('q') || '';
    const clients = listClients(q);
    const rows = clients.map((c) => `<tr>
      <td class="strong"><a href="/clientes/${c.id}">${esc(c.name)}</a></td>
      <td class="mono small">${esc(c.cnpj || '—')}</td>
      <td class="small">${esc(c.contact || '—')}</td>
      <td class="small mono">${esc(c.phone || c.email || '—')}</td>
      <td class="center">${c.quotes_count}</td>
      <td class="right nowrap"><a class="btn sm" href="/clientes/${c.id}">Editar</a></td>
    </tr>`).join('');

    const body = clients.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>CNPJ</th><th>Contato</th><th>Telefone / e-mail</th><th class="center">Orçamentos</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
      : emptyState('Nenhum cliente encontrado. Cadastre o primeiro para começar a fazer orçamentos.');

    return render(ctx, 'Clientes', `
      ${pageHeader({
        title: 'Clientes',
        subtitle: 'Quem recebe as propostas. Os dados aparecem na planilha gerada.',
        actions: button('Novo cliente', { href: '/clientes/novo' }),
      })}
      ${flash(ctx)}
      ${card(null, `
        <form method="get" action="/clientes" class="inline" style="margin-bottom:14px">
          <label class="field" style="flex:1"><span>Buscar</span>
            <input type="search" name="q" value="${esc(q)}" placeholder="Nome ou CNPJ"></label>
          ${button('Buscar', { kind: 'soft' })}
        </form>
        ${body}
      `, { flush: false })}
    `);
  });

  const clientForm = (ctx, { client = null, values = {}, error = '' } = {}) => {
    const v = { ...(client || {}), ...values };
    const isNew = !client;
    return render(ctx, isNew ? 'Novo cliente' : 'Editar cliente', `
      ${pageHeader({ title: isNew ? 'Novo cliente' : 'Editar cliente', back: { href: '/clientes', label: 'Clientes' } })}
      ${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
      ${card(null, `
        <form method="post" action="${isNew ? '/clientes' : `/clientes/${client.id}`}">
          ${csrfField(ctx)}
          <div class="form-grid">
            ${field({ label: 'Razão social / Nome', name: 'name', value: v.name || '', required: true, className: 'span2' })}
            ${field({ label: 'CNPJ / CPF', name: 'cnpj', value: v.cnpj || '' })}
            ${field({ label: 'Inscrição estadual', name: 'ie', value: v.ie || '' })}
            ${field({ label: 'Endereço completo', name: 'address', value: v.address || '', className: 'span2' })}
            ${field({ label: 'Pessoa de contato', name: 'contact', value: v.contact || '' })}
            ${field({ label: 'Telefone', name: 'phone', value: v.phone || '' })}
            ${field({ label: 'E-mail', name: 'email', type: 'email', value: v.email || '' })}
            ${textarea({ label: 'Observações internas', name: 'notes', value: v.notes || '', rows: 3 })}
          </div>
          <div class="form-actions">
            ${button('Salvar', { kind: 'primary' })}
            ${button('Cancelar', { kind: 'ghost', href: '/clientes' })}
          </div>
        </form>
      `)}
    `);
  };

  routeGet('/clientes/novo', (ctx) => { requireUser(ctx); return clientForm(ctx, {}); });
  routeGet('/clientes/:id', (ctx) => {
    requireUser(ctx);
    const client = getClient(Number(ctx.params.id));
    if (!client) throw new HttpError(404, 'Cliente não encontrado.');
    return clientForm(ctx, { client });
  });

  post('/clientes', (ctx) => {
    const user = requireUser(ctx);
    const name = str(ctx.fields.name).trim();
    if (!name) return clientForm(ctx, { values: ctx.fields, error: 'Informe o nome do cliente.' });
    const r = run(
      `INSERT INTO clients (name, cnpj, ie, address, contact, email, phone, notes, active, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
      name, str(ctx.fields.cnpj), str(ctx.fields.ie), str(ctx.fields.address), str(ctx.fields.contact),
      str(ctx.fields.email), str(ctx.fields.phone), str(ctx.fields.notes), nowIso(),
    );
    audit(user.id, 'client.create', 'clients', r.lastId, name);
    return redirect(`/clientes?msg=${encodeURIComponent('Cliente cadastrado.')}`);
  });

  post('/clientes/:id', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const name = str(ctx.fields.name).trim();
    if (!name) return clientForm(ctx, { client: getClient(id), values: ctx.fields, error: 'Informe o nome do cliente.' });
    run(
      `UPDATE clients SET name=?, cnpj=?, ie=?, address=?, contact=?, email=?, phone=?, notes=?, updated_at=? WHERE id=?`,
      name, str(ctx.fields.cnpj), str(ctx.fields.ie), str(ctx.fields.address), str(ctx.fields.contact),
      str(ctx.fields.email), str(ctx.fields.phone), str(ctx.fields.notes), nowIso(), id,
    );
    audit(user.id, 'client.update', 'clients', id, name);
    return redirect(`/clientes/${id}?msg=${encodeURIComponent('Cliente atualizado.')}`);
  });

  post('/clientes/:id/excluir', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const quoted = get('SELECT COUNT(*) AS n FROM quotes WHERE client_id = ?', id)?.n || 0;
    if (quoted > 0) {
      return redirect(`/clientes/${id}?err=${encodeURIComponent('Este cliente possui orçamentos e não pode ser excluído. Desative-o em vez disso.')}`);
    }
    run('DELETE FROM clients WHERE id = ?', id);
    audit(user.id, 'client.delete', 'clients', id, null);
    return redirect(`/clientes?msg=${encodeURIComponent('Cliente excluído.')}`);
  });

  // ---------------------------------------------------------------- fornecedores
  routeGet('/fornecedores', (ctx) => {
    requireUser(ctx);
    const suppliers = listSuppliers();
    const rows = suppliers.map((s) => `<tr>
      <td class="strong"><a href="/fornecedores/${s.id}">${esc(s.name)}</a>
        ${s.is_own ? badge('principal', 'info') : ''}${s.active ? '' : badge('inativo', 'bad')}</td>
      <td class="mono small">${esc(s.cnpj || '—')}</td>
      <td class="center">${s.products_count}</td>
      <td class="small muted nowrap">${s.last_import ? esc(new Date(s.last_import).toLocaleDateString('pt-BR')) : 'nunca'}</td>
      <td class="right nowrap">
        <a class="btn sm" href="/fornecedores/${s.id}/importar">Enviar planilha</a>
        <a class="btn sm" href="/fornecedores/${s.id}">Abrir</a>
      </td>
    </tr>`).join('');

    return render(ctx, 'Fornecedores', `
      ${pageHeader({
        title: 'Fornecedores',
        subtitle: 'Cada fornecedor tem seu próprio catálogo, alimentado pela planilha que ele envia.',
        actions: button('Novo fornecedor', { href: '/fornecedores/novo' }),
      })}
      ${flash(ctx)}
      ${card(null, suppliers.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Fornecedor</th><th>CNPJ</th><th class="center">Produtos</th><th>Última planilha</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : emptyState('Nenhum fornecedor cadastrado.'), { flush: true })}
    `);
  });

  const supplierForm = (ctx, { supplier = null, values = {}, error = '' } = {}) => {
    const v = { ...(supplier || {}), ...values };
    const isNew = !supplier;
    return render(ctx, isNew ? 'Novo fornecedor' : `Editar ${supplier.name}`, `
      ${pageHeader({ title: isNew ? 'Novo fornecedor' : 'Editar fornecedor', back: { href: '/fornecedores', label: 'Fornecedores' } })}
      ${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
      ${card(null, `
        <form method="post" action="${isNew ? '/fornecedores' : `/fornecedores/${supplier.id}`}">
          ${csrfField(ctx)}
          <div class="form-grid">
            ${field({ label: 'Nome fantasia', name: 'name', value: v.name || '', required: true })}
            ${field({ label: 'Razão social', name: 'legal_name', value: v.legal_name || '' })}
            ${field({ label: 'CNPJ', name: 'cnpj', value: v.cnpj || '' })}
            ${field({ label: 'Inscrição estadual', name: 'ie', value: v.ie || '' })}
            ${field({ label: 'Endereço', name: 'address', value: v.address || '', className: 'span2' })}
            ${field({ label: 'Contato', name: 'contact', value: v.contact || '' })}
            ${field({ label: 'E-mail', name: 'email', type: 'email', value: v.email || '' })}
            ${field({ label: 'Telefone', name: 'phone', value: v.phone || '' })}
            ${textarea({ label: 'Dados bancários / PIX', name: 'bank_info', value: v.bank_info || '', rows: 4, hint: 'Aparece no rodapé quando esta empresa assina a proposta.' })}
            ${select({
              label: 'Layout do orçamento',
              name: 'layout',
              value: v.layout || 'classico',
              options: layoutOptions(),
              hint: `Modelo visual da planilha/PDF quando este fornecedor assina a proposta. Ver exemplo: ${layoutExampleLinks()}`,
            })}
          </div>
          <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-top:8px">
            <input type="checkbox" name="is_own" value="1" ${v.is_own ? 'checked' : ''}>
            <span style="margin:0;font-weight:500">Esta é a minha empresa (usada como padrão nas novas propostas)</span>
          </label>
          <div class="form-actions">
            ${button('Salvar', { kind: 'primary' })}
            ${button('Cancelar', { kind: 'ghost', href: '/fornecedores' })}
          </div>
        </form>
      `)}
    `);
  };

  routeGet('/fornecedores/novo', (ctx) => { requireUser(ctx); return supplierForm(ctx, {}); });
  routeGet('/fornecedores/:id', (ctx) => {
    requireUser(ctx);
    const supplier = getSupplier(Number(ctx.params.id));
    if (!supplier) throw new HttpError(404, 'Fornecedor não encontrado.');
    const batches = all(
      'SELECT b.*, u.name AS user_name FROM import_batches b LEFT JOIN users u ON u.id = b.user_id WHERE b.supplier_id = ? ORDER BY b.id DESC LIMIT 8',
      supplier.id,
    );
    const mapping = getMapping(supplier.id);
    const batchRows = batches.map((b) => `<tr>
      <td class="small nowrap">${esc(new Date(b.created_at).toLocaleString('pt-BR'))}</td>
      <td class="small">${esc(b.filename || '—')}</td>
      <td class="center">${b.rows_total}</td>
      <td class="center" style="color:var(--ok);font-weight:600">${b.rows_imported}</td>
      <td class="center">${b.rows_updated}</td>
      <td class="small muted">${esc(b.user_name || '—')}</td>
    </tr>`).join('');

    return render(ctx, supplier.name, `
      ${pageHeader({
        title: supplier.name,
        subtitle: `${supplier.products_count || supplier.products_count === 0 ? '' : ''}Catálogo com ${get('SELECT COUNT(*) AS n FROM products WHERE supplier_id = ?', supplier.id)?.n || 0} produtos`,
        back: { href: '/fornecedores', label: 'Fornecedores' },
        actions: `<a class="btn primary" href="/fornecedores/${supplier.id}/importar">Enviar planilha</a>
                  <a class="btn" href="/produtos?fornecedor=${supplier.id}">Ver produtos</a>
                  <a class="btn" href="/fornecedores/${supplier.id}/editar">Editar dados</a>`,
      })}
      ${flash(ctx)}
      <div class="grid-2">
        <div>
          ${card('Últimas importações', batches.length
            ? `<div class="table-wrap"><table>
                <thead><tr><th>Data</th><th>Arquivo</th><th class="center">Linhas</th><th class="center">Novos</th><th class="center">Atualizados</th><th>Por</th></tr></thead>
                <tbody>${batchRows}</tbody></table></div>`
            : emptyState('Nenhuma planilha importada ainda. Use o botão “Enviar planilha”.'), { flush: true })}
        </div>
        <div>
          ${card('Resumo do cadastro', `
            <dl class="summary">
              <div class="row"><span>CNPJ</span><span>${esc(supplier.cnpj || '—')}</span></div>
              <div class="row"><span>Contato</span><span>${esc(supplier.contact || '—')}</span></div>
              <div class="row"><span>E-mail</span><span>${esc(supplier.email || '—')}</span></div>
              <div class="row"><span>Telefone</span><span>${esc(supplier.phone || '—')}</span></div>
              <div class="row"><span>Última planilha</span><span>${batches[0] ? esc(new Date(batches[0].created_at).toLocaleDateString('pt-BR')) : '—'}</span></div>
            </dl>
            ${mapping ? `<p class="small muted" style="margin-top:14px">Mapeamento de colunas salvo em ${esc(new Date(mapping.updated_at).toLocaleString('pt-BR'))} — será reaproveitado automaticamente no próximo envio.</p>` : ''}
          `)}
        </div>
      </div>
    `);
  });

  routeGet('/fornecedores/:id/editar', (ctx) => {
    requireUser(ctx);
    const supplier = getSupplier(Number(ctx.params.id));
    if (!supplier) throw new HttpError(404, 'Fornecedor não encontrado.');
    return supplierForm(ctx, { supplier });
  });

  post('/fornecedores', (ctx) => {
    const user = requireUser(ctx);
    const name = str(ctx.fields.name).trim();
    if (!name) return supplierForm(ctx, { values: ctx.fields, error: 'Informe o nome do fornecedor.' });
    const isOwn = bool(ctx.fields.is_own);
    if (isOwn) run('UPDATE suppliers SET is_own = 0');
    const id = saveSupplier(null, {
      name,
      legal_name: str(ctx.fields.legal_name),
      cnpj: str(ctx.fields.cnpj),
      ie: str(ctx.fields.ie),
      address: str(ctx.fields.address),
      contact: str(ctx.fields.contact),
      email: str(ctx.fields.email),
      phone: str(ctx.fields.phone),
      bank_info: str(ctx.fields.bank_info),
      layout: str(ctx.fields.layout) || 'classico',
      is_own: isOwn ? 1 : 0,
      active: 1,
    });
    audit(user.id, 'supplier.create', 'suppliers', id, name);
    return redirect(`/fornecedores/${id}?msg=${encodeURIComponent('Fornecedor cadastrado. Envie a planilha de produtos.')}`);
  });

  post('/fornecedores/:id', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const name = str(ctx.fields.name).trim();
    if (!name) return supplierForm(ctx, { supplier: getSupplier(id), values: ctx.fields, error: 'Informe o nome.' });
    const isOwn = bool(ctx.fields.is_own);
    if (isOwn) run('UPDATE suppliers SET is_own = 0 WHERE id <> ?', id);
    saveSupplier(id, {
      name,
      legal_name: str(ctx.fields.legal_name),
      cnpj: str(ctx.fields.cnpj),
      ie: str(ctx.fields.ie),
      address: str(ctx.fields.address),
      contact: str(ctx.fields.contact),
      email: str(ctx.fields.email),
      phone: str(ctx.fields.phone),
      bank_info: str(ctx.fields.bank_info),
      layout: str(ctx.fields.layout) || 'classico',
      is_own: isOwn ? 1 : 0,
      active: 1,
    });
    audit(user.id, 'supplier.update', 'suppliers', id, name);
    return redirect(`/fornecedores/${id}?msg=${encodeURIComponent('Fornecedor atualizado.')}`);
  });

  // ---------------------------------------------------------------- importacao
  routeGet('/fornecedores/:id/importar', (ctx) => {
    requireUser(ctx);
    const supplier = getSupplier(Number(ctx.params.id));
    if (!supplier) throw new HttpError(404, 'Fornecedor não encontrado.');
    return render(ctx, 'Enviar planilha', `
      ${pageHeader({
        title: 'Enviar planilha de produtos',
        subtitle: `Catálogo de <strong>${esc(supplier.name)}</strong>`,
        back: { href: `/fornecedores/${supplier.id}`, label: supplier.name },
        actions: `<a class="btn" href="/modelo-importacao.xlsx">Baixar planilha modelo</a>`,
      })}
      ${flash(ctx)}
      ${card('Arquivo', `
        <form method="post" action="/fornecedores/${supplier.id}/importar" enctype="multipart/form-data">
          ${csrfField(ctx)}
          <div class="form-grid">
            <label class="field span2">
              <span>Planilha (.xlsx, .csv) <b class="req">*</b></span>
              <input type="file" name="file" accept=".xlsx,.csv,.txt" required>
              <small>Aceita Excel (.xlsx) ou CSV. Arquivos .xls antigos devem ser salvos como .xlsx.</small>
            </label>
            ${select({
              label: 'Como tratar os produtos já cadastrados',
              name: 'mode',
              value: 'merge',
              options: [
                { value: 'merge', label: 'Atualizar preços e incluir novos (recomendado)' },
                { value: 'replace', label: 'Substituir todo o catálogo por esta planilha' },
              ],
            })}
          </div>
          <div class="form-actions">${button('Analisar planilha', { kind: 'primary' })}</div>
        </form>
      `)}
      ${card('Colunas reconhecidas automaticamente', `
        <p class="small muted" style="margin-top:0">O sistema identifica o cabeçalho e associa as colunas pelos nomes mais comuns. Se o layout do fornecedor for diferente, você ajusta na próxima tela.</p>
        <div class="inline" style="margin-bottom:14px">
          <a class="btn soft sm" href="/modelo-importacao.xlsx">Planilha modelo (.xlsx)</a>
          <a class="btn soft sm" href="/modelo-importacao.csv">Planilha modelo (.csv)</a>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Campo</th><th>Nomes aceitos</th></tr></thead>
          <tbody>
            <tr><td class="strong">Descrição <span class="req" style="color:var(--bad)">*</span></td><td class="small">descrição, produto, nome, material</td></tr>
            <tr><td class="strong">Valor unitário <span class="req" style="color:var(--bad)">*</span></td><td class="small">valor unitário, preço, custo, vlr unit</td></tr>
            <tr><td class="strong">Marca</td><td class="small">marca, fabricante</td></tr>
            <tr><td class="strong">Estoque</td><td class="small">estoque, saldo, quantidade</td></tr>
            <tr><td class="strong">Código do fabricante</td><td class="small">cód fabricante, part number, MPN</td></tr>
            <tr><td class="strong">Código de barras (EAN)</td><td class="small">EAN, código de barras, GTIN</td></tr>
            <tr><td class="strong">Referência</td><td class="small">referência, ref</td></tr>
            <tr><td class="strong">NCM</td><td class="small">NCM</td></tr>
          </tbody></table></div>
      `)}
    `);
  });

  post('/fornecedores/:id/importar', async (ctx) => {
    const user = requireUser(ctx);
    const supplierId = Number(ctx.params.id);
    const supplier = getSupplier(supplierId);
    if (!supplier) throw new HttpError(404, 'Fornecedor não encontrado.');

    const file = (ctx.files || [])[0];
    if (!file || !file.data?.length) {
      return redirect(`/fornecedores/${supplierId}/importar?err=${encodeURIComponent('Selecione um arquivo.')}`);
    }

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const token = crypto.randomUUID();
    const ext = path.extname(file.filename || '').toLowerCase() || '.xlsx';
    const tmpPath = path.join(TMP_DIR, `${token}${ext}`);
    fs.writeFileSync(tmpPath, file.data);

    return redirect(`/fornecedores/${supplierId}/importar/preview?t=${token}&name=${encodeURIComponent(file.filename || 'planilha')}&mode=${encodeURIComponent(str(ctx.fields.mode) || 'merge')}`);
  });

  routeGet('/fornecedores/:id/importar/preview', (ctx) => {
    requireUser(ctx);
    const supplierId = Number(ctx.params.id);
    const supplier = getSupplier(supplierId);
    if (!supplier) throw new HttpError(404, 'Fornecedor não encontrado.');

    const token = String(ctx.url.searchParams.get('t') || '').replace(/[^a-f0-9-]/gi, '');
    const filename = ctx.url.searchParams.get('name') || 'planilha';
    const mode = ctx.url.searchParams.get('mode') === 'replace' ? 'replace' : 'merge';
    const sheetIndex = Number(ctx.url.searchParams.get('sheet') || 0);

    const tmpPath = findTmp(token);
    if (!tmpPath) {
      return redirect(`/fornecedores/${supplierId}/importar?err=${encodeURIComponent('Envio expirado. Selecione o arquivo novamente.')}`);
    }

    const preview = previewFile(fs.readFileSync(tmpPath), filename);
    const sheet = preview.sheets[Math.min(sheetIndex, preview.sheets.length - 1)];

    const sheetLinks = preview.sheets.map((s, i) => `<a class="btn sm${i === sheetIndex ? ' primary' : ''}" href="/fornecedores/${supplierId}/importar/preview?t=${token}&name=${encodeURIComponent(filename)}&mode=${mode}&sheet=${i}">${esc(s.name)} (${s.count})</a>`).join(' ');

    const mapRows = FIELDS.map((f) => {
      const options = [{ value: '', label: '— não importar —' }];
      sheet.headers.forEach((h, i) => {
        options.push({ value: i, label: `${letra(i)} · ${h || '(vazio)'}` });
      });
      const selected = sheet.mapping[f.key];
      return `<tr>
        <td class="strong">${esc(f.label)}${f.required ? ' <span style="color:var(--bad)">*</span>' : ''}</td>
        <td><select name="map_${f.key}" style="width:100%;padding:6px 8px;border:1px solid #cfdae9;border-radius:6px;font:inherit">
          ${options.map((o) => `<option value="${o.value}"${String(o.value) === String(selected ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></td>
        <td class="small muted">${selected !== undefined ? esc(sheet.sample[0]?.[f.key] ?? '') : ''}</td>
      </tr>`;
    }).join('');

    const sampleHead = ['description', 'unit_price', 'brand', 'stock', 'manufacturer_code', 'ean', 'reference', 'ncm']
      .filter((k) => sheet.mapping[k] !== undefined);
    const sampleRows = sheet.sample.map((r) => `<tr>${
      ['description', 'unit_price', 'brand', 'stock', 'manufacturer_code', 'ean', 'reference', 'ncm']
        .filter((k) => sheet.mapping[k] !== undefined)
        .map((k) => `<td class="small">${esc(k === 'unit_price' ? Number(r[k]).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : (r[k] ?? ''))}</td>`)
        .join('')
    }</tr>`).join('');

    return render(ctx, 'Conferir importação', `
      ${pageHeader({
        title: 'Conferir importação',
        subtitle: `${esc(filename)} · ${esc(supplier.name)}`,
        back: { href: `/fornecedores/${supplierId}/importar`, label: 'Escolher outro arquivo' },
      })}
      ${preview.sheets.length > 1 ? card('Abas encontradas no arquivo', `<div class="inline">${sheetLinks}</div>`) : ''}
      ${card('Mapeamento das colunas', `
        <form method="post" action="/fornecedores/${supplierId}/importar/confirmar">
          ${csrfField(ctx)}
          <input type="hidden" name="t" value="${token}">
          <input type="hidden" name="name" value="${esc(filename)}">
          <input type="hidden" name="sheet" value="${sheetIndex}">
          <input type="hidden" name="header" value="${sheet.headerRow}">
          <input type="hidden" name="mode" value="${mode}">
          <div class="table-wrap"><table>
            <thead><tr><th>Campo do sistema</th><th>Coluna da planilha</th><th>Exemplo</th></tr></thead>
            <tbody>${mapRows}</tbody></table></div>
          <p class="small muted">Aba selecionada: <strong>${esc(sheet.name)}</strong> · cabeçalho na linha ${sheet.headerRow + 1} · ${sheet.count} produtos válidos detectados.</p>
          ${sheet.errors.length ? `<div class="flash bad">${sheet.errors.map((e) => esc(e.message)).join('<br>')}</div>` : ''}
          <div class="form-actions">
            ${button(`Importar ${sheet.count} produtos`, { kind: 'primary' })}
            ${button('Cancelar', { kind: 'ghost', href: `/fornecedores/${supplierId}` })}
          </div>
        </form>
      `)}
      ${sheet.sample.length ? card('Amostra dos dados', `
        <div class="table-wrap"><table>
          <thead><tr>${sampleHead.map((k) => `<th>${esc(FIELDS.find((f) => f.key === k)?.label || k)}</th>`).join('')}</tr></thead>
          <tbody>${sampleRows}</tbody></table></div>
        <p class="small muted">Primeiras ${sheet.sample.length} linhas válidas.</p>
      `, { flush: true }) : ''}
    `);
  });

  post('/fornecedores/:id/importar/confirmar', (ctx) => {
    const user = requireUser(ctx);
    const supplierId = Number(ctx.params.id);
    const supplier = getSupplier(supplierId);
    if (!supplier) throw new HttpError(404, 'Fornecedor não encontrado.');

    const token = str(ctx.fields.t).replace(/[^a-f0-9-]/gi, '');
    const filename = str(ctx.fields.name) || 'planilha';
    const mode = str(ctx.fields.mode) === 'replace' ? 'replace' : 'merge';
    const sheetIndex = Number(str(ctx.fields.sheet) || 0);

    const tmpPath = findTmp(token);
    if (!tmpPath) {
      return redirect(`/fornecedores/${supplierId}/importar?err=${encodeURIComponent('Envio expirado. Selecione o arquivo novamente.')}`);
    }

    const parsed = readTable(fs.readFileSync(tmpPath), filename);
    const target = parsed.sheets[Math.min(sheetIndex, parsed.sheets.length - 1)];

    const mapping = {};
    for (const f of FIELDS) {
      const v = str(ctx.fields[`map_${f.key}`]);
      if (v !== '') mapping[f.key] = Number(v);
    }

    if (mapping.description === undefined || mapping.unit_price === undefined) {
      return redirect(`/fornecedores/${supplierId}/importar?err=${encodeURIComponent('É obrigatório mapear Descrição e Valor unitário.')}`);
    }

    const headerRaw = str(ctx.fields.header);
    const headerRow = headerRaw === '' ? detectMapping(target.rows).headerRow : Number(headerRaw);
    const { records } = extractRecords(target.rows, mapping, headerRow);

    const result = importProducts({
      supplierId, userId: user.id, filename, mode, records, mapping,
    });

    saveMapping(supplierId, target.name, headerRow, mapping);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    audit(user.id, 'supplier.import', 'suppliers', supplierId, `${result.inserted} novos / ${result.updated} atualizados`);

    const msg = `Importação concluída: ${result.inserted} novos, ${result.updated} atualizados, ${result.skipped} sem alteração.`;
    return redirect(`/fornecedores/${supplierId}?msg=${encodeURIComponent(msg)}`);
  });

  // ---------------------------------------------------------------- modelo
  routeGet('/modelo-importacao.xlsx', (ctx) => {
    requireUser(ctx);
    return download('modelo_importacao_produtos.xlsx', buildModeloXlsx());
  });

  routeGet('/modelo-importacao.csv', (ctx) => {
    requireUser(ctx);
    return download('modelo_importacao_produtos.csv', buildModeloCsv(), 'text/csv; charset=utf-8');
  });

  // ---------------------------------------------------------------- produtos
  routeGet('/produtos', (ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams.get('q') || '';
    const fornecedor = Number(ctx.url.searchParams.get('fornecedor') || 0) || null;
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') || 1));
    const total = countProducts({ q, supplierId: fornecedor });
    const products = searchProducts({ q, supplierId: fornecedor, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const supplierOpts = [{ value: '', label: 'Todos os fornecedores' }]
      .concat(listSuppliers().map((s) => ({ value: s.id, label: s.name })));

    return render(ctx, 'Produtos', `
      ${pageHeader({
        title: 'Catálogo de produtos',
        subtitle: 'Busca em texto completo por descrição, código, EAN, referência ou marca.',
        actions: `<a class="btn primary" href="/produtos/novo">Novo produto</a>
                  <a class="btn" href="/modelo-importacao.xlsx">Baixar planilha modelo</a>`,
      })}
      ${flash(ctx)}
      ${card(null, `
        <form method="get" action="/produtos" class="inline" style="margin-bottom:16px">
          <label class="field" style="flex:2;min-width:220px"><span>Buscar por descrição, código, EAN ou referência</span>
            <input type="search" name="q" value="${esc(q)}" placeholder="ex.: cabo, 6881, 789..." autocomplete="off"
                   data-busca-viva="/produtos/lista"
                   data-busca-param="q"
                   data-busca-alvo="#lista-produtos"
                   data-busca-extra="fornecedor"
                   data-busca-min="3"></label>
          <label class="field" style="flex:1;min-width:180px"><span>Fornecedor</span>
            <select name="fornecedor">${supplierOpts.map((o) => `<option value="${o.value}"${String(o.value) === String(fornecedor ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          ${button('Buscar', { kind: 'soft' })}
          <button class="btn" type="submit" formaction="/produtos/reajustar" formmethod="get"
                  title="Aplicar desconto ou acréscimo a todos os itens do fornecedor selecionado">
            Ajustar preços
          </button>
        </form>
        <div id="lista-produtos">${blocoListaProdutos(ctx, { products, q, fornecedor, total, page, pages })}</div>
      `, { flush: products.length > 0 })}
    `);
  });

  // busca ao vivo do catalogo: devolve so a lista
  routeGet('/produtos/lista', (ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams.get('q') || '';
    const fornecedor = Number(ctx.url.searchParams.get('fornecedor') || 0) || null;

    // a busca ao vivo so comeca com 3 letras (evita varrer o catalogo a cada tecla)
    if (q.trim().length > 0 && q.trim().length < 3) {
      return htmlPage('<p class="small muted" style="margin:10px 0 0">Continue digitando…</p>');
    }

    const page = Math.max(1, Number(ctx.url.searchParams.get('page') || 1));
    const total = countProducts({ q, supplierId: fornecedor });
    const products = searchProducts({ q, supplierId: fornecedor, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return htmlPage(blocoListaProdutos(ctx, { products, q, fornecedor, total, page, pages }));
  });

  const produtoForm = (ctx, { product = null, values = {}, error = '' } = {}) => {
    const v = { ...(product || {}), ...values };
    const isNew = !product;
    const fornecedores = listSuppliers(true).map((s) => ({
      value: s.id,
      label: `${s.name}${s.is_own ? ' (principal)' : ''}`,
    }));

    return render(ctx, isNew ? 'Novo produto' : 'Editar produto', `
      ${pageHeader({
        title: isNew ? 'Novo produto' : 'Editar produto',
        subtitle: isNew ? 'Cadastre um item direto no catálogo, sem planilha.' : esc(product.description),
        back: { href: '/produtos', label: 'Catálogo' },
      })}
      ${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
      ${card(null, `
        <form method="post" action="${isNew ? '/produtos' : `/produtos/${product.id}`}">
          ${csrfField(ctx)}
          <div class="form-grid">
            ${select({
              label: 'Fornecedor',
              name: 'supplier_id',
              value: v.supplier_id || '',
              required: true,
              options: [{ value: '', label: '— selecione —' }].concat(fornecedores),
            })}
            ${field({ label: 'Código interno', name: 'internal_code', value: v.internal_code || '' })}
            ${field({ label: 'Descrição', name: 'description', value: v.description || '', required: true, className: 'span2' })}
            ${field({ label: 'Valor unitário (R$)', name: 'unit_price', value: v.unit_price ?? '', required: true, placeholder: '0,00' })}
            ${field({ label: 'Marca', name: 'brand', value: v.brand || '' })}
            ${field({ label: 'Estoque', name: 'stock', value: v.stock ?? 0 })}
            ${field({ label: 'Unidade', name: 'unit', value: v.unit || 'UN', placeholder: 'UN, M, PC...' })}
            ${field({ label: 'Código do fabricante', name: 'manufacturer_code', value: v.manufacturer_code || '' })}
            ${field({ label: 'Código de barras (EAN)', name: 'ean', value: v.ean || '' })}
            ${field({ label: 'Referência', name: 'reference', value: v.reference || '' })}
            ${field({ label: 'NCM', name: 'ncm', value: v.ncm || '' })}
          </div>
          <div class="form-actions">
            ${button('Salvar produto', { kind: 'primary' })}
            ${button('Cancelar', { kind: 'ghost', href: '/produtos' })}
          </div>
        </form>
      `)}
    `);
  };

  routeGet('/produtos/novo', (ctx) => {
    requireUser(ctx);
    const fornecedor = Number(ctx.url.searchParams.get('fornecedor') || 0) || '';
    return produtoForm(ctx, { values: { supplier_id: fornecedor, unit: 'UN', stock: 0 } });
  });

  // ---------------------------------------------------------------- ajuste em massa
  const estatisticas = (supplierId) => get(
    `SELECT COUNT(*) AS n, COALESCE(MIN(unit_price),0) AS menor,
            COALESCE(MAX(unit_price),0) AS maior, COALESCE(SUM(unit_price),0) AS soma
       FROM products WHERE supplier_id = ? AND active = 1 AND unit_price > 0`,
    supplierId,
  );

  routeGet('/produtos/reajustar', (ctx) => {
    requireUser(ctx);
    const supplierId = Number(ctx.url.searchParams.get('fornecedor') || 0);
    const supplier = supplierId ? getSupplier(supplierId) : null;
    const erro = ctx.url.searchParams.get('err');

    if (!supplier) {
      return render(ctx, 'Ajustar preços do catálogo', `
        ${pageHeader({
          title: 'Ajustar preços do catálogo',
          subtitle: 'Aplicar desconto ou acréscimo a todos os itens de um fornecedor.',
          back: { href: '/produtos', label: 'Catálogo' },
        })}
        ${card(null, `
          <div class="flash bad">Selecione um fornecedor no filtro do catálogo antes de ajustar os preços.</div>
          ${button('Voltar ao catálogo', { kind: 'primary', href: '/produtos' })}
        `)}
      `);
    }

    const st = estatisticas(supplierId);

    return render(ctx, 'Ajustar preços do catálogo', `
      ${pageHeader({
        title: 'Ajustar preços do catálogo',
        subtitle: `Fornecedor: <strong>${esc(supplier.name)}</strong>`,
        back: { href: `/produtos?fornecedor=${supplierId}`, label: 'Catálogo' },
      })}
      ${flash(ctx)}
      <div class="grid-2">
        <div>
          ${card(null, `
            <form method="post" action="/produtos/reajustar">
              ${csrfField(ctx)}
              <input type="hidden" name="supplier_id" value="${supplierId}">
              <div class="form-grid">
                ${select({
                  label: 'O que fazer',
                  name: 'direction',
                  value: 'aumento',
                  options: [
                    { value: 'aumento', label: 'Acréscimo — aumentar todos os preços' },
                    { value: 'desconto', label: 'Desconto — reduzir todos os preços' },
                  ],
                })}
                ${field({
                  label: 'Percentual (%)',
                  name: 'pct',
                  type: 'number',
                  step: '0.01',
                  min: '0.01',
                  value: '10',
                  required: true,
                  hint: 'Aplicado sobre o valor atual de cada item.',
                })}
              </div>
              <p class="small muted" style="margin:14px 0 0">
                Vale para <strong>${st.n} produto(s)</strong> ativos deste fornecedor.
                O preço de cada item passa a ser o valor atual vezes (1 ± percentual).
              </p>
              <div class="form-actions">
                ${button('Aplicar ajuste', { kind: 'primary' })}
                ${button('Cancelar', { kind: 'ghost', href: `/produtos?fornecedor=${supplierId}` })}
              </div>
            </form>
          `)}
        </div>
        <div>
          ${card('Situação atual', `
            <dl class="summary">
              <div class="row"><span>Produtos com preço</span><span>${st.n}</span></div>
              <div class="row"><span>Menor preço</span><span>${fmtMoney(st.menor)}</span></div>
              <div class="row"><span>Maior preço</span><span>${fmtMoney(st.maior)}</span></div>
              <div class="row total"><span>Soma dos preços</span><span>${fmtMoney(st.soma)}</span></div>
            </dl>
            <p class="small muted" style="margin:14px 0 0">
              Preços zerados são ignorados. O ajuste não mexe em estoque, código ou descrição.
            </p>
          `)}
        </div>
      </div>
    `, true);
  });

  post('/produtos/reajustar', (ctx) => {
    const user = requireUser(ctx);
    const supplierId = Number(str(ctx.fields.supplier_id));
    const supplier = supplierId ? getSupplier(supplierId) : null;
    if (!supplier) {
      return redirect(`/produtos?err=${encodeURIComponent('Fornecedor inválido.')}`);
    }

    const direcao = str(ctx.fields.direction) === 'desconto' ? 'desconto' : 'aumento';
    const pct = num(ctx.fields.pct, 0);

    if (!(pct > 0)) {
      return redirect(`/produtos/reajustar?fornecedor=${supplierId}&err=${encodeURIComponent('Informe um percentual maior que zero.')}`);
    }
    if (direcao === 'desconto' && pct >= 100) {
      return redirect(`/produtos/reajustar?fornecedor=${supplierId}&err=${encodeURIComponent('Desconto deve ser menor que 100%.')}`);
    }

    const fator = direcao === 'desconto' ? (1 - pct / 100) : (1 + pct / 100);
    const antes = estatisticas(supplierId);

    const alterados = tx(() => {
      const r = run(
        `UPDATE products
            SET unit_price = MAX(0.01, ROUND(unit_price * ?, 2)),
                updated_at = ?
          WHERE supplier_id = ? AND active = 1 AND unit_price > 0`,
        fator, nowIso(), supplierId,
      );
      run(
        `INSERT INTO import_batches
           (supplier_id, user_id, filename, mode, rows_total, rows_imported, rows_updated, rows_skipped, created_at)
         VALUES (?,?,?,?,?,?,?,0,?)`,
        supplierId, user.id,
        `Ajuste de preços: ${direcao} de ${pct}%`,
        'ajuste', Number(antes.n) || 0, Number(antes.n) || 0, Number(antes.n) || 0, nowIso(),
      );
      return r.changes;
    });

    const depois = estatisticas(supplierId);
    audit(user.id, 'product.adjust', 'suppliers', supplierId, `${direcao} ${pct}% em ${alterados} item(ns)`);

    const msg = `${alterados} produto(s) reajustado(s). Soma dos preços: ${fmtMoney(antes.soma)} → ${fmtMoney(depois.soma)}.`;
    return redirect(`/produtos?fornecedor=${supplierId}&msg=${encodeURIComponent(msg)}`);
  });

  routeGet('/produtos/:id/editar', (ctx) => {
    requireUser(ctx);
    const product = getProduct(Number(ctx.params.id));
    if (!product) throw new HttpError(404, 'Produto não encontrado.');
    return produtoForm(ctx, { product });
  });

  post('/produtos', (ctx) => {
    const user = requireUser(ctx);
    const description = str(ctx.fields.description).trim();
    const supplierId = Number(str(ctx.fields.supplier_id));
    if (!description) return produtoForm(ctx, { values: ctx.fields, error: 'Informe a descrição.' });
    if (!supplierId) return produtoForm(ctx, { values: ctx.fields, error: 'Selecione o fornecedor.' });

    const r = run(
      `INSERT INTO products (supplier_id, internal_code, description, unit_price, brand, stock,
         manufacturer_code, ean, reference, ncm, unit, active, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      supplierId, str(ctx.fields.internal_code) || null, description, num(ctx.fields.unit_price, 0),
      str(ctx.fields.brand) || null, num(ctx.fields.stock, 0), str(ctx.fields.manufacturer_code) || null,
      str(ctx.fields.ean) || null, str(ctx.fields.reference) || null, str(ctx.fields.ncm) || null,
      str(ctx.fields.unit) || 'UN', nowIso(),
    );
    audit(user.id, 'product.create', 'products', r.lastId, description);
    return redirect(`/produtos?msg=${encodeURIComponent('Produto cadastrado.')}`);
  });

  post('/produtos/:id', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const product = getProduct(id);
    if (!product) throw new HttpError(404, 'Produto não encontrado.');

    const description = str(ctx.fields.description).trim();
    const supplierId = Number(str(ctx.fields.supplier_id));
    if (!description) return produtoForm(ctx, { product, values: ctx.fields, error: 'Informe a descrição.' });
    if (!supplierId) return produtoForm(ctx, { product, values: ctx.fields, error: 'Selecione o fornecedor.' });

    run(
      `UPDATE products SET supplier_id=?, internal_code=?, description=?, unit_price=?, brand=?,
         stock=?, manufacturer_code=?, ean=?, reference=?, ncm=?, unit=?, active=1, updated_at=?
       WHERE id=?`,
      supplierId, str(ctx.fields.internal_code) || null, description, num(ctx.fields.unit_price, 0),
      str(ctx.fields.brand) || null, num(ctx.fields.stock, 0), str(ctx.fields.manufacturer_code) || null,
      str(ctx.fields.ean) || null, str(ctx.fields.reference) || null, str(ctx.fields.ncm) || null,
      str(ctx.fields.unit) || 'UN', nowIso(), id,
    );
    audit(user.id, 'product.update', 'products', id, description);
    return redirect(`/produtos?msg=${encodeURIComponent('Produto atualizado.')}`);
  });

  post('/produtos/:id/excluir', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const p = getProduct(id);
    run('UPDATE products SET active = 0 WHERE id = ?', id);
    audit(user.id, 'product.delete', 'products', id, p?.description || null);
    return redirect(`/produtos?msg=${encodeURIComponent('Produto removido do catálogo.')}`);
  });

  // busca rapida em JSON (usada pelo seletor de produtos do orcamento)
  routeGet('/api/produtos', (ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams.get('q') || '';
    if (q.trim().length < 2) return { type: 'json', data: [] };
    const rows = searchProducts({ q, limit: 15 });
    return {
      type: 'json',
      data: rows.map((p) => ({
        id: p.id,
        description: p.description,
        supplier: p.supplier_name,
        price: p.unit_price,
        stock: p.stock,
        code: p.internal_code,
        ean: p.ean,
      })),
    };
  });
}

// ---------------------------------------------------------------- auxiliares
function letra(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function findTmp(token) {
  if (!token) return null;
  for (const ext of ['.xlsx', '.csv', '.txt']) {
    const p = path.join(TMP_DIR, `${token}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  const dir = fs.existsSync(TMP_DIR) ? fs.readdirSync(TMP_DIR) : [];
  const match = dir.find((f) => f.startsWith(token));
  return match ? path.join(TMP_DIR, match) : null;
}
