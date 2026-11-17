// Gera a planilha de orcamento no layout padrao da empresa:
//   - aba CUSTOS (tabela de precos base, interna)
//   - uma aba por orcamento/unidade, com formulas reais e editaveis
//   - aba RESUMO CONSOLIDADO quando ha mais de um orcamento
import { buildXlsx, quoteSheet, safeSheetName } from './xlsx.js';
import { round2 } from './calc.js';
import { themeFor } from './layouts.js';

const COLS = [11, 26, 8, 13, 20, 20];
const money = (v) => round2(Number(v) || 0);

function baseLabel(base) {
  if (base === 'services') return 'sobre serviços';
  if (base === 'total') return 'sobre o total acumulado';
  return 'sobre produtos';
}

export function slug(text) {
  return String(text || 'orcamento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'orcamento';
}

function numeroPorExtenso(n) {
  const map = {
    7: 'sete', 10: 'dez', 15: 'quinze', 20: 'vinte', 30: 'trinta', 45: 'quarenta e cinco', 60: 'sessenta', 90: 'noventa',
  };
  return map[Number(n)] || String(n);
}

function obsLines(quote, emitterName) {
  const custom = String(quote.observations || '').trim();
  if (custom) return custom.split(/\r?\n/).filter((l) => l.trim());
  const dias = Number(quote.valid_days) || 15;
  return [
    `1. Validade desta proposta: ${dias} (${numeroPorExtenso(dias)}) dias a contar da data de emissão.`,
    `2. Fornecimento dos materiais e execução dos serviços de instalação técnica realizados pela ${emitterName}.`,
    '3. Valores unitários sujeitos a reajuste conforme variação de mercado.',
    '4. Garantia dos materiais conforme fabricantes e garantia de 12 meses para os serviços prestados.',
  ];
}

/**
 * @param {object} p
 * @param {Array}  p.quotes [{ quote, calc, items, expenses }]
 * @param {object} p.client
 * @param {object} p.emitter fornecedor emitente
 * @param {object} p.opts    { includeSummary }
 */
export function buildQuoteWorkbook({ quotes, client, emitter, opts = {} }) {
  const emitterName = (emitter?.legal_name || emitter?.name || 'EMPRESA EMITENTE').toUpperCase();

  // o layout vem do cadastro do fornecedor emitente
  const layoutId = opts.layout || emitter?.layout || 'classico';
  const T = { ...themeFor(layoutId), layoutId };
  T.titleH = T.titleH || 28.05;
  T.headerH = T.headerH || 22.05;
  T.rowH = T.rowH || 16.05;
  T.cols = T.cols && T.cols.length === 6 ? T.cols : COLS;

  // alocacao global das linhas da aba CUSTOS (comeca na linha 4)
  let custosCursor = 4;
  for (const block of quotes) {
    block.custosRows = block.items.map(() => {
      const r = custosCursor;
      custosCursor += 1;
      return r;
    });
  }

  const usedNames = new Set(['custos', 'resumo consolidado']);
  for (const block of quotes) {
    block.sheetName = safeSheetName(`Orçamento - ${block.quote.title || 'Sem nome'}`, usedNames);
  }

  const sheets = quotes.map((block) => {
    const q = block.quote;
    const c = block.calc;
    const R = [];
    const merges = [];
    const push = (cells, h) => { R.push(h ? { cells, h } : { cells }); return R.length; };

    let n = push([{ v: `${emitterName} - ORÇAMENTO DE MATERIAIS E SERVIÇOS`, s: 'title' }], T.titleH);
    merges.push(`A${n}:F${n}`);

    n = push([
      { v: 'DADOS DO FORNECEDOR', s: 'section' }, null, null,
      { v: 'DADOS DO CLIENTE', s: 'section' }, null, null,
    ], 15);
    merges.push(`A${n}:C${n}`, `D${n}:F${n}`);

    n = push([
      { v: 'Razão Social:', s: 'label' },
      { v: emitter?.legal_name || emitter?.name || '', s: 'value' }, null,
      { v: 'Razão Social:', s: 'label' },
      { v: client?.name || '', s: 'value' }, null,
    ], 29.4);
    merges.push(`B${n}:C${n}`, `E${n}:F${n}`);

    n = push([
      { v: 'CNPJ / IE:', s: 'label' },
      { v: [emitter?.cnpj, emitter?.ie ? `I.E: ${emitter.ie}` : null].filter(Boolean).join('  |  '), s: 'value' }, null,
      { v: 'CNPJ / IE:', s: 'label' },
      { v: [client?.cnpj, client?.ie ? `I.E: ${client.ie}` : null].filter(Boolean).join('  |  '), s: 'value' }, null,
    ]);
    merges.push(`B${n}:C${n}`, `E${n}:F${n}`);

    n = push([
      { v: 'Endereço:', s: 'label' }, { v: emitter?.address || '', s: 'value' }, null,
      { v: 'Endereço:', s: 'label' }, { v: client?.address || '', s: 'value' }, null,
    ]);
    merges.push(`B${n}:C${n}`, `E${n}:F${n}`);

    n = push([
      { v: 'Contato:', s: 'label' }, { v: emitter?.contact || '', s: 'value' }, null,
      { v: 'Projeto / Local:', s: 'label' }, { v: q.location || q.title || '', s: 'value' }, null,
    ]);
    merges.push(`B${n}:C${n}`, `E${n}:F${n}`);

    n = push([
      { v: 'Código', s: 'headerLeft' },
      { v: 'Descrição dos Produtos e Serviços', s: 'header' }, null,
      { v: 'Qtd', s: 'header' },
      { v: 'V. Unitário (R$)', s: 'header' },
      { v: 'Valor Total (R$)', s: 'header' },
    ], T.headerH);
    merges.push(`B${n}:C${n}`);

    const firstItemRow = R.length + 1;
    const items = block.items.length
      ? block.items
      : [{ description: '(sem itens)', qty: 1, unit_cost: 0, internal_code: '' }];

    // a margem entra no proprio calculo: o cliente nao ve percentual nenhum
    const margem = Number(((Number(q.margin_pct) || 0) / 100).toFixed(6));

    items.forEach((it, i) => {
      const rowNum = R.length + 1;
      const custosRef = `CUSTOS!E${block.custosRows[i] ?? 4}`;
      let formula = q.margin_mode === 'margin'
        ? `${custosRef}/(1-${margem})`
        : `${custosRef}*(1+${margem})`;
      if (Number(q.rounding) > 0) formula = `CEILING(${formula},${Number(q.rounding)})`;

      const line = c.lines[i];
      const manual = line?.manual_price === true;
      push([
        { v: it.internal_code || it.ean || it.reference || '', s: 'center' },
        { v: it.description, s: 'cell' }, null,
        { v: Number(it.qty) || 0, s: 'qty' },
        manual
          ? { v: money(line?.unit_price ?? 0), s: 'money' }
          : { v: money(line?.unit_price ?? 0), s: 'money', f: formula },
        { v: money(line?.line_total ?? 0), s: 'money', f: `D${rowNum}*E${rowNum}` },
      ], T.rowH);
      merges.push(`B${rowNum}:C${rowNum}`);
    });
    const lastItemRow = R.length;

    // servico de instalacao (opcional: sem percentual, a linha nao existe)
    let svcRow = null;
    if (c.servicePct > 0) {
      svcRow = R.length + 1;
      push([
        { v: q.service_code || 'SERV-01', s: 'center' },
        { v: q.service_description || 'SERVIÇO ESPECIALIZADO DE INSTALAÇÃO E MONTAGEM TÉCNICA', s: 'boldText' }, null,
        { v: 1, s: 'qty' },
        {
          v: money(c.serviceValue),
          s: 'boldMoney',
          f: `SUM(F${firstItemRow}:F${lastItemRow})*${c.servicePct / 100}`,
        },
        { v: money(c.serviceValue), s: 'boldMoney', f: `D${svcRow}*E${svcRow}` },
      ], 18);
      merges.push(`B${svcRow}:C${svcRow}`);
    }

    const expenseRows = [];
    for (const e of block.expenses) {
      const rowNum = R.length + 1;
      const pct = Number(e.value) || 0;
      let formula = null;
      if (e.kind === 'fixed') {
        formula = String(pct);
      } else if (e.base === 'services') {
        formula = svcRow ? `F${svcRow}*${pct / 100}` : null;
      } else if (e.base === 'total') {
        formula = `SUM(F${firstItemRow}:F${rowNum - 1})*${pct / 100}`;
      } else {
        formula = `SUM(F${firstItemRow}:F${lastItemRow})*${pct / 100}`;
      }
      const label = e.kind === 'percent'
        ? `${e.description} (${String(pct).replace('.', ',')}% ${baseLabel(e.base)})`
        : `${e.description} (valor fixo)`;
      push([
        { v: '', s: 'center' },
        { v: label, s: 'boldText' }, null,
        { v: 1, s: 'qty' },
        formula
          ? { v: money(e.amount), s: 'boldMoney', f: formula }
          : { v: money(e.amount), s: 'boldMoney' },
        { v: money(e.amount), s: 'boldMoney', f: `D${rowNum}*E${rowNum}` },
      ], T.rowH);
      merges.push(`B${rowNum}:C${rowNum}`);
      expenseRows.push(rowNum);
    }

    const totalRow = R.length + 1;
    push([
      { v: 'VALOR TOTAL DO ORÇAMENTO (PRODUTOS + SERVIÇOS)', s: 'totalLabel' },
      null, null, null, null,
      { v: money(c.total), s: 'totalMoney', f: `SUM(F${firstItemRow}:F${totalRow - 1})` },
    ], T.headerH);
    merges.push(`A${totalRow}:E${totalRow}`);

    block.layout = {
      firstItemRow, lastItemRow, svcRow, expenseRows, totalRow, sheetName: block.sheetName,
    };

    R.push({ cells: [] });
    const obsHeader = R.length + 1;
    push([{ v: 'OBSERVAÇÕES E CONDIÇÕES COMERCIAIS', s: 'section' }], 18);
    merges.push(`A${obsHeader}:F${obsHeader}`);
    for (const line of obsLines(q, emitterName)) {
      push([{ v: line, s: 'note' }], 13.95);
      merges.push(`A${R.length}:F${R.length}`);
    }

    R.push({ cells: [] });
    const bankHeader = R.length + 1;
    push([{ v: `DADOS BANCÁRIOS DA ${emitterName} PARA PAGAMENTO / TRANSFERÊNCIA`, s: 'section' }], 18);
    merges.push(`A${bankHeader}:F${bankHeader}`);

    const bank = String(emitter?.bank_info || '').trim();
    const bankRows = bank
      ? bank.split(/\r?\n/).filter((l) => l.trim())
      : [
        `Razão Social: ${emitter?.legal_name || emitter?.name || ''}`,
        `CNPJ / PIX: ${emitter?.cnpj || ''}`,
        `Contato: ${emitter?.contact || ''}`,
      ];
    for (const line of bankRows) {
      push([{ v: line, s: 'note' }], 13.95);
      merges.push(`A${R.length}:F${R.length}`);
    }

    return {
      name: block.sheetName,
      cols: T.cols,
      rows: R,
      merges,
      page: { orientation: 'portrait', paperSize: 9, fitToWidth: 1, centerH: true },
    };
  });

  // ------- aba CUSTOS
  const custosRows = [
    { cells: [{ v: `${emitterName} - TABELA DE PREÇOS BASE / CUSTOS DOS MATERIAIS (INTERNO)`, s: 'title' }], h: T.titleH },
    { cells: [] },
    {
      cells: [
        { v: 'Escola / Projeto', s: 'header' },
        { v: 'Código', s: 'header' },
        { v: 'Descrição do Material', s: 'header' },
        { v: 'Qtd', s: 'header' },
        { v: 'V. Unit. Base (R$)', s: 'header' },
        { v: 'Fornecedor', s: 'header' },
        { v: 'Marca', s: 'header' },
      ],
      h: T.headerH,
    },
  ];

  for (const block of quotes) {
    block.items.forEach((it, i) => {
      custosRows.push({
        cells: [
          { v: block.quote.title || '', s: 'cell' },
          { v: it.internal_code || it.ean || it.reference || '', s: 'center' },
          { v: it.description, s: 'cell' },
          { v: Number(it.qty) || 0, s: 'qty' },
          { v: money(it.unit_cost), s: 'money' },
          { v: it.supplier_name || '', s: 'cell' },
          { v: it.brand || '', s: 'cell' },
        ],
        h: T.rowH,
      });
    });
  }

  const custosSheet = {
    name: 'CUSTOS',
    cols: [28, 12, 40, 10, 20, 26, 18],
    rows: custosRows,
    merges: ['A1:G1'],
    // aba interna: oculta para nao expor custo ao cliente
    hidden: true,
    page: { orientation: 'landscape', paperSize: 9, fitToWidth: 1 },
  };

  // ------- resumo consolidado
  const includeSummary = opts.includeSummary ?? quotes.length > 1;
  const allSheets = [custosSheet, ...sheets];

  if (includeSummary) {
    const R = [];
    const merges = [];
    const push = (cells, h) => { R.push(h ? { cells, h } : { cells }); return R.length; };

    push([{ v: `${emitterName} - RESUMO GERAL DOS ORÇAMENTOS`, s: 'title' }], T.titleH);
    merges.push('A1:F1');
    R.push({ cells: [] });
    push([{ v: `CLIENTE: ${client?.name || ''}`, s: 'section' }], 18);
    merges.push(`A${R.length}:F${R.length}`);

    push([
      { v: 'Item', s: 'header' },
      { v: 'Escola / Unidade', s: 'header' },
      { v: 'Produtos (R$)', s: 'header' },
      { v: 'Serviços de Instalação (R$)', s: 'header' },
      { v: 'Despesas (R$)', s: 'header' },
      { v: 'Total Geral (R$)', s: 'header' },
    ], T.headerH);

    const firstData = R.length + 1;
    quotes.forEach((block, i) => {
      const { firstItemRow, lastItemRow, svcRow, expenseRows, totalRow, sheetName } = block.layout;
      const ref = quoteSheet(sheetName);
      const expValue = money(block.calc.expensesTotal);
      const expFormula = expenseRows.length
        ? `SUM(${ref}!F${expenseRows[0]}:F${expenseRows[expenseRows.length - 1]})`
        : null;
      push([
        { v: i + 1, s: 'center' },
        { v: block.quote.title || '', s: 'cell' },
        { v: money(block.calc.productsTotal), s: 'money', f: `SUM(${ref}!F${firstItemRow}:F${lastItemRow})` },
        svcRow
          ? { v: money(block.calc.serviceValue), s: 'money', f: `${ref}!F${svcRow}` }
          : { v: 0, s: 'money' },
        expFormula ? { v: expValue, s: 'money', f: expFormula } : { v: expValue, s: 'money' },
        { v: money(block.calc.total), s: 'money', f: `${ref}!F${totalRow}` },
      ], 18);
    });
    const lastData = R.length;

    push([
      { v: 'VALOR TOTAL CONSOLIDADO', s: 'totalLabel' },
      null, null, null, null,
      { v: money(quotes.reduce((s, b) => s + b.calc.total, 0)), s: 'totalMoney', f: `SUM(F${firstData}:F${lastData})` },
    ], T.headerH);
    merges.push(`A${R.length}:E${R.length}`);

    allSheets.push({
      name: 'RESUMO CONSOLIDADO',
      cols: [7, 46, 18, 24, 18, 20],
      rows: R,
      merges,
      page: { orientation: 'portrait', paperSize: 9, fitToWidth: 1, centerH: true },
    });
  }

  const title = quotes.length > 1
    ? `Orçamentos - ${client?.name || ''}`
    : `Orçamento - ${quotes[0]?.quote.title || ''}`;

  return {
    buffer: buildXlsx(allSheets, { title, creator: emitterName, theme: T }),
    filename: `${slug(title)}.xlsx`,
    sheets: allSheets.map((s) => s.name),
  };
}

/** Planilha de comparativo de cotacoes entre fornecedores. */
export function buildComparisonWorkbook({ quote, items, offersByItem, suppliers, client, layout }) {
  const T = themeFor(layout || quote?.layout || 'classico');
  const R = [];
  const merges = [];
  const push = (cells, h) => { R.push(h ? { cells, h } : { cells }); return R.length; };
  const lastCol = 3 + suppliers.length + 2;

  push([{ v: 'COMPARATIVO DE COTAÇÕES ENTRE FORNECEDORES', s: 'title' }], T.titleH);
  merges.push(`A1:${colLetter(lastCol)}1`);

  push([{ v: `Orçamento: ${quote.title || ''}    |    Cliente: ${client?.name || ''}`, s: 'section' }], 18);
  merges.push(`A2:${colLetter(lastCol)}2`);
  R.push({ cells: [] });

  const header = [
    { v: 'Item', s: 'header' },
    { v: 'Descrição', s: 'header' },
    { v: 'Qtd', s: 'header' },
    ...suppliers.map((s) => ({ v: s.name, s: 'header' })),
    { v: 'Menor preço', s: 'header' },
    { v: 'Economia', s: 'header' },
  ];
  push(header, 32);

  const perSupplier = new Map(suppliers.map((s) => [s.id, 0]));
  let bestTotal = 0;
  let worstTotal = 0;

  items.forEach((it, i) => {
    const offers = offersByItem.get(it.id) || [];
    const prices = offers.map((o) => Number(o.unit_cost) || 0).filter((p) => p > 0);
    const best = prices.length ? Math.min(...prices) : null;
    const worst = prices.length ? Math.max(...prices) : null;
    const qty = Number(it.qty) || 0;
    if (best !== null) {
      bestTotal += best * qty;
      worstTotal += worst * qty;
    }

    const cells = [
      { v: i + 1, s: 'center' },
      { v: it.description, s: 'cell' },
      { v: qty, s: 'qty' },
    ];
    for (const s of suppliers) {
      const o = offers.find((x) => x.supplier_id === s.id);
      const price = o ? Number(o.unit_cost) : null;
      if (price !== null) perSupplier.set(s.id, (perSupplier.get(s.id) || 0) + price * qty);
      const isBest = price !== null && best !== null && Math.abs(price - best) < 0.005;
      cells.push({ v: price === null ? '—' : money(price), s: isBest ? 'boldMoney' : 'money' });
    }
    cells.push({ v: best === null ? '—' : money(best), s: 'boldMoney' });
    cells.push({ v: best !== null ? money((worst - best) * qty) : '—', s: 'money' });
    push(cells, 16.05);
  });

  const totalRow = R.length + 1;
  const totalCells = [{ v: 'TOTAL (pelo melhor preço de cada item)', s: 'totalLabel' }, null, null];
  for (const s of suppliers) totalCells.push({ v: money(perSupplier.get(s.id) || 0), s: 'boldMoney' });
  totalCells.push({ v: money(bestTotal), s: 'totalMoney' });
  totalCells.push({ v: money(worstTotal - bestTotal), s: 'boldMoney' });
  push(totalCells, 22.05);
  merges.push(`A${totalRow}:C${totalRow}`);

  R.push({ cells: [] });
  const pct = worstTotal > 0 ? ((worstTotal - bestTotal) / worstTotal) * 100 : 0;
  push([{
    v: `Economia potencial de ${money(worstTotal - bestTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%) comprando cada item do fornecedor mais barato.`,
    s: 'note',
  }], 18);
  merges.push(`A${R.length}:${colLetter(lastCol)}${R.length}`);

  const sheets = [{
    name: 'COMPARATIVO',
    cols: [7, 44, 9, ...suppliers.map(() => 17), 17, 16],
    rows: R,
    merges,
    page: { orientation: 'landscape', paperSize: 9, fitToWidth: 1 },
  }];

  return {
    buffer: buildXlsx(sheets, { title: `Comparativo - ${quote.title || ''}`, theme: T }),
    filename: `comparativo_${slug(quote.title || 'orcamento')}.xlsx`,
  };
}

function colLetter(n) {
  let s = '';
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}
