// Importacao de catalogo de produtos a partir de planilhas.
// Cada fornecedor tem seu proprio layout: o mapeamento de colunas e detectado
// automaticamente e pode ser ajustado/salvo por fornecedor.
import { readTable, toNumber, toText, quoteSheet } from './xlsx.js';
import { all, get, run, tx, nowIso } from './db.js';

export const FIELDS = [
  { key: 'internal_code', label: 'Codigo interno / Cod Z', required: false },
  { key: 'description', label: 'Descricao', required: true },
  { key: 'unit_price', label: 'Valor unitario', required: true },
  { key: 'brand', label: 'Marca', required: false },
  { key: 'stock', label: 'Estoque', required: false },
  { key: 'manufacturer_code', label: 'Codigo do fabricante', required: false },
  { key: 'ean', label: 'Codigo de barras (EAN)', required: false },
  { key: 'reference', label: 'Referencia', required: false },
  { key: 'ncm', label: 'NCM', required: false },
  { key: 'unit', label: 'Unidade', required: false },
];

const SYNONYMS = {
  internal_code: ['cod z', 'codigo z', 'codz', 'codigo interno', 'cod interno', 'cod. interno', 'sku', 'cod produto', 'codigo produto', 'codigo', 'cod', 'codigo do produto', 'id produto'],
  description: ['descricao do produto', 'descricao dos produtos e servicos', 'descricao dos produtos', 'descricao', 'descricao do material', 'produto', 'nome do produto', 'nome', 'material', 'item', 'especificacao', 'desc'],
  unit_price: ['valor unitario', 'valor unit', 'valor unit.', 'vlr unitario', 'vlr unit', 'vlr. unit', 'preco unitario', 'preco unit', 'preco de venda', 'preco venda', 'valor de venda', 'valor venda', 'preco', 'valor', 'vl unit', 'v. unitario', 'v.unit', 'v unit', 'unitario', 'custo', 'custo unitario', 'preco custo'],
  brand: ['marca fabricante', 'marca/fabricante', 'marca', 'fabricante', 'brand', 'grife'],
  stock: ['quantidade em estoque', 'qtd em estoque', 'estoque atual', 'saldo em estoque', 'estoque disponivel', 'qtd estoque', 'qtde estoque', 'estoque', 'saldo', 'disponivel', 'qtd disp', 'quantidade'],
  manufacturer_code: ['codigo do fabricante', 'codigo fabricante', 'cod. fabricante', 'cod fabricante', 'part number', 'partnumber', 'ref fabricante', 'referencia fabricante', 'mpn', 'pn', 'cod fab', 'codigo fab'],
  ean: ['codigo de barras (ean)', 'codigo de barras', 'cod barras', 'codigo barras', 'cod. barras', 'c barras', 'ean13', 'ean 13', 'ean/gtin', 'gtin', 'ean', 'barras', 'cod ean', 'codigo ean'],
  reference: ['referencia interna', 'referencia', 'refer.', 'refer', 'ref interna', 'ref', 'modelo'],
  ncm: ['ncm/sh', 'codigo ncm', 'ncm', 'ncm sh', 'posicao ncm'],
  unit: ['unidade de medida', 'unidade', 'unid', 'un', 'umed', 'embalagem', 'emb'],
};

const norm = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function fieldForHeader(header) {
  const h = norm(header);
  if (!h) return null;
  let best = null;
  let bestScore = 0;
  for (const [field, aliases] of Object.entries(SYNONYMS)) {
    for (const alias of aliases) {
      const a = norm(alias);
      let score = 0;
      if (h === a) score = 100 + a.length;
      else if (h.startsWith(a) || h.endsWith(a)) score = 60 + a.length;
      else if (h.includes(a)) score = 30 + a.length;
      if (score > bestScore) { bestScore = score; best = field; }
    }
  }
  return bestScore >= 30 ? best : null;
}

/** Detecta a linha de cabecalho e o mapeamento coluna->campo. */
export function detectMapping(rows, maxScan = 25) {
  let best = { headerRow: -1, mapping: {}, score: 0 };

  for (let r = 0; r < Math.min(rows.length, maxScan); r += 1) {
    const row = rows[r] || [];
    const mapping = {};
    const usedFields = new Set();
    row.forEach((cell, c) => {
      const field = fieldForHeader(cell);
      if (field && !usedFields.has(field)) {
        mapping[field] = c;
        usedFields.add(field);
      }
    });
    const hasName = mapping.description !== undefined;
    const hasPrice = mapping.unit_price !== undefined;
    const score = Object.keys(mapping).length + (hasName ? 3 : 0) + (hasPrice ? 3 : 0);
    if (score > best.score) best = { headerRow: r, mapping, score };
  }

  if (best.headerRow < 0 || best.mapping.description === undefined) {
    // fallback posicional (padrao comum): cod, descricao, ..., valor
    return {
      headerRow: 0,
      mapping: { internal_code: 0, description: 1, unit_price: 4, brand: 2, stock: 3 },
      score: 0,
      fallback: true,
    };
  }
  return best;
}

