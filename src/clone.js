// Clonagem de orcamento: base do "clonar" e do "perdedor" do projeto.
import { get, run, tx, nowIso } from './db.js';
import { getProduct, matchingOffers, loadQuote } from './repo.js';
import { round2 } from './calc.js';

/** Procura o mesmo item (EAN / cod. fabricante / referencia) no catalogo de outro fornecedor. */
export function produtoDoFornecedor(item, supplierId) {
  const conds = [];
  const params = [supplierId];
  if (item.ean) { conds.push('ean = ?'); params.push(item.ean); }
  if (item.manufacturer_code) { conds.push('manufacturer_code = ?'); params.push(item.manufacturer_code); }
  if (item.reference) { conds.push('reference = ?'); params.push(item.reference); }
  if (!conds.length) return null;
  return get(
    `SELECT * FROM products
      WHERE supplier_id = ? AND active = 1 AND (${conds.join(' OR ')})
      ORDER BY unit_price ASC LIMIT 1`,
    ...params,
  );
}

/**
 * Cria um novo orcamento a partir de outro.
 * mode 'preco': preco de venda = preco do original * (1 + adjustPct/100)
 * mode 'custo': recalcula pelo custo (do fornecedor escolhido) com a margem
 */
export function clonarOrcamento({
  origemId,
  userId,
  title,
  emitterId,
  itemSupplierId = null,
  mode = 'preco',
  adjustPct = 0,
  marginPct = null,
  servicePct = null,
  validDays = null,
  copyExpenses = true,
  adjustField = 0,
}) {
  const full = loadQuote(origemId);
  if (!full) return null;

  const margem = marginPct === null ? full.quote.margin_pct : marginPct;
  const servico = servicePct === null ? full.quote.service_pct : servicePct;
  const validade = validDays === null ? full.quote.valid_days : validDays;
  const emitente = emitterId || full.quote.supplier_id || null;

  return tx(() => {
    const r = run(
      `INSERT INTO quotes (code, project_id, client_id, supplier_id, title, location, status,
        margin_pct, margin_mode, service_pct, service_code, service_description, rounding, valid_days,
        observations, adjust_pct, created_by, created_at)
       VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?)`,
      null, full.quote.project_id, full.quote.client_id, emitente,
      title || `${full.quote.title} (cópia)`, full.quote.location,
      margem, full.quote.margin_mode, servico, full.quote.service_code, full.quote.service_description,
      full.quote.rounding, validade, full.quote.observations, adjustField, userId, nowIso(),
    );
    const quoteId = r.lastId;
    run('UPDATE quotes SET code = ? WHERE id = ?', `ORC-${String(quoteId).padStart(4, '0')}`, quoteId);

    full.items.forEach((it, i) => {
      let cost = it.unit_cost;
      let supplierId = it.supplier_id;
      let productId = it.product_id;

      if (itemSupplierId) {
        const alt = produtoDoFornecedor(it, itemSupplierId);
        if (alt) {
          cost = alt.unit_price;
          supplierId = alt.supplier_id;
          productId = alt.id;
        }
      }

      let override = null;
      if (mode === 'preco') {
        const base = full.calc.lines[i]?.unit_price ?? 0;
        override = round2(base * (1 + adjustPct / 100));
      }

      const ir = run(
        `INSERT INTO quote_items (quote_id, position, internal_code, description, qty, unit_cost,
           price_override, product_id, supplier_id, unit, note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        quoteId, i + 1, it.internal_code, it.description, it.qty, cost, override,
        productId, supplierId, it.unit, it.note,
      );

      if (productId) {
        const prod = getProduct(productId);
        if (prod) {
          run(
            `INSERT INTO quote_item_offers (item_id, supplier_id, product_id, unit_cost, stock, brand)
             VALUES (?,?,?,?,?,?)`,
            ir.lastId, prod.supplier_id, prod.id, prod.unit_price, prod.stock, prod.brand,
          );
          for (const alt of matchingOffers(prod)) {
            run(
              `INSERT INTO quote_item_offers (item_id, supplier_id, product_id, unit_cost, stock, brand)
               VALUES (?,?,?,?,?,?)`,
              ir.lastId, alt.supplier_id, alt.product_id, alt.unit_price, alt.stock, alt.brand,
            );
          }
        }
      }
    });

    if (copyExpenses) {
      for (const e of full.expenses) {
        run(
          'INSERT INTO quote_expenses (quote_id, description, kind, value, base, position) VALUES (?,?,?,?,?,?)',
          quoteId, e.description, e.kind, e.value, e.base, e.position,
        );
      }
    }
    return quoteId;
  });
}
