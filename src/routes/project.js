// Pagina do projeto (v2): o vencedor e os perdedores, com os documentos para o cliente.
import { get as routeGet, post, str, num, htmlPage, redirect, HttpError, download } from '../web.js';
import { requireUser } from '../auth.js';
import { run, nowIso, audit, tx } from '../db.js';
import {
  getProject, projectQuotes, getClient, getSupplier, ownSupplier, listSuppliers,
  loadQuote, updateQuoteTotals,
} from '../repo.js';
import { clonarOrcamento } from '../clone.js';
import { buildQuoteWorkbook } from '../exporter.js';
import { zipWrite } from '../xlsx.js';
import { quoteSheetHtml, printToolbar } from '../print.js';
import { fmtMoney, fmtPct } from '../calc.js';
import { layout, esc, field, select, card, pageHeader, button, csrfField, badge, emptyState, flash, statusBadge } from '../ui.js';

function render(ctx, title, body, wide = false) {
  return htmlPage(layout(ctx, { title, body, wide }));
}

function slug(text) {
  return String(text || 'orcamento')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'orcamento';
}

/** Carrega o projeto com vencedor e perdedores ja separados. */
function carregarProjeto(id) {
  const project = getProject(id);
  if (!project) return null;

  const quotes = projectQuotes(id);
  const winner = quotes.find((q) => q.id === project.winner_quote_id) || null;
  const perdedores = quotes
    .filter((q) => q.id !== project.winner_quote_id)
    .sort((a, b) => (a.adjust_pct || 0) - (b.adjust_pct || 0) || a.id - b.id);

  return { project, quotes, winner, perdedores, client: getClient(project.client_id) };
}

