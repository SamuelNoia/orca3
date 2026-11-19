// Renderiza um orcamento como folha A4 para impressao / PDF.
// Usado na impressao individual e na impressao de todos do projeto.
import { themeFor } from './layouts.js';
import { linhasObservacoes } from './observacoes.js';

const brNum = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brQty = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Barra de acoes que NAO sai na impressao. */
export function printToolbar({ title = '', back = null, actions = '' }) {
  return `<div class="no-print print-toolbar">
    <div style="display:flex;align-items:center;gap:10px;min-width:0">
      ${back ? `<a class="btn" href="${esc(back.href)}">← ${esc(back.label)}</a>` : ''}
      <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</strong>
    </div>
    <div class="actions">${actions}</div>
  </div>
  <p class="no-print small muted" style="margin:0 0 14px">
    No diálogo de impressão escolha <strong>Salvar como PDF</strong>. Se aparecerem
    cabeçalho ou rodapé do navegador, desmarque <strong>“Cabeçalhos e rodapés”</strong>.
  </p>`;
}

export function quoteSheetHtml({ quote, items, calc, client, emitter, breakAfter = false, destaque = '' }) {  const t = themeFor(emitter?.layout);
  const px = (pt) => Math.round(Number(pt) * 1.33);
  const pad = Math.max(3, Math.round(px(t.rowH) / 3.2));
  const empresa = (emitter?.legal_name || emitter?.name || '').toUpperCase();
  const borda = `1px solid #${t.borderColor}`;

  const linhaHtml = (it, i) => `<tr>
    <td style="border-bottom:${borda};padding:${pad}px 8px;text-align:center">${esc(it.internal_code || '')}</td>
    <td style="border-bottom:${borda};padding:${pad}px 8px">${esc(it.description)}</td>
    <td style="border-bottom:${borda};padding:${pad}px 8px;text-align:center">${brQty(it.qty)}</td>
    <td style="border-bottom:${borda};padding:${pad}px 8px;text-align:right">${brNum(calc.lines[i]?.unit_price)}</td>
    <td style="border-bottom:${borda};padding:${pad}px 8px;text-align:right">${brNum(calc.lines[i]?.line_total)}</td>
  </tr>`;

  const linhas = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => Number(it.is_service) !== 1)
    .map(({ it, i }) => linhaHtml(it, i))
    .join('');

  // servicos lancados a mao aparecem depois dos produtos, com o seu proprio titulo
  const servicosMarcados = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => Number(it.is_service) === 1);

  const blocoServicos = servicosMarcados.length
    ? `<tr>
        <td colspan="5" style="background:#${t.soft};padding:${pad + 2}px 8px;font-weight:700;font-size:${px(t.szHeader)}px">Serviços</td>
      </tr>
      ${servicosMarcados.map(({ it, i }) => linhaHtml(it, i)).join('')}`
    : '';

  const obs = linhasObservacoes(quote, emitter?.legal_name || emitter?.name || '')
    .map((l) => `<p style="margin:2px 0;font-size:${px(t.szBody)}px">${esc(l)}</p>`).join('');

  const despesas = calc.expenseLines
    .map((e) => `<tr>
      <td colspan="4" style="border-bottom:${borda};padding:${pad}px 8px">${esc(e.description)}</td>
      <td style="border-bottom:${borda};padding:${pad}px 8px;text-align:right">${brNum(e.amount)}</td>
    </tr>`).join('');

  return `<div class="print-sheet" style="font-family:'${t.font}',Arial,sans-serif;font-size:${px(t.szBody)}px;${breakAfter ? 'page-break-after:always;' : ''}">
    ${destaque ? `<div style="margin-bottom:8px;font-size:${px(t.szHeader)}px;font-weight:700;color:#${t.sectionText}">${esc(destaque)}</div>` : ''}
    <h1 style="background:#${t.primary};color:#${t.titleText};font-size:${px(t.szTitle)}px;text-align:${t.titleAlign === 'left' ? 'left' : 'center'};padding:${Math.round(px(t.titleH) / 4)}px 10px;margin:0 0 16px;border-radius:6px">
      ${esc(empresa)} — ORÇAMENTO DE MATERIAIS E SERVIÇOS
    </h1>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div>
        <div style="font-size:${px(t.szBody) - 1}px;text-transform:uppercase;letter-spacing:.04em;color:#${t.note}">Fornecedor</div>
        <div>${esc(emitter?.legal_name || emitter?.name || '')}</div>
        <div>${esc(emitter?.cnpj || '')}</div>
      </div>
      <div>
        <div style="font-size:${px(t.szBody) - 1}px;text-transform:uppercase;letter-spacing:.04em;color:#${t.note}">Cliente</div>
        <div>${esc(client?.name || '')}</div>
        <div>${esc(client?.cnpj || '')}</div>
      </div>
    </div>

    <p style="margin:0 0 12px"><strong>Projeto / Local:</strong> ${esc(quote.location || quote.title)}</p>

    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="background:#${t.headerFill};color:#${t.headerText};font-size:${px(t.szHeader)}px;text-align:center;padding:${pad + 2}px 8px">Código</th>
          <th style="background:#${t.headerFill};color:#${t.headerText};font-size:${px(t.szHeader)}px;text-align:${t.headerAlign === 'center' ? 'center' : 'left'};padding:${pad + 2}px 8px">Descrição</th>
          <th style="background:#${t.headerFill};color:#${t.headerText};font-size:${px(t.szHeader)}px;text-align:center;padding:${pad + 2}px 8px">Qtd</th>
          <th style="background:#${t.headerFill};color:#${t.headerText};font-size:${px(t.szHeader)}px;text-align:right;padding:${pad + 2}px 8px">V. Unit.</th>
          <th style="background:#${t.headerFill};color:#${t.headerText};font-size:${px(t.szHeader)}px;text-align:right;padding:${pad + 2}px 8px">Total</th>
        </tr>
      </thead>
      <tbody>${linhas}${blocoServicos}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="background:#${t.soft};padding:${pad + 3}px 8px;font-weight:700;font-size:${px(t.szTotal)}px">Produtos — ${esc(quote.title)}</td>
          <td style="background:#${t.soft};padding:${pad + 3}px 8px;text-align:right;font-weight:700;font-size:${px(t.szTotal)}px">${brNum(calc.productsTotal)}</td>
        </tr>
        ${calc.servicesTotal > 0 ? `<tr>
          <td colspan="4" style="background:#${t.soft};padding:${pad + 2}px 8px">Serviços</td>
          <td style="background:#${t.soft};padding:${pad + 2}px 8px;text-align:right">${brNum(calc.servicesTotal)}</td>
        </tr>` : ''}
        ${calc.servicePct > 0 ? `<tr>
          <td colspan="4" style="background:#${t.soft};padding:${pad + 2}px 8px">Serviço de instalação</td>
          <td style="background:#${t.soft};padding:${pad + 2}px 8px;text-align:right">${brNum(calc.serviceValue)}</td>
        </tr>` : ''}
        ${despesas}
        <tr>
          <td colspan="4" style="background:#${t.primary};color:#${t.titleText};padding:${pad + 4}px 8px;font-weight:700;font-size:${px(t.szTotal) + 1}px">VALOR TOTAL</td>
          <td style="background:#${t.primary};color:#${t.titleText};padding:${pad + 4}px 8px;text-align:right;font-weight:700;font-size:${px(t.szTotal) + 1}px">${brNum(calc.total)}</td>
        </tr>
      </tfoot>
    </table>

    <h3 style="font-size:${px(t.szSection)}px;color:#${t.sectionText};margin:18px 0 6px">OBSERVAÇÕES E CONDIÇÕES COMERCIAIS</h3>
    ${obs}

    <h3 style="font-size:${px(t.szSection)}px;color:#${t.sectionText};margin:14px 0 6px">DADOS BANCÁRIOS</h3>
    <p style="white-space:pre-line;margin:0;font-size:${px(t.szBody)}px">${esc(emitter?.bank_info || '')}</p>
  </div>`;
}
