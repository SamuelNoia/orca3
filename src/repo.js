// Consultas e montagem de dados usados pelas telas.
import { all, get, run, nowIso } from './db.js';
import { computeQuote } from './calc.js';

// ---------------------------------------------------------------- clientes
export function listClients(q = '') {
  const term = `%${q.trim()}%`;
  return all(
    `SELECT c.*, (SELECT COUNT(*) FROM quotes qq WHERE qq.client_id = c.id) AS quotes_count
       FROM clients c
      WHERE c.active = 1 AND (? = '%%' OR c.name LIKE ? OR c.cnpj LIKE ?)
      ORDER BY c.name COLLATE NOCASE`,
    term, term, term,
  );
}

export function getClient(id) {
  return get('SELECT * FROM clients WHERE id = ?', id);
}

export function clientOptions(selected = null) {
  return listClients().map((c) => ({ value: c.id, label: c.name }));
}

// ---------------------------------------------------------------- fornecedores
export function listSuppliers(onlyActive = false) {
  return all(
    `SELECT s.*,
            (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS products_count,
            (SELECT MAX(b.created_at) FROM import_batches b WHERE b.supplier_id = s.id) AS last_import
       FROM suppliers s
      ${onlyActive ? 'WHERE s.active = 1' : ''}
      ORDER BY s.is_own DESC, s.name COLLATE NOCASE`,
  );
}

export function getSupplier(id) {
  return get('SELECT * FROM suppliers WHERE id = ?', id);
}

export function ownSupplier() {
  return get('SELECT * FROM suppliers WHERE is_own = 1 AND active = 1 ORDER BY id LIMIT 1')
    || get('SELECT * FROM suppliers WHERE active = 1 ORDER BY id LIMIT 1');
}