export function registerProjectRoutes() {
  // ---------------------------------------------------------------- hub do projeto
  routeGet('/projetos/:id', (ctx) => {
    requireUser(ctx);
    const dados = carregarProjeto(Number(ctx.params.id));
    if (!dados) throw new HttpError(404, 'Projeto não encontrado.');
    const { project, quotes, winner, perdedores, client } = dados;

    const totalGeral = quotes.reduce((s, q) => s + (q.total_cache || 0), 0);
    const fornecedores = listSuppliers(true);
    const sugestaoAumento = perdedores.length
      ? Math.round((Math.max(...perdedores.map((p) => p.adjust_pct || 0)) + 5) * 10) / 10
      : 10;

    const acoesQuote = (q) => `
      <a class="btn sm" href="/orcamentos/${q.id}">Editar</a>
      <a class="btn sm" href="/orcamentos/${q.id}/imprimir">PDF</a>
      <a class="btn sm" href="/orcamentos/${q.id}/exportar.xlsx">XLSX</a>`;

    // ------- vencedor
    const cartaoVencedor = winner
      ? card('Orçamento vencedor', `
        <div class="inline" style="justify-content:space-between;align-items:flex-start;gap:16px">
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              ${badge('Vencedor', 'ok')}
              <strong style="font-size:16px">${esc(winner.title)}</strong>
            </div>
            <div class="small muted">
              ${esc(winner.emitter_name || '—')} · ${esc(winner.code || '')} · ${statusBadge(winner.status)}
            </div>
          </div>
          <div style="text-align:right">
            <div class="small muted">Total da proposta</div>
            <div style="font-size:22px;font-weight:700;color:var(--navy)">${fmtMoney(winner.total_cache)}</div>
          </div>
        </div>
        <div class="form-actions" style="margin-top:16px">
          ${acoesQuote(winner)}
          <span style="flex:1"></span>
          <form class="inline-form" method="post" action="/projetos/${project.id}/vencedor/limpar">${csrfField(ctx)}<button class="btn sm">Remover marcação</button></form>
        </div>
      `)
      : card('Orçamento vencedor', `
        <p class="muted" style="margin-top:0">
          Ainda não há vencedor neste projeto. Crie o primeiro orçamento (o mais barato) ou marque um dos existentes.
        </p>
        <div class="inline">
          <a class="btn primary" href="/orcamentos/novo?project=${project.id}">Criar orçamento</a>
          ${quotes.length ? `
            <form method="post" action="/projetos/${project.id}/vencedor" class="inline" style="gap:8px">
              ${csrfField(ctx)}
              <select name="quote_id" style="padding:8px 10px;border:1px solid #cfdae9;border-radius:8px;font:inherit">
                ${quotes.map((q) => `<option value="${q.id}">${esc(q.title)} — ${fmtMoney(q.total_cache)}</option>`).join('')}
              </select>
              ${button('Marcar como vencedor', { kind: 'soft' })}
            </form>` : ''}
        </div>
      `);

    // ------- perdedores
    const linhasPerdedores = perdedores.map((q) => `<tr>
      <td class="strong"><a href="/orcamentos/${q.id}">${esc(q.title)}</a>
        <div class="small muted">${esc(q.code || '')}</div></td>
      <td class="small">${esc(q.emitter_name || '—')}</td>
      <td class="center">${q.adjust_pct ? `+${fmtPct(q.adjust_pct)}` : '—'}</td>
      <td class="num">${fmtMoney(q.total_cache)}</td>
      <td class="right nowrap">
        ${acoesQuote(q)}
        <form class="inline-form" method="post" action="/projetos/${project.id}/quote/${q.id}/excluir" data-confirm="Excluir o orçamento ${esc(q.title)}?">
          ${csrfField(ctx)}<button class="btn sm danger">Excluir</button>
        </form>
      </td>
    </tr>`).join('');

    const tabelaPerdedores = perdedores.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Orçamento</th><th>Fornecedor</th><th class="center">Aumento</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${linhasPerdedores}</tbody>
        </table></div>`
      : emptyState('Nenhum orçamento perdedor ainda. Use o formulário ao lado para criar os concorrentes.');

    const formPerdedor = winner
      ? `<form method="post" action="/projetos/${project.id}/perdedor">
          ${csrfField(ctx)}
          ${field({ label: 'Título', name: 'title', required: true, placeholder: 'ex.: Proposta Fornecedor B' })}
          ${select({
            label: 'Fornecedor que assina',
            name: 'supplier_id',
            value: winner.supplier_id || '',
            options: fornecedores.map((s) => ({ value: s.id, label: s.name })),
          })}
          ${field({ label: 'Aumento sobre o vencedor (%)', name: 'adjust_pct', type: 'number', step: '0.1', value: sugestaoAumento, hint: `Base: ${fmtMoney(winner.total_cache)}. Use 0 para repetir o valor.` })}
          <div class="form-actions">${button('Criar perdedor', { kind: 'primary' })}</div>
        </form>`
      : `<p class="muted">Defina o vencedor primeiro — os perdedores são criados a partir dele.</p>`;

    // ------- documentos
    const documentos = card('Documentos para o cliente', `
      <p class="small muted" style="margin-top:0">
        Gere tudo de uma vez: um PDF com todas as propostas em sequência e um pacote com todas as planilhas.
      </p>
      <div class="inline">
        <a class="btn primary" href="/projetos/${project.id}/imprimir">PDF de todas as propostas</a>
        <a class="btn" href="/projetos/${project.id}/planilhas.zip">Baixar planilhas (.zip)</a>
        <a class="btn" href="/projetos/${project.id}/exportar.xlsx">Planilha consolidada</a>
      </div>
      <p class="small muted" style="margin:14px 0 0">
        ${quotes.length} orçamento(s): 1 vencedor + ${perdedores.length} perdedor(es) · total ${fmtMoney(totalGeral)}
      </p>
    `);

    return render(ctx, project.name, `
      ${pageHeader({
        title: project.name,
        subtitle: `${esc(client?.name || '')}${project.code ? ` · ${esc(project.code)}` : ''}`,
        back: { href: '/projetos', label: 'Projetos' },
        actions: winner
          ? `<a class="btn primary" href="/projetos/${project.id}/imprimir">PDF de todos</a>
             <a class="btn" href="/projetos/${project.id}/planilhas.zip">Planilhas (.zip)</a>`
          : `<a class="btn primary" href="/orcamentos/novo?project=${project.id}">Criar orçamento</a>`,
      })}
      ${flash(ctx)}
      <div class="grid-2">
        <div>
          ${cartaoVencedor}
          ${card(`Orçamentos perdedores (${perdedores.length})`, tabelaPerdedores, { flush: perdedores.length > 0 })}
          ${documentos}
        </div>
        <div>
          ${card('Adicionar perdedor', formPerdedor)}
          ${card('Resumo', `
            <dl class="summary">
              <div class="row"><span>Cliente</span><span>${esc(client?.name || '—')}</span></div>
              <div class="row"><span>Vencedor</span><span>${winner ? fmtMoney(winner.total_cache) : '—'}</span></div>
              <div class="row"><span>Perdedores</span><span>${perdedores.length}</span></div>
              <div class="row total"><span>Total do projeto</span><span>${fmtMoney(totalGeral)}</span></div>
            </dl>
          `)}
        </div>
      </div>
    `, true);
  });

  // ---------------------------------------------------------------- marcar vencedor
  post('/projetos/:id/vencedor', (ctx) => {
    const user = requireUser(ctx);
    const projectId = Number(ctx.params.id);
    const dados = carregarProjeto(projectId);
    if (!dados) throw new HttpError(404, 'Projeto não encontrado.');

    const quoteId = Number(str(ctx.fields.quote_id));
    if (!dados.quotes.some((q) => q.id === quoteId)) {
      return redirect(`/projetos/${projectId}?err=${encodeURIComponent('Orçamento não pertence a este projeto.')}`);
    }
    run('UPDATE projects SET winner_quote_id = ? WHERE id = ?', quoteId, projectId);
    run("UPDATE quotes SET adjust_pct = 0 WHERE id = ?", quoteId);
    audit(user.id, 'project.winner', 'projects', projectId, `quote ${quoteId}`);
    return redirect(`/projetos/${projectId}?msg=${encodeURIComponent('Orçamento vencedor definido.')}`);
  });

  post('/projetos/:id/vencedor/limpar', (ctx) => {
    requireUser(ctx);
    const projectId = Number(ctx.params.id);
    run('UPDATE projects SET winner_quote_id = NULL WHERE id = ?', projectId);
    return redirect(`/projetos/${projectId}?msg=${encodeURIComponent('Marcação de vencedor removida.')}`);
  });

  // ---------------------------------------------------------------- novo perdedor
  post('/projetos/:id/perdedor', (ctx) => {
    const user = requireUser(ctx);
    const projectId = Number(ctx.params.id);
    const dados = carregarProjeto(projectId);
    if (!dados) throw new HttpError(404, 'Projeto não encontrado.');
    if (!dados.winner) {
      return redirect(`/projetos/${projectId}?err=${encodeURIComponent('Defina o orçamento vencedor antes de criar perdedores.')}`);
    }

    const ajuste = num(ctx.fields.adjust_pct, 0);
    const titulo = str(ctx.fields.title).trim() || `Proposta ${dados.perdedores.length + 2}`;
    const emitenteId = Number(str(ctx.fields.supplier_id)) || dados.winner.supplier_id;

    const novoId = clonarOrcamento({
      origemId: dados.winner.id,
      userId: user.id,
      title: titulo,
      emitterId: emitenteId,
      itemSupplierId: emitenteId !== dados.winner.supplier_id ? emitenteId : null,
      mode: 'preco',
      adjustPct: ajuste,
      copyExpenses: true,
      adjustField: ajuste,
    });

    if (!novoId) return redirect(`/projetos/${projectId}?err=${encodeURIComponent('Não foi possível criar o orçamento.')}`);
    updateQuoteTotals(novoId);
    audit(user.id, 'project.loser', 'projects', projectId, `novo orçamento ${novoId} (+${ajuste}%)`);
    return redirect(`/projetos/${projectId}?msg=${encodeURIComponent('Orçamento perdedor criado.')}`);
  });

  // ---------------------------------------------------------------- excluir do projeto
  post('/projetos/:id/quote/:quoteId/excluir', (ctx) => {
    requireUser(ctx);
    const projectId = Number(ctx.params.id);
    const quoteId = Number(ctx.params.quoteId);
    run('UPDATE projects SET winner_quote_id = NULL WHERE winner_quote_id = ?', quoteId);
    run('DELETE FROM quotes WHERE id = ? AND project_id = ?', quoteId, projectId);
    return redirect(`/projetos/${projectId}?msg=${encodeURIComponent('Orçamento excluído.')}`);
  });

  // ---------------------------------------------------------------- PDF de todos
  routeGet('/projetos/:id/imprimir', (ctx) => {
    requireUser(ctx);
    const dados = carregarProjeto(Number(ctx.params.id));
    if (!dados) throw new HttpError(404, 'Projeto não encontrado.');
    const { project, winner, perdedores, client } = dados;

    if (!winner && !perdedores.length) {
      return redirect(`/projetos/${project.id}?err=${encodeURIComponent('O projeto não tem orçamentos para imprimir.')}`);
    }

    const ordem = [winner, ...perdedores].filter(Boolean);
    const blocos = ordem.map((q, i) => {
      const full = loadQuote(q.id);
      if (!full) return '';
      return quoteSheetHtml({
        quote: full.quote,
        items: full.items,
        calc: full.calc,
        client: full.client,
        emitter: full.emitter,
        breakAfter: i < ordem.length - 1,
      });
    }).join('\n');

    const body = printToolbar({
      title: project.name,
      back: { href: `/projetos/${project.id}`, label: 'Voltar' },
      actions: `<button class="btn primary" onclick="window.print()">Salvar como PDF</button>
                <a class="btn" href="/projetos/${project.id}/planilhas.zip">Planilhas (.zip)</a>`,
    }) + blocos;

    return htmlPage(layout(ctx, {
      title: project.name,
      docTitle: project.name,
      body,
      bare: true,
      wide: true,
    }));
  });

  // ---------------------------------------------------------------- pacote de planilhas
  routeGet('/projetos/:id/planilhas.zip', (ctx) => {
    requireUser(ctx);
    const dados = carregarProjeto(Number(ctx.params.id));
    if (!dados) throw new HttpError(404, 'Projeto não encontrado.');
    const { project, winner, perdedores, client } = dados;

    const ordem = [winner, ...perdedores].filter(Boolean);
    if (!ordem.length) {
      return redirect(`/projetos/${project.id}?err=${encodeURIComponent('O projeto não tem orçamentos para exportar.')}`);
    }

    const arquivos = [];
    const resumo = ['PROJETO: ' + project.name, 'CLIENTE: ' + (client?.name || ''), ''];

    ordem.forEach((q, i) => {
      const full = loadQuote(q.id);
      if (!full) return;
      const block = { quote: full.quote, items: full.items, expenses: full.expenses, calc: full.calc };
      const result = buildQuoteWorkbook({
        quotes: [block], client: full.client, emitter: full.emitter,
        opts: { includeSummary: false },
      });
      const papel = q.id === winner?.id ? 'vencedor' : 'perdedor';
      const nome = `${String(i + 1).padStart(2, '0')}-${papel}-${slug(q.title)}.xlsx`;
      arquivos.push({ name: nome, data: result.buffer });
      resumo.push(`${nome}  ->  ${q.title} (${q.emitter_name || ''})  ${q.adjust_pct ? `+${q.adjust_pct}%` : ''}`);
    });

    resumo.push('', 'Cada planilha e independente. A aba CUSTOS fica oculta.');
    arquivos.push({ name: 'LEIA-ME.txt', data: Buffer.from(resumo.join('\n'), 'utf8') });

    const zip = zipWrite(arquivos);
    return download(`${slug(project.name)}.zip`, zip, 'application/zip');
  });
}
