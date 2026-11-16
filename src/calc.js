// Motor de precificacao dos orcamentos.
//
// Modelo:
//   preco_unit = custo aplicado com margem (markup sobre o custo OU margem sobre a venda)
//   produtos   = soma(qtd * preco_unit)
//   servico    = produtos * service_pct
//   despesas   = itens percentuais (sobre produtos/servico/total) + itens fixos
//   total      = produtos + servico + despesas
//
// Um item de despesa com valor negativo funciona como desconto.

export function round2(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function ceilTo(value, step) {
  if (!step || step <= 0) return round2(value);
  const r = Math.ceil((value - 1e-9) / step) * step;
  return round2(r);
}

/**
 * Preco unitario de venda a partir do custo.
 * marginMode: 'markup' (custo * (1+m)) | 'margin' (custo / (1-m))
 */
export function unitPriceFor(cost, marginPct, marginMode = 'markup', rounding = 0) {
  const c = Number(cost) || 0;
  const m = (Number(marginPct) || 0) / 100;
  let price;
  if (marginMode === 'margin') {
    const denom = 1 - m;
    price = denom > 0.0001 ? c / denom : c;
  } else {
    price = c * (1 + m);
  }
  return rounding > 0 ? ceilTo(price, rounding) : round2(price);
}

/**
 * Calcula o orcamento inteiro.
 * @param {object} quote  { service_pct, margin_pct, margin_mode, rounding }
 * @param {Array}  items  [{ qty, unit_cost }]
 * @param {Array}  expenses [{ kind:'percent'|'fixed', value, base:'products'|'services'|'total', description }]
 */
export function computeQuote(quote, items = [], expenses = []) {
  const marginPct = Number(quote.margin_pct) || 0;
  const marginMode = quote.margin_mode === 'margin' ? 'margin' : 'markup';
  const rounding = Number(quote.rounding) || 0;
  const servicePct = Number(quote.service_pct) || 0;

  let costTotal = 0;
  const lines = items.map((it, i) => {
    const qty = Number(it.qty) || 0;
    const cost = Number(it.unit_cost) || 0;
    const unit = unitPriceFor(cost, marginPct, marginMode, rounding);
    const total = round2(qty * unit);
    costTotal += qty * cost;
    return {
      ...it,
      position: it.position ?? i + 1,
      unit_price: unit,
      line_total: total,
      line_cost: round2(qty * cost),
      margin_value: round2(total - qty * cost),
    };
  });

  const productsTotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const serviceValue = round2(productsTotal * (servicePct / 100));

  // Progressivo: cada despesa percentual incide sobre o acumulado das linhas acima,
  // exatamente como a formula do Excel (=SOMA(das linhas anteriores) * percentual).
  let running = round2(productsTotal + serviceValue);
  const expenseLines = expenses.map((e, i) => {
    const value = Number(e.value) || 0;
    const kind = e.kind === 'fixed' ? 'fixed' : 'percent';
    const base = e.base || 'products';
    let amount;
    if (kind === 'fixed') {
      amount = round2(value);
    } else {
      const baseValue = base === 'services' ? serviceValue : base === 'total' ? running : productsTotal;
      amount = round2(baseValue * (value / 100));
    }
    running = round2(running + amount);
    return {
      ...e,
      position: e.position ?? i + 1,
      kind,
      base,
      amount,
    };
  });

  const expensesTotal = round2(expenseLines.reduce((s, e) => s + e.amount, 0));
  const fixedTotal = round2(
    expenseLines.filter((e) => e.kind === 'fixed').reduce((s, e) => s + e.amount, 0),
  );
  const total = round2(productsTotal + serviceValue + expensesTotal);

  const profit = round2(total - costTotal);
  const effectiveMargin = total > 0 ? round2((profit / total) * 100) : 0;
  const markupReal = costTotal > 0 ? round2(((total / costTotal) - 1) * 100) : 0;

  return {
    lines,
    expenseLines,
    productsTotal,
    costTotal: round2(costTotal),
    serviceValue,
    expensesTotal,
    fixedTotal,
    total,
    profit,
    effectiveMargin,
    markupReal,
    servicePct,
    marginPct,
    marginMode,
    rounding,
    itemCount: lines.length,
    qtyTotal: round2(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
  };
}

export function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtNum(v, digits = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtQty(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n)
    ? n.toLocaleString('pt-BR')
    : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function fmtPct(v, digits = 1) {
  const n = Number(v) || 0;
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