export function saveSupplier(id, data) {
  if (id) {
    run(
      `UPDATE suppliers SET name=?, legal_name=?, cnpj=?, ie=?, address=?, contact=?, email=?,
        phone=?, bank_info=?, active=?, updated_at=? WHERE id=?`,
      data.name, data.legal_name, data.cnpj, data.ie, data.address, data.contact, data.email,
      data.phone, data.bank_info, data.active, nowIso(), id,
    );
    return id;
  }
  const r = run(
    `INSERT INTO suppliers (name, legal_name, cnpj, ie, address, contact, email, phone, bank_info, is_own, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    data.name, data.legal_name, data.cnpj, data.ie, data.address, data.contact, data.email,
    data.phone, data.bank_info, data.is_own ? 1 : 0, data.active ?? 1, nowIso(),
  );
  return r.lastId;
}

// ---------------------------------------------------------------- produtos
export function searchProducts({ q = '', supplierId = null, limit = 40, offset = 0 } = {}) {
  const term = `%${q.trim()}%`;
  const params = [term, term, term, term, term];
  let sql = `SELECT p.*, s.name AS supplier_name
               FROM products p JOIN suppliers s ON s.id = p.supplier_id
              WHERE p.active = 1
                AND (p.description LIKE ? OR p.internal_code LIKE ? OR p.ean LIKE ?
                     OR p.manufacturer_code LIKE ? OR p.reference LIKE ?)`;
  if (supplierId) { sql += ' AND p.supplier_id = ?'; params.push(supplierId); }
  sql += ' ORDER BY p.description COLLATE NOCASE LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return all(sql, ...params);
}

export function countProducts({ q = '', supplierId = null } = {}) {
  const term = `%${q.trim()}%`;
  const params = [term, term, term, term, term];
  let sql = `SELECT COUNT(*) AS n FROM products p WHERE p.active = 1
              AND (p.description LIKE ? OR p.internal_code LIKE ? OR p.ean LIKE ?
                   OR p.manufacturer_code LIKE ? OR p.reference LIKE ?)`;
  if (supplierId) { sql += ' AND p.supplier_id = ?'; params.push(supplierId); }
  return Number(get(sql, ...params)?.n || 0);
}

export function getProduct(id) {
  return get(
    `SELECT p.*, s.name AS supplier_name FROM products p
       JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`,
    id,
  );
}

/** Outros fornecedores que possuem o mesmo item (por EAN, codigo do fabricante ou referencia). */
export function matchingOffers(product) {
  const conditions = [];
  const params = [product.id];
  if (product.ean) { conditions.push('p.ean = ?'); params.push(product.ean); }
  if (product.manufacturer_code) { conditions.push('p.manufacturer_code = ?'); params.push(product.manufacturer_code); }
  if (product.reference) { conditions.push('p.reference = ?'); params.push(product.reference); }
  if (!conditions.length) return [];
  return all(
    `SELECT p.id AS product_id, p.supplier_id, p.unit_price, p.stock, p.brand,
            p.description, s.name AS supplier_name
       FROM products p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id <> ? AND p.active = 1 AND (${conditions.join(' OR ')})
      ORDER BY p.unit_price ASC`,
    ...params,
  );
}

// ---------------------------------------------------------------- projetos
export function listProjects() {
  return all(
    `SELECT pr.*, c.name AS client_name,
            (SELECT COUNT(*) FROM quotes q WHERE q.project_id = pr.id) AS quotes_count,
            (SELECT COALESCE(SUM(q.total_cache), 0) FROM quotes q WHERE q.project_id = pr.id) AS total
       FROM projects pr JOIN clients c ON c.id = pr.client_id
      ORDER BY pr.id DESC`,
  );
}

export function getProject(id) {
  return get(
    `SELECT pr.*, c.name AS client_name FROM projects pr
       JOIN clients c ON c.id = pr.client_id WHERE pr.id = ?`,
    id,
  );
}

export function projectQuotes(projectId) {
  return all('SELECT * FROM quotes WHERE project_id = ? ORDER BY id', projectId);
}

// ---------------------------------------------------------------- orcamentos
const QUOTE_SELECT = `
  SELECT q.*, c.name AS client_name, c.cnpj AS client_cnpj,
         pr.name AS project_name, s.name AS emitter_name
    FROM quotes q
    JOIN clients c ON c.id = q.client_id
    LEFT JOIN projects pr ON pr.id = q.project_id
    LEFT JOIN suppliers s ON s.id = q.supplier_id`;

export function listQuotes({ q = '', status = '', clientId = null, projectId = null, limit = 200 } = {}) {
  const params = [];
  const where = [];
  if (q) { where.push('(q.title LIKE ? OR c.name LIKE ? OR q.code LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { where.push('q.status = ?'); params.push(status); }
  if (clientId) { where.push('q.client_id = ?'); params.push(clientId); }
  if (projectId) { where.push('q.project_id = ?'); params.push(projectId); }
  params.push(limit);
  return all(
    `${QUOTE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY q.id DESC LIMIT ?`,
    ...params,
  );
}

export function getQuote(id) {
  return get(`${QUOTE_SELECT} WHERE q.id = ?`, id);
}

export function quoteItems(quoteId) {
  return all(
    `SELECT i.*, s.name AS supplier_name, p.brand AS brand, p.ean AS ean, p.reference AS reference,
            p.manufacturer_code AS manufacturer_code
       FROM quote_items i
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN products p ON p.id = i.product_id
      WHERE i.quote_id = ?
      ORDER BY i.position, i.id`,
    quoteId,
  );
}

export function quoteExpenses(quoteId) {
  return all('SELECT * FROM quote_expenses WHERE quote_id = ? ORDER BY position, id', quoteId);
}

export function offersByItem(quoteId) {
  const rows = all(
    `SELECT o.*, s.name AS supplier_name, p.description AS product_description
       FROM quote_item_offers o
       JOIN quote_items i ON i.id = o.item_id
       JOIN suppliers s ON s.id = o.supplier_id
       LEFT JOIN products p ON p.id = o.product_id
      WHERE i.quote_id = ?
      ORDER BY o.unit_cost ASC`,
    quoteId,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.item_id)) map.set(r.item_id, []);
    map.get(r.item_id).push(r);
  }
  return map;
}

/** Carrega o orcamento completo com itens, despesas, ofertas e calculo. */
export function loadQuote(id) {
  const quote = getQuote(id);
  if (!quote) return null;
  const items = quoteItems(id);
  const expenses = quoteExpenses(id);
  const calc = computeQuote(quote, items, expenses);
  const offers = offersByItem(id);
  const client = getClient(quote.client_id);
  const emitter = quote.supplier_id ? getSupplier(quote.supplier_id) : ownSupplier();
  const project = quote.project_id ? getProject(quote.project_id) : null;
  return { quote, items, expenses, calc, offers, client, emitter, project };
}

export function updateQuoteTotals(quoteId) {
  const full = loadQuote(quoteId);
  if (!full) return;
  run('UPDATE quotes SET total_cache = ?, updated_at = ? WHERE id = ?', full.calc.total, nowIso(), quoteId);
}

export function dashboardStats() {
  const quotes = get("SELECT COUNT(*) AS n FROM quotes")?.n || 0;
  const approved = get("SELECT COUNT(*) AS n FROM quotes WHERE status = 'approved'")?.n || 0;
  const total = get('SELECT COALESCE(SUM(total_cache),0) AS n FROM quotes')?.n || 0;
  const clients = get('SELECT COUNT(*) AS n FROM clients WHERE active = 1')?.n || 0;
  const suppliers = get('SELECT COUNT(*) AS n FROM suppliers WHERE active = 1')?.n || 0;
  const products = get('SELECT COUNT(*) AS n FROM products WHERE active = 1')?.n || 0;
  return { quotes, approved, total, clients, suppliers, products };
}
