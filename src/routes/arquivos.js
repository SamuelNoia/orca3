// Documentos arquivados: baixa e guarda uma cópia do que foi entregue ao cliente.
import { get as routeGet, post, str, htmlPage, redirect, HttpError, download } from '../web.js';
import { requireUser } from '../auth.js';
import { get, run, all, nowIso, audit } from '../db.js';
import { loadQuote, getProject, getClient } from '../repo.js';
import { buildQuoteWorkbook } from '../exporter.js';
import { zipWrite } from '../xlsx.js';
import { buildQuotePdf } from '../pdf-quote.js';
import { fmtMoney } from '../calc.js';
import {
  layout, esc, field, select, textarea, card, pageHeader, button, csrfField, emptyState, flash,
} from '../ui.js';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_PDF = 'application/pdf';
const MIME_ZIP = 'application/zip';

function render(ctx, title, body, wide = false) {
  return htmlPage(layout(ctx, { title, body, wide }));
}

function slug(text) {
  return String(text || 'arquivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'arquivo';
}

/** Gera a planilha de um orçamento (sem gravar). */
function planilhaDoOrcamento(quoteId) {
  const full = loadQuote(quoteId);
  if (!full) return null;
  const block = { quote: full.quote, items: full.items, expenses: full.expenses, calc: full.calc };
  const result = buildQuoteWorkbook({
    quotes: [block], client: full.client, emitter: full.emitter, opts: { includeSummary: false },
  });
  return { full, filename: result.filename, buffer: result.buffer };
}

/** Gera o pacote .zip com todas as propostas do projeto (sem gravar). */
function pacoteDoProjeto(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  const quotes = all('SELECT q.* FROM quotes q WHERE q.project_id = ? ORDER BY q.id', projectId);
  if (!quotes.length) return null;

  const vencedor = project.winner_quote_id;
  const arquivos = [];
  const resumo = [`PROJETO: ${project.name}`, `CLIENTE: ${getClient(project.client_id)?.name || ''}`, ''];

  quotes.forEach((q, i) => {
    const full = loadQuote(q.id);
    if (!full) return;
    const block = { quote: full.quote, items: full.items, expenses: full.expenses, calc: full.calc };
    const r = buildQuoteWorkbook({
      quotes: [block], client: full.client, emitter: full.emitter, opts: { includeSummary: false },
    });
    const papel = q.id === vencedor ? 'vencedor' : 'perdedor';
    const nome = `${String(i + 1).padStart(2, '0')}-${papel}-${slug(q.title)}.xlsx`;
    arquivos.push({ name: nome, data: r.buffer });
    resumo.push(`${nome}  ->  ${q.title}  ${q.adjust_pct ? `+${q.adjust_pct}%` : ''}`);
  });

  arquivos.push({ name: 'LEIA-ME.txt', data: Buffer.from(resumo.join('\n'), 'utf8') });
  return { project, filename: `${slug(project.name)}.zip`, buffer: zipWrite(arquivos) };
}

/** Gera o PDF da proposta (sem gravar). */
function pdfDoOrcamento(quoteId) {
  const full = loadQuote(quoteId);
  if (!full) return null;
  const bloco = { quote: full.quote, items: full.items, calc: full.calc };
  const buffer = buildQuotePdf({ quotes: [bloco], client: full.client, emitter: full.emitter });
  return { full, filename: `proposta-${slug(full.quote.title)}.pdf`, buffer, mime: MIME_PDF };
}

/** Gera o PDF com todas as propostas do projeto (sem gravar). */
function pdfDoProjeto(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  const quotes = all('SELECT q.* FROM quotes q WHERE q.project_id = ? ORDER BY q.id', projectId);
  if (!quotes.length) return null;

  const blocos = [];
  for (const q of quotes) {
    const full = loadQuote(q.id);
    if (!full) continue;
    blocos.push({
      quote: full.quote,
      items: full.items,
      calc: full.calc,
      emitter: full.emitter,
      destaque: q.id === project.winner_quote_id ? 'PROPOSTA VENCEDORA' : 'PROPOSTA',
    });
  }

  const buffer = buildQuotePdf({ quotes: blocos, client: getClient(project.client_id) });
  return { project, filename: `${slug(project.name)}-propostas.pdf`, buffer, mime: MIME_PDF };
}

function listarArquivos({ quoteId = null, projectId = null, limite = 300 } = {}) {
  const conds = [];
  const params = [];
  if (quoteId) { conds.push('f.quote_id = ?'); params.push(quoteId); }
  if (projectId) { conds.push('f.project_id = ?'); params.push(projectId); }
  params.push(limite);
  return all(
    `SELECT f.id, f.quote_id, f.project_id, f.kind, f.description, f.filename, f.mime,
            f.size, f.created_at, q.title AS quote_title, p.name AS project_name, u.name AS user_name
       FROM quote_files f
       LEFT JOIN quotes q ON q.id = f.quote_id
       LEFT JOIN projects p ON p.id = f.project_id
       LEFT JOIN users u ON u.id = f.created_by
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY f.id DESC LIMIT ?`,
    ...params,
  );
}

function tabelaArquivos(ctx, arquivos, { vazio = 'Nenhum arquivo guardado ainda.' } = {}) {
  if (!arquivos.length) return emptyState(vazio);
  const linhas = arquivos.map((f) => `<tr>
    <td class="strong">${esc(f.description)}
      <div class="small muted">${esc(f.quote_title || f.project_name || '—')}</div></td>
    <td class="center"><span class="tag">${f.kind === 'zip' ? 'ZIP' : f.kind === 'pdf' ? 'PDF' : 'XLSX'}</span></td>
    <td class="num">${(f.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB</td>
    <td class="small nowrap">${esc(new Date(f.created_at).toLocaleString('pt-BR'))}</td>
    <td class="small muted">${esc(f.user_name || '—')}</td>
    <td class="right nowrap">
      <a class="btn sm" href="/arquivos/${f.id}/download">Baixar</a>
      <form class="inline-form" method="post" action="/arquivos/${f.id}/excluir" data-confirm="Excluir este arquivo guardado?">
        ${csrfField(ctx)}<button class="btn sm danger">Excluir</button>
      </form>
    </td>
  </tr>`).join('');

  return `<div class="table-wrap"><table>
    <thead><tr><th>Descrição</th><th class="center">Tipo</th><th class="num">Tamanho</th><th>Guardado em</th><th>Por</th><th></th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

export function registerArquivoRoutes() {
  // ---------------------------------------------------------------- lista geral
  routeGet('/arquivos', (ctx) => {
    requireUser(ctx);
    const arquivos = listarArquivos();
    const total = arquivos.reduce((s, f) => s + (f.size || 0), 0);

    return render(ctx, 'Arquivos', `
      ${pageHeader({
        title: 'Arquivos guardados',
        subtitle: `${arquivos.length} documento(s) · ${(total / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB`,
      })}
      ${flash(ctx)}
      <p class="small muted" style="margin:-8px 0 16px">
        Aqui ficam as planilhas que você gerou e arquivou — a cópia do que foi entregue ao cliente,
        com descrição, data e hora. Guardar não impede gerar de novo a partir do banco.
      </p>
      ${card(null, tabelaArquivos(ctx, arquivos), { flush: arquivos.length > 0 })}
    `, true);
  });

  routeGet('/arquivos/:id/download', (ctx) => {
    requireUser(ctx);
    const row = get('SELECT filename, mime, content FROM quote_files WHERE id = ?', Number(ctx.params.id));
    if (!row) throw new HttpError(404, 'Arquivo não encontrado.');
    return download(row.filename, Buffer.from(row.content), row.mime || MIME_XLSX);
  });

  post('/arquivos/:id/excluir', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const row = get('SELECT description FROM quote_files WHERE id = ?', id);
    run('DELETE FROM quote_files WHERE id = ?', id);
    audit(user.id, 'file.delete', 'quote_files', id, row?.description || null);
    return redirect(`/arquivos?msg=${encodeURIComponent('Arquivo excluído.')}`);
  });

  // ---------------------------------------------------------------- arquivar orçamento
  routeGet('/orcamentos/:id/arquivar', (ctx) => {
    requireUser(ctx);
    const id = Number(ctx.params.id);
    const full = loadQuote(id);
    if (!full) throw new HttpError(404, 'Orçamento não encontrado.');
    const anteriores = listarArquivos({ quoteId: id, limite: 50 });
    const sugestao = `Proposta ${full.quote.code || full.quote.id} — ${full.quote.title}`;

    return render(ctx, 'Baixar e arquivar', `
      ${pageHeader({
        title: 'Baixar e arquivar',
        subtitle: `Guarda uma cópia da planilha de <strong>${esc(full.quote.title)}</strong> (${fmtMoney(full.calc.total)})`,
        back: { href: `/orcamentos/${id}`, label: full.quote.title },
      })}
      ${flash(ctx)}
      <div class="grid-2">
        <div>
          ${card(null, `
            <form method="post" action="/orcamentos/${id}/arquivar">
              ${csrfField(ctx)}
              ${select({
                label: 'Formato',
                name: 'formato',
                value: 'pdf',
                options: [
                  { value: 'pdf', label: 'PDF — a proposta pronta para enviar' },
                  { value: 'xlsx', label: 'Planilha (XLSX) — para editar' },
                  { value: 'ambos', label: 'Os dois (baixa um .zip)' },
                ],
              })}
              ${textarea({ label: 'Descrição do arquivo', name: 'description', value: sugestao, rows: 2, hint: 'Ex.: Proposta enviada ao cliente em 17/11. Aparece na lista de arquivos.' })}
              <p class="small muted" style="margin:14px 0 0">
                O documento é gerado agora, com os dados atuais do orçamento, e uma cópia fica guardada.
                O download começa em seguida.
              </p>
              <div class="form-actions">
                ${button('Baixar e guardar', { kind: 'primary' })}
                ${button('Cancelar', { kind: 'ghost', href: `/orcamentos/${id}` })}
              </div>
            </form>
          `)}
          <p class="small muted">
            O PDF não é guardado aqui porque ele é produzido pelo navegador na hora de imprimir.
            Para ter uma cópia do PDF, use <em>PDF / Imprimir</em> e salve o arquivo no seu computador.
          </p>
        </div>
        <div>
          ${card(`Já guardados (${anteriores.length})`, tabelaArquivos(ctx, anteriores, { vazio: 'Nada guardado para este orçamento.' }), { flush: anteriores.length > 0 })}
        </div>
      </div>
    `, true);
  });

  post('/orcamentos/:id/arquivar', (ctx) => {
    const user = requireUser(ctx);
    const id = Number(ctx.params.id);
    const formato = ['pdf', 'xlsx', 'ambos'].includes(str(ctx.fields.formato)) ? str(ctx.fields.formato) : 'pdf';

    const referencia = loadQuote(id);
    if (!referencia) throw new HttpError(404, 'Orçamento não encontrado.');
    const descricao = str(ctx.fields.description).trim()
      || `Proposta ${referencia.quote.code || id} — ${referencia.quote.title}`;

    const guardar = (tipo, gerado, texto) => {
      const r = run(
        `INSERT INTO quote_files (quote_id, project_id, kind, description, filename, mime, size, content, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, referencia.quote.project_id, tipo, texto, gerado.filename,
        tipo === 'pdf' ? MIME_PDF : MIME_XLSX,
        gerado.buffer.length, gerado.buffer, nowIso(), user.id,
      );
      audit(user.id, 'file.store', 'quote_files', r.lastId, texto);
      return r.lastId;
    };

    if (formato === 'ambos') {
      const pdf = pdfDoOrcamento(id);
      const planilha = planilhaDoOrcamento(id);
      if (!pdf || !planilha) throw new HttpError(404, 'Orçamento não encontrado.');
      guardar('pdf', pdf, `${descricao} (PDF)`);
      guardar('xlsx', planilha, `${descricao} (planilha)`);
      const pacote = zipWrite([
        { name: pdf.filename, data: pdf.buffer },
        { name: planilha.filename, data: planilha.buffer },
      ]);
      return download(`${slug(descricao)}.zip`, pacote, MIME_ZIP);
    }

    const gerado = formato === 'xlsx' ? planilhaDoOrcamento(id) : pdfDoOrcamento(id);
    if (!gerado) throw new HttpError(404, 'Orçamento não encontrado.');
    guardar(formato, gerado, descricao);
    return download(gerado.filename, gerado.buffer, formato === 'pdf' ? MIME_PDF : MIME_XLSX);
  });

  // ---------------------------------------------------------------- arquivar projeto
  routeGet('/projetos/:id/arquivar', (ctx) => {
    requireUser(ctx);
    const project = getProject(Number(ctx.params.id));
    if (!project) throw new HttpError(404, 'Projeto não encontrado.');
    const anteriores = listarArquivos({ projectId: project.id, limite: 50 });
    const sugestao = `Pacote de propostas — ${project.name}`;

    return render(ctx, 'Baixar e arquivar', `
      ${pageHeader({
        title: 'Baixar e arquivar o pacote',
        subtitle: `Todas as propostas de <strong>${esc(project.name)}</strong> em um .zip`,
        back: { href: `/projetos/${project.id}`, label: project.name },
      })}
      ${flash(ctx)}
      <div class="grid-2">
        <div>
          ${card(null, `
            <form method="post" action="/projetos/${project.id}/arquivar">
              ${csrfField(ctx)}
              ${select({
                label: 'Formato',
                name: 'formato',
                value: 'pdf',
                options: [
                  { value: 'pdf', label: 'PDF — todas as propostas em um documento' },
                  { value: 'zip', label: 'Planilhas (.zip) — uma por proposta' },
                ],
              })}
              ${textarea({ label: 'Descrição do arquivo', name: 'description', value: sugestao, rows: 2, hint: 'Ex.: Pacote enviado ao cliente no pregão de 17/11.' })}
              <div class="form-actions">
                ${button('Baixar e guardar', { kind: 'primary' })}
                ${button('Cancelar', { kind: 'ghost', href: `/projetos/${project.id}` })}
              </div>
            </form>
          `)}
        </div>
        <div>
          ${card(`Já guardados (${anteriores.length})`, tabelaArquivos(ctx, anteriores, { vazio: 'Nada guardado para este projeto.' }), { flush: anteriores.length > 0 })}
        </div>
      </div>
    `, true);
  });

  post('/projetos/:id/arquivar', (ctx) => {
    const user = requireUser(ctx);
    const project = getProject(Number(ctx.params.id));
    if (!project) throw new HttpError(404, 'Projeto não encontrado.');

    const formato = str(ctx.fields.formato) === 'zip' ? 'zip' : 'pdf';
    const gerado = formato === 'pdf' ? pdfDoProjeto(project.id) : pacoteDoProjeto(project.id);
    if (!gerado) return redirect(`/projetos/${project.id}?err=${encodeURIComponent('O projeto não tem orçamentos.')}`);

    const descricao = str(ctx.fields.description).trim()
      || (formato === 'pdf' ? `Propostas — ${project.name}` : `Pacote de propostas — ${project.name}`);

    const r = run(
      `INSERT INTO quote_files (quote_id, project_id, kind, description, filename, mime, size, content, created_at, created_by)
       VALUES (NULL,?,?,?,?,?,?,?,?,?)`,
      project.id, formato, descricao, gerado.filename,
      formato === 'pdf' ? MIME_PDF : MIME_ZIP,
      gerado.buffer.length, gerado.buffer, nowIso(), user.id,
    );
    audit(user.id, 'file.store', 'quote_files', r.lastId, descricao);
    return download(gerado.filename, gerado.buffer, formato === 'pdf' ? MIME_PDF : MIME_ZIP);
  });
}
