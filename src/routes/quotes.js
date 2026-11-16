import { get as routeGet, post, str, num, htmlPage, redirect, HttpError, download } from '../web.js';
import { requireUser } from '../auth.js';
import { get, run, all, nowIso, audit, setting, tx } from '../db.js';
import {
  listQuotes, getQuote, loadQuote, quoteItems, quoteExpenses, updateQuoteTotals,
  listProjects, getProject, projectQuotes, listClients, listSuppliers, ownSupplier,
  searchProducts, getProduct, matchingOffers, getClient, getSupplier, dashboardStats,
} from '../repo.js';
import { buildQuoteWorkbook, buildComparisonWorkbook } from '../exporter.js';
import { fmtMoney, fmtQty, fmtPct } from '../calc.js';
import {
  layout, esc, field, select, textarea, card, pageHeader, button, csrfField,
  badge, emptyState, flash, statusBadge,
} from '../ui.js';

function render(ctx, title, body, wide = false) {
  return htmlPage(layout(ctx, { title, body, wide }));
}

const brNum = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brQty = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function touch(quoteId) {
  updateQuoteTotals(quoteId);
}

// ---------------------------------------------------------------- painel
export function registerQuoteRoutes() {
  routeGet('/', (ctx) => {
    const user = requireUser(ctx);
    const stats = dashboardStats();
    const recent = listQuotes({ limit: 6 });
    const rows = recent.map((q) => `<tr>
      <td class="strong"><a href="/orcamentos/${q.id}">${esc(q.title)}</a></td>
      <td class="small">${esc(q.client_name)}</td>
      <td>${statusBadge(q.status)}</td>
      <td class="num strong">${fmtMoney(q.total_cache)}</td>
      <td class="small muted nowrap">${esc(new Date(q.created_at).toLocaleDateString('pt-BR'))}</td>
    </tr>`).join('');

    return render(ctx, 'Painel', `
      ${pageHeader({
        title: `Olá, ${user.name.split(' ')[0]}`,
        subtitle: 'Resumo da operação e atalhos.',
        actions: `<a class="btn primary" href="/orcamentos/novo">Novo orçamento</a>
                  <a class="btn" href="/fornecedores">Enviar planilha</a>`,
      })}
      ${flash(ctx)}
      <div class="stats">
        <div class="stat"><div class="label">Orçamentos</div><div class="value">${stats.quotes}</div><div class="hint">${stats.approved} aprovado(s)</div></div>
        <div class="stat"><div class="label">Valor em carteira</div><div class="value" style="font-size:19px">${fmtMoney(stats.total)}</div><div class="hint">soma dos orçamentos</div></div>
        <div class="stat"><div class="label">Clientes</div><div class="value">${stats.clients}</div><div class="hint"><a href="/clientes">gerenciar</a></div></div>
        <div class="stat"><div class="label">Produtos</div><div class="value">${stats.products}</div><div class="hint">${stats.suppliers} fornecedor(es)</div></div>
      </div>
      ${card('Orçamentos recentes', recent.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Orçamento</th><th>Cliente</th><th>Situação</th><th class="num">Total</th><th>Criado</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : emptyState('Nenhum orçamento ainda. Comece cadastrando um cliente e um fornecedor.', `<a class="btn primary" href="/orcamentos/novo">Criar primeiro orçamento</a>`), { flush: true })}
    `);
  });

  // ---------------------------------------------------------------- projetos
  routeGet('/projetos', (ctx) => {
    requireUser(ctx);
    const projects = listProjects();
    const rows = projects.map((p) => `<tr>
      <td class="strong"><a href="/projetos/${p.id}">${esc(p.name)}</a></td>
      <td class="small">${esc(p.client_name)}</td>
      <td class="center">${p.quotes_count}</td>
      <td class="num">${fmtMoney(p.total)}</td>
      <td class="right nowrap">
        <a class="btn sm" href="/projetos/${p.id}/exportar.xlsx">Consolidado</a>
        <a class="btn sm" href="/projetos/${p.id}">Abrir</a>
      </td>
    </tr>`).join('');

    const clientOpts = listClients().map((c) => ({ value: c.id, label: c.name }));

    return render(ctx, 'Projetos', `
      ${pageHeader({
        title: 'Projetos',
        subtitle: 'Agrupe orçamentos do mesmo cliente (ex.: escolas de um mesmo edital) para gerar a planilha consolidada.',
      })}
      ${flash(ctx)}
      <div class="grid-2">
        <div>${card(null, projects.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Projeto</th><th>Cliente</th><th class="center">Orçamentos</th><th class="num">Total</th><th></th></tr></thead>
              <tbody>${rows}</tbody></table></div>`
          : emptyState('Nenhum projeto criado.'), { flush: true })}</div>
        <div>${card('Novo projeto', `
          <form method="post" action="/projetos">
            ${csrfField(ctx)}
            ${field({ label: 'Nome do projeto', name: 'name', required: true, placeholder: 'ex.: Projetos Escolas 10/2026' })}
            ${select({ label: 'Cliente', name: 'client_id', options: [{ value: '', label: '— selecione —' }].concat(clientOpts), required: true })}
            ${field({ label: 'Código / referência', name: 'code' })}
            ${textarea({ label: 'Observações', name: 'notes', rows: 2 })}
            <div class="form-actions">${button('Criar projeto', { kind: 'primary' })}</div>
          </form>
        `)}</div>
      </div>
    `);
  });

  post('/projetos', (ctx) => {
    const user = requireUser(ctx);
    const name = str(ctx.fields.name).trim();
    const clientId = Number(str(ctx.fields.client_id));
    if (!name || !clientId) return redirect(`/projetos?err=${encodeURIComponent('Informe nome e cliente.')}`);
    const r = run(
      'INSERT INTO projects (client_id, name, code, notes, created_at) VALUES (?,?,?,?,?)',
      clientId, name, str(ctx.fields.code), str(ctx.fields.notes), nowIso(),
    );
    audit(user.id, 'project.create', 'projects', r.lastId, name);
    return redirect(`/projetos/${r.lastId}?msg=${encodeURIComponent('Projeto criado.')}`);
  });

  routeGet('/projetos/:id', (ctx) => {
    requireUser(ctx);
    const project = getProject(Number(ctx.params.id));
    if (!project) throw new HttpError(404, 'Projeto não encontrado.');
    const quotes = projectQuotes(project.id);
    const total = quotes.reduce((s, q) => s + (q.total_cache || 0), 0);

    const rows = quotes.map((q) => `<tr>
      <td class="strong"><a href="/orcamentos/${q.id}">${esc(q.title)}</a></td>
      <td>${statusBadge(q.status)}</td>
      <td class="num">${fmtMoney(q.total_cache)}</td>
      <td class="right nowrap">
        <a class="btn sm" href="/orcamentos/${q.id}">Abrir</a>
        <a class="btn sm" href="/orcamentos/${q.id}/exportar.xlsx">XLSX</a>
      </td>
    </tr>`).join('');

    return render(ctx, project.name, `
      ${pageHeader({
        title: project.name,
        subtitle: `${esc(project.client_name)}${project.code ? ` · ${esc(project.code)}` : ''}`,
        back: { href: '/projetos', label: 'Projetos' },
        actions: `<a class="btn primary" href="/orcamentos/novo?project=${project.id}">Novo orçamento no projeto</a>
                  <a class="btn" href="/projetos/${project.id}/exportar.xlsx">Planilha consolidada</a>`,
      })}
      ${flash(ctx)}
      ${card(`${quotes.length} orçamento(s) · ${fmtMoney(total)}`, quotes.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Unidade / Título</th><th>Situação</th><th class="num">Total</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="total"><td colspan="2">Total do projeto</td><td class="num">${fmtMoney(total)}</td><td></td></tr></tfoot>
          </table></div>`
        : emptyState('Nenhum orçamento neste projeto ainda.'), { flush: true })}
    `);
  });

  routeGet('/projetos/:id/exportar.xlsx', (ctx) => {
    requireUser(ctx);
    const project = getProject(Number(ctx.params.id));
    if (!project) throw new HttpError(404, 'Projeto não encontrado.');
    const quotes = projectQuotes(project.id);
    if (!quotes.length) throw new HttpError(400, 'O projeto não possui orçamentos.');

    const blocks = quotes.map((q) => {
      const full = loadQuote(q.id);
      return { quote: full.quote, items: full.items, expenses: full.expenses, calc: full.calc };
    });
    const client = getClient(project.client_id);
    const emitter = getSupplier(quotes[0].supplier_id) || ownSupplier();

    const result = buildQuoteWorkbook({ quotes: blocks, client, emitter, opts: { includeSummary: true } });
    return download(result.filename, result.buffer);
  });

  post('/projetos/:id/excluir', (ctx) => {
    requireUser(ctx);
    const id = Number(ctx.params.id);
    run('UPDATE quotes SET project_id = NULL WHERE project_id = ?', id);
    run('DELETE FROM projects WHERE id = ?', id);
    return redirect(`/projetos?msg=${encodeURIComponent('Projeto excluído. Os orçamentos foram mantidos.')}`);
  });

  // ---------------------------------------------------------------- lista
  routeGet('/orcamentos', (ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams.get('q') || '';
    const status = ctx.url.searchParams.get('status') || '';
    const quotes = listQuotes({ q, status, limit: 300 });
    const total = quotes.reduce((s, x) => s + (x.total_cache || 0), 0);

    const rows = quotes.map((x) => `<tr>
      <td class="strong"><a href="/orcamentos/${x.id}">${esc(x.title)}</a>
        <div class="small muted">${esc(x.project_name || 'sem projeto')}</div></td>
      <td class="small">${esc(x.client_name)}</td>
      <td>${statusBadge(x.status)}</td>
      <td class="num">${fmtMoney(x.total_cache)}</td>
      <td class="small muted nowrap">${esc(new Date(x.created_at).toLocaleDateString('pt-BR'))}</td>
      <td class="right nowrap">
        <a class="btn sm" href="/orcamentos/${x.id}">Abrir</a>
        <a class="btn sm" href="/orcamentos/${x.id}/exportar.xlsx">XLSX</a>
      </td>
    </tr>`).join('');

    return render(ctx, 'Orçamentos', `
      ${pageHeader({
        title: 'Orçamentos',
        subtitle: `${quotes.length} orçamento(s) · ${fmtMoney(total)} em propostas`,
        actions: button('Novo orçamento', { href: '/orcamentos/novo' }),
      })}
      ${flash(ctx)}
      ${card(null, `
        <form method="get" action="/orcamentos" class="inline" style="margin-bottom:16px">
          <label class="field" style="flex:2;min-width:200px"><span>Buscar</span>
            <input type="search" name="q" value="${esc(q)}" placeholder="título, cliente ou código"></label>
          <label class="field" style="flex:1;min-width:150px"><span>Situação</span>
            <select name="status">
              <option value="">Todas</option>
              ${[['draft', 'Rascunho'], ['sent', 'Enviado'], ['approved', 'Aprovado'], ['rejected', 'Recusado']]
                .map(([v, l]) => `<option value="${v}"${status === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select></label>
          ${button('Filtrar', { kind: 'soft' })}
        </form>
        ${quotes.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Orçamento</th><th>Cliente</th><th>Situação</th><th class="num">Total</th><th>Criado</th><th></th></tr></thead>
              <tbody>${rows}</tbody></table></div>`
          : emptyState('Nenhum orçamento encontrado.')}
      `, { flush: quotes.length > 0 })}
    `);
  });

  // ---------------------------------------------------------------- novo
  routeGet('/orcamentos/novo', (ctx) => {
    requireUser(ctx);
    const projectId = Number(ctx.url.searchParams.get('project') || 0) || null;
    const project = projectId ? getProject(projectId) : null;
    const clients = listClients().map((c) => ({ value: c.id, label: c.name }));
    const suppliers = listSuppliers(true).map((s) => ({ value: s.id, label: `${s.name}${s.is_own ? ' (emitente)' : ''}` }));
    const own = ownSupplier();

    return render(ctx, 'Novo orçamento', `
      ${pageHeader({ title: 'Novo orçamento', back: { href: '/orcamentos', label: 'Orçamentos' } })}
      ${card(null, `
        <form method="post" action="/orcamentos">
          ${csrfField(ctx)}
          <input type="hidden" name="project_id" value="${project ? project.id : ''}">
          <div class="form-grid">
            ${field({ label: 'Título / unidade', name: 'title', required: true, placeholder: 'ex.: EMEB Bela Vista', hint: 'Aparece no nome da aba da planilha.' })}
            ${select({ label: 'Cliente', name: 'client_id', required: true, value: project?.client_id || '', options: [{ value: '', label: '— selecione —' }].concat(clients) })}
            ${field({ label: 'Local / projeto', name: 'location', placeholder: 'ex.: Redes, Elétrica e CFTV - EMEB BELA VISTA' })}
            ${select({ label: 'Empresa emitente', name: 'supplier_id', value: own?.id || '', options: suppliers })}
            ${field({ label: 'Margem sobre o custo (%)', name: 'margin_pct', type: 'number', step: '0.01', value: setting('default_margin_pct') })}
            ${select({ label: 'Forma de cálculo', name: 'margin_mode', value: setting('default_margin_mode'), options: [{ value: 'markup', label: 'Acréscimo sobre o custo (markup)' }, { value: 'margin', label: 'Margem sobre o preço de venda' }] })}
            ${field({ label: 'Serviço de instalação (%)', name: 'service_pct', type: 'number', step: '0.01', value: setting('default_service_pct'), hint: 'Percentual sobre o total de produtos. Use 0 se não houver serviço.' })}
            ${field({ label: 'Validade (dias)', name: 'valid_days', type: 'number', value: setting('default_valid_days') })}
          </div>
          <div class="form-actions">
            ${button('Criar e adicionar produtos', { kind: 'primary' })}
            ${button('Cancelar', { kind: 'ghost', href: '/orcamentos' })}
          </div>
        </form>
      `)}
    `);
  });

  post('/orcamentos', (ctx) => {
    const user = requireUser(ctx);
    const title = str(ctx.fields.title).trim();
    const clientId = Number(str(ctx.fields.client_id));
    if (!title || !clientId) return redirect(`/orcamentos/novo?err=${encodeURIComponent('Informe título e cliente.')}`);
    const projectId = Number(str(ctx.fields.project_id)) || null;
    const supplierId = Number(str(ctx.fields.supplier_id)) || ownSupplier()?.id || null;

    const r = run(
      `INSERT INTO quotes (code, project_id, client_id, supplier_id, title, location, status,
        margin_pct, margin_mode, service_pct, service_description, valid_days, created_by, created_at)
       VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?)`,
      null, projectId, clientId, supplierId, title, str(ctx.fields.location),
      num(ctx.fields.margin_pct, 0), str(ctx.fields.margin_mode) === 'margin' ? 'margin' : 'markup',
      num(ctx.fields.service_pct, 0), null, num(ctx.fields.valid_days, 15), user.id, nowIso(),
    );
    run('UPDATE quotes SET code = ? WHERE id = ?', `ORC-${String(r.lastId).padStart(4, '0')}`, r.lastId);
    audit(user.id, 'quote.create', 'quotes', r.lastId, title);
    return redirect(`/orcamentos/${r.lastId}?msg=${encodeURIComponent('Orçamento criado. Adicione os produtos.')}`);
  });

  // ---------------------------------------------------------------- editor
  routeGet('/orcamentos/:id', (ctx) => {
    requireUser(ctx);
    const full = loadQuote(Number(ctx.params.id));
    if (!full) throw new HttpError(404, 'Orçamento não encontrado.');
    const { quote, items, calc, offers, client, project } = full;

    const busca = ctx.url.searchParams.get('busca') || '';
    const results = busca.trim().length >= 2 ? searchProducts({ q: busca, limit: 12 }) : [];

    const itemRows = items.map((it, i) => {
      const offersForItem = offers.get(it.id) || [];
      const cheapest = offersForItem.length ? Math.min(...offersForItem.map((o) => Number(o.unit_cost))) : null;
      const optionList = offersForItem.length
        ? offersForItem.map((o) => `<option value="${o.supplier_id}" data-cost="${brNum(o.unit_cost)}"${o.supplier_id === it.supplier_id ? ' selected' : ''}>${esc(o.supplier_name)} — ${brNum(o.unit_cost)}</option>`).join('')
        : `<option value="${it.supplier_id || ''}">${esc(it.supplier_name || 'manual')}</option>`;
      const line = calc.lines[i];
      const melhor = offersForItem.length > 1
        ? (Number(it.unit_cost) <= cheapest + 0.001 ? '<span class="offer-best">melhor</span>' : `<span class="offer-bad">+${brNum(Number(it.unit_cost) - cheapest)}</span>`)
        : '';

      return `<tr>
        <td class="center small muted">${i + 1}</td>
        <td class="small mono">${esc(it.internal_code || '—')}</td>
        <td class="desc">${esc(it.description)}
          <div class="small muted">${[it.brand, it.ean ? `EAN ${it.ean}` : null].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td>${offersForItem.length > 1
          ? `<select name="f${it.id}" data-offers>${optionList}</select>`
          : `<span class="small muted">${esc(it.supplier_name || 'manual')}</span><input type="hidden" name="f${it.id}" value="${it.supplier_id || ''}">`}
          ${melhor}</td>
        <td><input class="qty" type="text" name="q${it.id}" value="${brQty(it.qty)}" data-autosave></td>
        <td><input type="text" name="c${it.id}" value="${brNum(it.unit_cost)}" data-money style="text-align:right"></td>
        <td class="num">${brNum(line.unit_price)}</td>
        <td class="num strong">${brNum(line.line_total)}</td>
        <td class="center">
          <button class="btn sm danger" form="del-${it.id}" title="Remover item">✕</button>
        </td>
      </tr>`;
    }).join('');

    const deleteForms = items.map((it) => `<form id="del-${it.id}" method="post" action="/orcamentos/${quote.id}/itens/${it.id}/excluir" data-confirm="Remover este item?">${csrfField(ctx)}</form>`).join('');

    const resultRows = results.map((p) => `<tr>
      <td class="small mono">${esc(p.internal_code || '—')}</td>
      <td class="small">${esc(p.description)}<div class="small muted">${esc(p.supplier_name)}${p.brand ? ` · ${esc(p.brand)}` : ''}${p.stock ? ` · est. ${brQty(p.stock)}` : ''}</div></td>
      <td class="num small">${brNum(p.unit_price)}</td>
      <td class="center" style="width:110px">
        <form method="post" action="/orcamentos/${quote.id}/itens" class="inline" style="gap:6px">
          ${csrfField(ctx)}
          <input type="hidden" name="product_id" value="${p.id}">
          <input type="text" name="qty" value="1" style="width:56px;padding:5px 6px;border:1px solid #cfdae9;border-radius:6px;text-align:center;font:inherit">
          <button class="btn sm primary">+</button>
        </form>
      </td>
    </tr>`).join('');

    const expenseRows = calc.expenseLines.map((e) => `<tr>
      <td class="small">${esc(e.description)}</td>
      <td class="small muted">${e.kind === 'fixed' ? 'valor fixo' : `${brNum(e.value)}% ${e.base === 'services' ? 's/ serviço' : e.base === 'total' ? 's/ total' : 's/ produtos'}`}</td>
      <td class="num">${brNum(e.amount)}</td>
      <td class="center"><button class="btn sm danger" form="delexp-${e.id}" title="Remover">✕</button></td>
    </tr>`).join('');

    const delExpForms = calc.expenseLines.map((e) => `<form id="delexp-${e.id}" method="post" action="/orcamentos/${quote.id}/despesas/${e.id}/excluir">${csrfField(ctx)}</form>`).join('');

    const body = `
      ${pageHeader({
        title: quote.title,
        subtitle: `${esc(client?.name || '')}${project ? ` · <a href="/projetos/${project.id}">${esc(project.name)}</a>` : ''} ${statusBadge(quote.status)}`,
        back: { href: '/orcamentos', label: 'Orçamentos' },
        actions: `<a class="btn primary" href="/orcamentos/${quote.id}/exportar.xlsx">Gerar planilha</a>
                  <a class="btn" href="/orcamentos/${quote.id}/comparativo.xlsx">Comparativo</a>
                  <a class="btn" href="/orcamentos/${quote.id}/imprimir">Imprimir</a>
                  <form class="inline-form" method="post" action="/orcamentos/${quote.id}/duplicar">${csrfField(ctx)}<button class="btn" title="Duplicar cabeçalho e itens">Duplicar</button></form>`,
      })}
      ${flash(ctx)}
      <div class="quote-layout">
        <div>
          ${card('Itens do orçamento', `
            ${items.length ? `<form method="post" action="/orcamentos/${quote.id}/itens/salvar">
              ${csrfField(ctx)}
              <div class="table-wrap"><table class="items-table">
                <thead><tr>
                  <th class="center" style="width:38px">#</th><th style="width:70px">Código</th>
                  <th>Descrição</th><th style="width:190px">Fornecedor</th>
                  <th class="center" style="width:80px">Qtd</th><th style="width:110px" class="num">Custo unit.</th>
                  <th class="num" style="width:100px">Preço unit.</th><th class="num" style="width:110px">Total</th><th style="width:40px"></th>
                </tr></thead>
                <tbody>${itemRows}</tbody>
              </table></div>
              <div class="form-actions">${button('Salvar alterações nos itens', { kind: 'primary' })}</div>
            </form>${deleteForms}` : emptyState('Nenhum item ainda. Use a busca abaixo para adicionar produtos.')}
          `, { flush: items.length > 0 })}

          ${card('Adicionar produtos', `
            <form method="get" action="/orcamentos/${quote.id}" class="inline" style="margin-bottom:14px">
              <label class="field" style="flex:1;min-width:220px"><span>Buscar no catálogo (descrição, código, EAN)</span>
                <input type="search" name="busca" value="${esc(busca)}" placeholder="ex.: cabo, eletrocalha, 6881" autofocus></label>
              ${button('Buscar', { kind: 'soft' })}
            </form>
            ${results.length ? `<div class="search-results"><table>
              <thead><tr><th>Código</th><th>Produto</th><th class="num">Custo</th><th class="center">Adicionar</th></tr></thead>
              <tbody>${resultRows}</tbody></table></div>`
              : busca.trim().length >= 2 ? emptyState('Nada encontrado. Verifique se a planilha do fornecedor foi importada.') : ''}
            <hr class="sep">
            <details>
              <summary class="small" style="cursor:pointer;font-weight:600">Adicionar item manual (fora do catálogo)</summary>
              <form method="post" action="/orcamentos/${quote.id}/itens" style="margin-top:12px">
                ${csrfField(ctx)}
                <input type="hidden" name="manual" value="1">
                <div class="form-grid three">
                  ${field({ label: 'Código', name: 'internal_code' })}
                  ${field({ label: 'Descrição', name: 'description', required: true, className: 'span2' })}
                  ${field({ label: 'Quantidade', name: 'qty', value: '1' })}
                  ${field({ label: 'Custo unitário', name: 'unit_cost', value: '0,00' })}
                  ${button('Adicionar item manual', { kind: 'soft' })}
                </div>
              </form>
            </details>
          `)}
        </div>

        <div class="side-panel">
          ${card('Parâmetros', `
            <form method="post" action="/orcamentos/${quote.id}/parametros">
              ${csrfField(ctx)}
              ${field({ label: 'Margem (%)', name: 'margin_pct', type: 'number', step: '0.01', value: quote.margin_pct })}
              ${select({ label: 'Forma de cálculo', name: 'margin_mode', value: quote.margin_mode, options: [{ value: 'markup', label: 'Acréscimo sobre o custo' }, { value: 'margin', label: 'Margem sobre a venda' }] })}
              ${field({ label: 'Serviço de instalação (%)', name: 'service_pct', type: 'number', step: '0.01', value: quote.service_pct })}
              ${field({ label: 'Arredondar preço (R$)', name: 'rounding', type: 'number', step: '0.01', value: quote.rounding, hint: '0 = sem arredondamento. Ex.: 0,10 sobe para o próximo décimo.' })}
              ${field({ label: 'Validade (dias)', name: 'valid_days', type: 'number', value: quote.valid_days })}
              ${select({ label: 'Situação', name: 'status', value: quote.status, options: [{ value: 'draft', label: 'Rascunho' }, { value: 'sent', label: 'Enviado' }, { value: 'approved', label: 'Aprovado' }, { value: 'rejected', label: 'Recusado' }] })}
              <div class="form-actions">${button('Aplicar', { kind: 'primary', small: true })}</div>
            </form>
          `)}

          ${card('Resumo', `
            <div class="summary"><dl>
              <div class="row"><span>Custo dos produtos</span><span>${fmtMoney(calc.costTotal)}</span></div>
              <div class="row"><span>Produtos (venda)</span><span>${fmtMoney(calc.productsTotal)}</span></div>
              <div class="row"><span>Serviços (${fmtPct(calc.servicePct)})</span><span>${fmtMoney(calc.serviceValue)}</span></div>
              ${calc.expenseLines.map((e) => `<div class="row"><span>${esc(e.description)}</span><span>${fmtMoney(e.amount)}</span></div>`).join('')}
              <div class="row total"><span>Total</span><span>${fmtMoney(calc.total)}</span></div>
              <div class="row"><span>Lucro bruto</span><span style="color:var(--ok)">${fmtMoney(calc.profit)}</span></div>
              <div class="row"><span>Margem efetiva</span><span>${fmtPct(calc.effectiveMargin)}</span></div>
              <div class="row"><span>Markup real</span><span>${fmtPct(calc.markupReal)}</span></div>
              <div class="row"><span>Itens</span><span>${calc.itemCount}</span></div>
            </dl></div>
          `)}

          ${card('Outras despesas', `
            ${expenseRows ? `<div class="table-wrap"><table style="font-size:12.5px">
              <thead><tr><th>Descrição</th><th>Base</th><th class="num">Valor</th><th></th></tr></thead>
              <tbody>${expenseRows}</tbody></table></div>${delExpForms}<hr class="sep">` : ''}
            <form method="post" action="/orcamentos/${quote.id}/despesas">
              ${csrfField(ctx)}
              <div class="field" style="margin-bottom:8px"><span>Descrição</span>
                <input type="text" name="description" placeholder="Frete, ICMS, mão de obra..." required></div>
              <div class="form-grid" style="gap:8px">
                <div class="field"><span>Tipo</span>
                  <select name="kind"><option value="percent">Percentual</option><option value="fixed">Valor fixo</option></select></div>
                <div class="field"><span>Valor</span>
                  <input type="text" name="value" value="0,00"></div>
              </div>
              <div class="field" style="margin-top:8px"><span>Incide sobre</span>
                <select name="base">
                  <option value="products">Produtos</option>
                  <option value="services">Serviços</option>
                  <option value="total">Total acumulado</option>
                </select></div>
              <div class="form-actions">${button('Adicionar despesa', { kind: 'soft', small: true })}</div>
            </form>
          `)}
        </div>
      </div>

      ${card('Dados da proposta', `
        <form method="post" action="/orcamentos/${quote.id}/cabecalho">
          ${csrfField(ctx)}
          <div class="form-grid">
            ${field({ label: 'Título / unidade', name: 'title', value: quote.title, required: true })}
            ${field({ label: 'Local / projeto', name: 'location', value: quote.location || '' })}
            ${select({ label: 'Cliente', name: 'client_id', value: quote.client_id, options: listClients().map((c) => ({ value: c.id, label: c.name })) })}
            ${select({ label: 'Projeto', name: 'project_id', value: quote.project_id || '', options: [{ value: '', label: '— sem projeto —' }].concat(listProjects().map((p) => ({ value: p.id, label: p.name }))) })}
            ${field({ label: 'Código do serviço', name: 'service_code', value: quote.service_code || 'SERV-01' })}
            ${field({ label: 'Descrição do serviço', name: 'service_description', value: quote.service_description || '', className: 'span2' })}
            ${textarea({ label: 'Observações (uma por linha — substitui o texto padrão)', name: 'observations', value: quote.observations || '', rows: 4, className: 'span2' })}
          </div>
          <div class="form-actions">
            ${button('Salvar dados', { kind: 'primary' })}
            <span style="flex:1"></span>
            <button class="btn danger" form="del-quote" data-confirm="Excluir este orçamento definitivamente?">Excluir orçamento</button>
          </div>
        </form>
        <form id="del-quote" method="post" action="/orcamentos/${quote.id}/excluir">${csrfField(ctx)}</form>
      `)}
    `;

    return render(ctx, quote.title, body, true);
  });

  post('/orcamentos/:id/cabecalho', (ctx) => {
    requireUser(ctx);
    const id = Number(ctx.params.id);
    run(
      `UPDATE quotes SET title=?, location=?, client_id=?, project_id=?, service_code=?,
        service_description=?, observations=?, updated_at=? WHERE id=?`,
      str(ctx.fields.title), str(ctx.fields.location), Number(str(ctx.fields.client_id)) || null,
      Number(str(ctx.fields.project_id)) || null, str(ctx.fields.service_code) || 'SERV-01',
      str(ctx.fields.service_description) || null, str(ctx.fields.observations) || null, nowIso(), id,
    );
    return redirect(`/orcamentos/${id}?msg=${encodeURIComponent('Dados atualizados.')}`);
  });

  post('/orcamentos/:id/parametros', (ctx) => {
    requireUser(ctx);
    const id = Number(ctx.params.id);
    run(
      `UPDATE quotes SET margin_pct=?, margin_mode=?, service_pct=?, rounding=?, valid_days=?, status=?, updated_at=? WHERE id=?`,
      num(ctx.fields.margin_pct, 0), str(ctx.fields.margin_mode) === 'margin' ? 'margin' : 'markup',
      num(ctx.fields.service_pct, 0), num(ctx.fields.rounding, 0), num(ctx.fields.valid_days, 15),
      str(ctx.fields.status) || 'draft', nowIso(), id,
    );
    touch(id);
    return redirect(`/orcamentos/${id}?msg=${encodeURIComponent('Parâmetros aplicados.')}`);
  });

  post('/orcamentos/:id/itens/salvar', (ctx) => {
    requireUser(ctx);
    const id = Number(ctx.params.id);
    const items = quoteItems(id);
    for (const it of items) {
      const qtyRaw = str(ctx.fields[`q${it.id}`]);
      const costRaw = str(ctx.fields[`c${it.id}`]);
      const supplierRaw = str(ctx.fields[`f${it.id}`]);
      const qty = qtyRaw === '' ? it.qty : num(qtyRaw, it.qty);
      let supplierId = supplierRaw === '' ? it.supplier_id : Number(supplierRaw) || null;
      let cost = costRaw === '' ? it.unit_cost : num(costRaw, it.unit_cost);

      if (supplierId && supplierId !== it.supplier_id) {
        const offer = get(
          'SELECT unit_cost FROM quote_item_offers WHERE item_id = ? AND supplier_id = ? LIMIT 1',
          it.id, supplierId,
        );
        if (offer) cost = offer.unit_cost;
      }
      run('UPDATE quote_items SET qty = ?, unit_cost = ?, supplier_id = ? WHERE id = ?', qty, cost, supplierId, it.id);
    }
    touch(id);
    return redirect(`/orcamentos/${id}?msg=${encodeURIComponent('Itens atualizados.')}`);
  });

  post('/orcamentos/:id/itens', (ctx) => {
    const user = requireUser(ctx);
    const quoteId = Number(ctx.params.id);
    const qty = num(ctx.fields.qty, 1) || 1;
    const manual = str(ctx.fields.manual) === '1';

    if (manual) {
      const description = str(ctx.fields.description).trim();
      if (!description) return redirect(`/orcamentos/${quoteId}?err=${encodeURIComponent('Informe a descrição.')}`);
      const pos = Number(get('SELECT COALESCE(MAX(position),0) AS p FROM quote_items WHERE quote_id = ?', quoteId)?.p || 0) + 1;
      run(
        `INSERT INTO quote_items (quote_id, position, internal_code, description, qty, unit_cost, supplier_id, unit)
         VALUES (?,?,?,?,?,?,?,?)`,
        quoteId, pos, str(ctx.fields.internal_code) || null, description, qty,
        num(ctx.fields.unit_cost, 0), null, 'UN',
      );
      touch(quoteId);
      return redirect(`/orcamentos/${quoteId}?msg=${encodeURIComponent('Item adicionado.')}`);
    }

    const productId = Number(str(ctx.fields.product_id));
    const product = getProduct(productId);
    if (!product) return redirect(`/orcamentos/${quoteId}?err=${encodeURIComponent('Produto não encontrado.')}`);

    tx(() => {
      const pos = Number(get('SELECT COALESCE(MAX(position),0) AS p FROM quote_items WHERE quote_id = ?', quoteId)?.p || 0) + 1;
      const r = run(
        `INSERT INTO quote_items (quote_id, position, internal_code, description, qty, unit_cost, product_id, supplier_id, unit)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        quoteId, pos, product.internal_code, product.description, qty, product.unit_price,
        product.id, product.supplier_id, product.unit || 'UN',
      );
      const itemId = r.lastId;

      run(
        `INSERT INTO quote_item_offers (item_id, supplier_id, product_id, unit_cost, stock, brand)
         VALUES (?,?,?,?,?,?)`,
        itemId, product.supplier_id, product.id, product.unit_price, product.stock, product.brand,
      );

      for (const alt of matchingOffers(product)) {
        run(
          `INSERT INTO quote_item_offers (item_id, supplier_id, product_id, unit_cost, stock, brand)
           VALUES (?,?,?,?,?,?)`,
          itemId, alt.supplier_id, alt.product_id, alt.unit_price, alt.stock, alt.brand,
        );
      }
    });

    audit(user.id, 'quote.item.add', 'quotes', quoteId, product.description);
    touch(quoteId);
    return redirect(`/orcamentos/${quoteId}?msg=${encodeURIComponent('Produto adicionado.')}&busca=${encodeURIComponent('')}`);
  });

  post('/orcamentos/:id/itens/:itemId/excluir', (ctx) => {
    requireUser(ctx);
    const quoteId = Number(ctx.params.id);
    run('DELETE FROM quote_items WHERE id = ? AND quote_id = ?', Number(ctx.params.itemId), quoteId);
    touch(quoteId);
    return redirect(`/orcamentos/${quoteId}?msg=${encodeURIComponent('Item removido.')}`);
  });

  post('/orcamentos/:id/despesas', (ctx) => {
    requireUser(ctx);
    const quoteId = Number(ctx.params.id);
    const description = str(ctx.fields.description).trim() || 'Despesa';
    const pos = Number(get('SELECT COALESCE(MAX(position),0) AS p FROM quote_expenses WHERE quote_id = ?', quoteId)?.p || 0) + 1;
    run(
      'INSERT INTO quote_expenses (quote_id, description, kind, value, base, position) VALUES (?,?,?,?,?,?)',
      quoteId, description, str(ctx.fields.kind) === 'fixed' ? 'fixed' : 'percent',
      num(ctx.fields.value, 0), str(ctx.fields.base) || 'products', pos,
    );
    touch(quoteId);
    return redirect(`/orcamentos/${quoteId}?msg=${encodeURIComponent('Despesa adicionada.')}`);
  });

  post('/orcamentos/:id/despesas/:expId/excluir', (ctx) => {
    requireUser(ctx);
    const quoteId = Number(ctx.params.id);
    run('DELETE FROM quote_expenses WHERE id = ? AND quote_id = ?', Number(ctx.params.expId), quoteId);
    touch(quoteId);
    return redirect(`/orcamentos/${quoteId}?msg=${encodeURIComponent('Despesa removida.')}`);
  });

  post('/orcamentos/:id/duplicar', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const full = loadQuote(id);
    if (!full) throw new HttpError(404, 'Orçamento não encontrado.');

    const newId = tx(() => {
      const r = run(
        `INSERT INTO quotes (code, project_id, client_id, supplier_id, title, location, status,
          margin_pct, margin_mode, service_pct, service_code, service_description, rounding, valid_days,
          observations, created_by, created_at)
         VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?)`,
        null, full.quote.project_id, full.quote.client_id, full.quote.supplier_id,
        `${full.quote.title} (cópia)`, full.quote.location, full.quote.margin_pct, full.quote.margin_mode,
        full.quote.service_pct, full.quote.service_code, full.quote.service_description, full.quote.rounding,
        full.quote.valid_days, full.quote.observations, user.id, nowIso(),
      );
      const quoteId = r.lastId;
      run('UPDATE quotes SET code = ? WHERE id = ?', `ORC-${String(quoteId).padStart(4, '0')}`, quoteId);

      for (const it of full.items) {
        const ir = run(
          `INSERT INTO quote_items (quote_id, position, internal_code, description, qty, unit_cost, product_id, supplier_id, unit, note)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          quoteId, it.position, it.internal_code, it.description, it.qty, it.unit_cost,
          it.product_id, it.supplier_id, it.unit, it.note,
        );
        for (const o of (full.offers.get(it.id) || [])) {
          run(
            `INSERT INTO quote_item_offers (item_id, supplier_id, product_id, unit_cost, stock, brand)
             VALUES (?,?,?,?,?,?)`,
            ir.lastId, o.supplier_id, o.product_id, o.unit_cost, o.stock, o.brand,
          );
        }
      }
      for (const e of full.expenses) {
        run(
          'INSERT INTO quote_expenses (quote_id, description, kind, value, base, position) VALUES (?,?,?,?,?,?)',
          quoteId, e.description, e.kind, e.value, e.base, e.position,
        );
      }
      return quoteId;
    });

    touch(newId);
    audit(user.id, 'quote.duplicate', 'quotes', newId, `origem ${id}`);
    return redirect(`/orcamentos/${newId}?msg=${encodeURIComponent('Orçamento duplicado. Ajuste os dados da nova unidade.')}`);
  });

  post('/orcamentos/:id/excluir', (ctx) => {
    requireUser(ctx);
    const id = Number(ctx.params.id);
    run('DELETE FROM quotes WHERE id = ?', id);
    audit(ctx.user.id, 'quote.delete', 'quotes', id, null);
    return redirect(`/orcamentos?msg=${encodeURIComponent('Orçamento excluído.')}`);
  });

  // ---------------------------------------------------------------- exportacoes
  routeGet('/orcamentos/:id/exportar.xlsx', (ctx) => {
    requireUser(ctx);
    const full = loadQuote(Number(ctx.params.id));
    if (!full) throw new HttpError(404, 'Orçamento não encontrado.');
    const block = { quote: full.quote, items: full.items, expenses: full.expenses, calc: full.calc };
    const result = buildQuoteWorkbook({
      quotes: [block],
      client: full.client,
      emitter: full.emitter,
      opts: { includeSummary: false },
    });
    return download(result.filename, result.buffer);
  });

  routeGet('/orcamentos/:id/comparativo.xlsx', (ctx) => {
    requireUser(ctx);
    const full = loadQuote(Number(ctx.params.id));
    if (!full) throw new HttpError(404, 'Orçamento não encontrado.');

    const supplierIds = new Set();
    for (const list of full.offers.values()) for (const o of list) supplierIds.add(o.supplier_id);
    const suppliers = [...supplierIds]
      .map((sid) => ({ id: sid, name: getSupplier(sid)?.name || `Fornecedor ${sid}` }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    if (suppliers.length < 2) {
      throw new HttpError(400, 'Este orçamento ainda não tem ofertas de dois ou mais fornecedores. Cadastre mais fornecedores com o mesmo produto (mesmo EAN ou código do fabricante).');
    }

    const result = buildComparisonWorkbook({
      quote: full.quote,
      items: full.items,
      offersByItem: full.offers,
      suppliers,
      client: full.client,
    });
    return download(result.filename, result.buffer);
  });

  routeGet('/orcamentos/:id/imprimir', (ctx) => {
    requireUser(ctx);
    const full = loadQuote(Number(ctx.params.id));
    if (!full) throw new HttpError(404, 'Orçamento não encontrado.');
    const { quote, items, calc, client, emitter } = full;

    const rows = items.map((it, i) => `<tr>
      <td class="center">${esc(it.internal_code || '')}</td>
      <td>${esc(it.description)}</td>
      <td class="center">${brQty(it.qty)}</td>
      <td class="num">${brNum(calc.lines[i].unit_price)}</td>
      <td class="num">${brNum(calc.lines[i].line_total)}</td>
    </tr>`).join('');

    const obs = String(quote.observations || '').trim()
      ? quote.observations.split(/\r?\n/).filter(Boolean).map((l) => `<p class="small" style="margin:2px 0">${esc(l)}</p>`).join('')
      : `<p class="small" style="margin:2px 0">1. Validade desta proposta: ${quote.valid_days} dias a contar da data de emissão.</p>
         <p class="small" style="margin:2px 0">2. Fornecimento dos materiais e execução dos serviços de instalação técnica realizados pela ${esc(emitter?.legal_name || emitter?.name || '')}.</p>
         <p class="small" style="margin:2px 0">3. Valores unitários sujeitos a reajuste conforme percentual de ${fmtPct(quote.margin_pct)}.</p>
         <p class="small" style="margin:2px 0">4. Garantia dos materiais conforme fabricantes e 12 meses para os serviços.</p>`;

    return render(ctx, `Imprimir ${quote.title}`, `
      ${pageHeader({
        title: 'Pré-visualização da impressão',
        subtitle: 'Use Ctrl+P. Para a planilha oficial, gere o arquivo XLSX.',
        back: { href: `/orcamentos/${quote.id}`, label: quote.title },
        actions: `<button class="btn primary" onclick="window.print()">Imprimir</button>
                  <a class="btn" href="/orcamentos/${quote.id}/exportar.xlsx">Baixar XLSX</a>`,
      })}
      <div class="print-sheet">
        <h1>${esc((emitter?.legal_name || emitter?.name || '').toUpperCase())} — ORÇAMENTO DE MATERIAIS E SERVIÇOS</h1>
        <div class="print-meta">
          <div><strong>Fornecedor</strong>${esc(emitter?.legal_name || '')}<br>${esc(emitter?.cnpj || '')}</div>
          <div><strong>Cliente</strong>${esc(client?.name || '')}<br>${esc(client?.cnpj || '')}</div>
        </div>
        <p class="small"><strong>Projeto / Local:</strong> ${esc(quote.location || quote.title)}</p>
        <table>
          <thead><tr><th>Código</th><th>Descrição</th><th class="center">Qtd</th><th class="num">V. Unit.</th><th class="num">Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="total"><td colspan="4">Produtos — ${esc(quote.title)}</td><td class="num">${brNum(calc.productsTotal)}</td></tr>
            <tr><td colspan="4">Serviço de instalação (${fmtPct(calc.servicePct)})</td><td class="num">${brNum(calc.serviceValue)}</td></tr>
            ${calc.expenseLines.map((e) => `<tr><td colspan="4">${esc(e.description)}</td><td class="num">${brNum(e.amount)}</td></tr>`).join('')}
            <tr class="total"><td colspan="4">VALOR TOTAL</td><td class="num">${brNum(calc.total)}</td></tr>
          </tfoot>
        </table>
        <h3 style="font-size:12px;color:var(--navy);margin:18px 0 6px">OBSERVAÇÕES E CONDIÇÕES COMERCIAIS</h3>
        ${obs}
        <h3 style="font-size:12px;color:var(--navy);margin:14px 0 6px">DADOS BANCÁRIOS</h3>
        <p class="small" style="white-space:pre-line;margin:0">${esc(emitter?.bank_info || '')}</p>
      </div>
    `);
  });
}