/** Extrai registros normalizados a partir das linhas + mapeamento. */
export function extractRecords(rows, mapping, headerRow) {
  const out = [];
  const errors = [];
  const start = (headerRow ?? 0) + 1;

  for (let r = start; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const pick = (field) => {
      const idx = mapping[field];
      if (idx === undefined || idx === null) return '';
      const v = row[idx];
      return v === undefined || v === null ? '' : v;
    };

    const description = toText(pick('description'));
    if (!description) continue;
    if (/^(total|subtotal|soma|valor total)\b/i.test(description)) continue;
    if (/^total/i.test(description)) continue;

    const price = toNumber(pick('unit_price'));
    const stock = toNumber(pick('stock'));

    if (price === null) {
      errors.push({ line: r + 1, message: `Valor unitario invalido para "${description}"`, skipped: true });
      continue;
    }

    out.push({
      line: r + 1,
      internal_code: toText(pick('internal_code')).slice(0, 60) || null,
      description: description.slice(0, 500),
      unit_price: price,
      brand: toText(pick('brand')).slice(0, 120) || null,
      stock: stock ?? 0,
      manufacturer_code: toText(pick('manufacturer_code')).slice(0, 80) || null,
      ean: toText(pick('ean')).replace(/\s/g, '').slice(0, 40) || null,
      reference: toText(pick('reference')).slice(0, 80) || null,
      ncm: toText(pick('ncm')).replace(/[^0-9.]/g, '').slice(0, 20) || null,
      unit: toText(pick('unit')).slice(0, 12) || 'UN',
    });
  }
  return { records: out, errors };
}

/** Le o arquivo e devolve preview (abas, cabecalho detectado, amostra). */
export function previewFile(buffer, filename) {
  const table = readTable(buffer, filename);
  const sheets = table.sheets.map((s) => {
    const det = detectMapping(s.rows);
    const { records, errors } = extractRecords(s.rows, det.mapping, det.headerRow);
    return {
      name: s.name,
      headerRow: det.headerRow,
      mapping: det.mapping,
      fallback: !!det.fallback,
      totalRows: s.rows.length,
      sample: records.slice(0, 8),
      count: records.length,
      errors: errors.slice(0, 10),
      headers: (s.rows[det.headerRow] || []).map((h) => toText(h)),
    };
  });
  return { format: table.format, sheets };
}

function productKey(p) {
  return [
    norm(p.internal_code), norm(p.ean), norm(p.manufacturer_code), norm(p.reference), norm(p.description),
  ].join('|');
}

/**
 * Importa registros para o catalogo de um fornecedor.
 * mode: 'merge' (atualiza/insere, mantem o que nao veio) | 'replace' (zera o catalogo antes)
 */
export function importProducts({ supplierId, userId, filename, mode = 'merge', records, mapping }) {
  return tx(() => {
    const now = nowIso();
    const batch = run(
      `INSERT INTO import_batches (supplier_id, user_id, filename, mode, rows_total, created_at)
       VALUES (?,?,?,?,?,?)`,
      supplierId, userId, filename, mode, records.length, now,
    );

    if (mode === 'replace') {
      run('DELETE FROM products WHERE supplier_id = ?', supplierId);
    }

    const existing = all('SELECT * FROM products WHERE supplier_id = ?', supplierId);
    const byKey = new Map();
    for (const p of existing) byKey.set(productKey(p), p);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const rec of records) {
      const key = productKey(rec);
      const found = byKey.get(key);
      if (found) {
        const changed = found.unit_price !== rec.unit_price
          || (found.stock ?? 0) !== (rec.stock ?? 0)
          || (found.brand || '') !== (rec.brand || '')
          || (found.description || '') !== (rec.description || '');
        if (!changed) { skipped += 1; continue; }
        run(
          `UPDATE products SET description=?, unit_price=?, brand=?, stock=?, manufacturer_code=?,
             ean=?, reference=?, ncm=?, unit=?, active=1, batch_id=?, updated_at=?
           WHERE id=?`,
          rec.description, rec.unit_price, rec.brand, rec.stock, rec.manufacturer_code,
          rec.ean, rec.reference, rec.ncm, rec.unit, batch.lastId, now, found.id,
        );
        updated += 1;
      } else {
        const r = run(
          `INSERT INTO products (supplier_id, internal_code, description, unit_price, brand, stock,
             manufacturer_code, ean, reference, ncm, unit, active, batch_id, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          supplierId, rec.internal_code, rec.description, rec.unit_price, rec.brand, rec.stock,
          rec.manufacturer_code, rec.ean, rec.reference, rec.ncm, rec.unit, batch.lastId, now,
        );
        byKey.set(key, { ...rec, id: r.lastId });
        inserted += 1;
      }
    }

    run(
      `UPDATE import_batches SET rows_imported=?, rows_updated=?, rows_skipped=?, mapping=?
       WHERE id=?`,
      inserted, updated, skipped, JSON.stringify(mapping || {}), batch.lastId,
    );

    return {
      batchId: batch.lastId,
      total: records.length,
      inserted,
      updated,
      skipped,
    };
  });
}

export function saveMapping(supplierId, sheetName, headerRow, mapping) {
  run(
    `INSERT INTO supplier_mappings (supplier_id, sheet_name, header_row, mapping, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(supplier_id) DO UPDATE SET sheet_name=excluded.sheet_name,
       header_row=excluded.header_row, mapping=excluded.mapping, updated_at=excluded.updated_at`,
    supplierId, sheetName, headerRow, JSON.stringify(mapping), nowIso(),
  );
}

export function getMapping(supplierId) {
  const row = get('SELECT * FROM supplier_mappings WHERE supplier_id = ?', supplierId);
  if (!row) return null;
  try {
    return { ...row, mapping: JSON.parse(row.mapping) };
  } catch { return null; }
}

export function lastBatch(supplierId) {
  return get(
    'SELECT * FROM import_batches WHERE supplier_id = ? ORDER BY id DESC LIMIT 1',
    supplierId,
  );
}
