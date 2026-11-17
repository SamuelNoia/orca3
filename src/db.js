// Camada de acesso ao SQLite (node:sqlite, nativo do Node 22.5+).
// Nenhuma dependencia externa.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',      -- admin | user
  active        INTEGER NOT NULL DEFAULT 1,
  phone         TEXT,
  created_at    TEXT NOT NULL,
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  cnpj       TEXT,
  ie         TEXT,
  address    TEXT,
  contact    TEXT,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  legal_name TEXT,
  cnpj       TEXT,
  ie         TEXT,
  address    TEXT,
  contact    TEXT,
  email      TEXT,
  phone      TEXT,
  bank_info  TEXT,
  layout     TEXT NOT NULL DEFAULT 'classico',     -- layout visual do orcamento
  is_own     INTEGER NOT NULL DEFAULT 0,           -- 1 = empresa emitente da proposta
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id       INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  internal_code     TEXT,
  description       TEXT NOT NULL,
  unit_price        REAL NOT NULL DEFAULT 0,
  brand             TEXT,
  stock             REAL NOT NULL DEFAULT 0,
  manufacturer_code TEXT,
  ean               TEXT,
  reference         TEXT,
  ncm               TEXT,
  unit              TEXT DEFAULT 'UN',
  active            INTEGER NOT NULL DEFAULT 1,
  batch_id          INTEGER,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS ix_products_ean      ON products(ean);
CREATE INDEX IF NOT EXISTS ix_products_mfr      ON products(manufacturer_code);
CREATE INDEX IF NOT EXISTS ix_products_ref      ON products(reference);
CREATE INDEX IF NOT EXISTS ix_products_key      ON products(supplier_id, internal_code, ean, manufacturer_code);

CREATE TABLE IF NOT EXISTS import_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id   INTEGER NOT NULL,
  user_id       INTEGER,
  filename      TEXT,
  mode          TEXT,
  rows_total    INTEGER DEFAULT 0,
  rows_imported INTEGER DEFAULT 0,
  rows_updated  INTEGER DEFAULT 0,
  rows_skipped  INTEGER DEFAULT 0,
  mapping       TEXT,
  errors        TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_mappings (
  supplier_id INTEGER PRIMARY KEY,
  sheet_name  TEXT,
  header_row  INTEGER,
  mapping     TEXT NOT NULL,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id),
  name       TEXT NOT NULL,
  code       TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT,
  project_id          INTEGER REFERENCES projects(id),
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  supplier_id         INTEGER REFERENCES suppliers(id),   -- empresa emitente da proposta
  title               TEXT NOT NULL,                      -- unidade / local
  location            TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',      -- draft | sent | approved | rejected
  margin_pct          REAL NOT NULL DEFAULT 0,
  margin_mode         TEXT NOT NULL DEFAULT 'markup',     -- markup | margin
  service_pct         REAL NOT NULL DEFAULT 0,
  service_code        TEXT DEFAULT 'SERV-01',
  service_description TEXT,
  rounding            REAL NOT NULL DEFAULT 0,            -- arredondar preco para cima (R$)
  valid_days          INTEGER NOT NULL DEFAULT 15,
  observations        TEXT,
  total_cache         REAL NOT NULL DEFAULT 0,
  created_by          INTEGER,
  created_at          TEXT NOT NULL,
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS ix_quotes_project ON quotes(project_id);
CREATE INDEX IF NOT EXISTS ix_quotes_client  ON quotes(client_id);

CREATE TABLE IF NOT EXISTS quote_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  internal_code TEXT,
  description TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_cost   REAL NOT NULL DEFAULT 0,
  price_override REAL,
  product_id  INTEGER,
  supplier_id INTEGER,
  unit        TEXT DEFAULT 'UN',
  note        TEXT,
  is_service  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_items_quote ON quote_items(quote_id);

CREATE TABLE IF NOT EXISTS quote_item_offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES quote_items(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL,
  product_id  INTEGER,
  unit_cost   REAL NOT NULL,
  stock       REAL,
  brand       TEXT,
  lead_time   TEXT
);
CREATE INDEX IF NOT EXISTS ix_offers_item ON quote_item_offers(item_id);

CREATE TABLE IF NOT EXISTS quote_expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'percent',   -- percent | fixed
  value       REAL NOT NULL DEFAULT 0,
  base        TEXT NOT NULL DEFAULT 'products',  -- products | services | total
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_exp_quote ON quote_expenses(quote_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  detail     TEXT,
  created_at TEXT NOT NULL
);
`;

export const DEFAULTS = {
  app_name: 'Central de Orcamentos',
  default_margin_pct: '60',
  default_margin_mode: 'markup',
  default_service_pct: '65',
  default_valid_days: '15',
  company_short: 'EMPRESA EXEMPLO',
};

let _db = null;
let _file = null;

/** Abre (ou cria) o banco e aplica o schema. */
export function openDb(file) {
  _file = path.resolve(file);
  fs.mkdirSync(path.dirname(_file), { recursive: true });
  const database = new DatabaseSync(_file);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA synchronous = NORMAL;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec(SCHEMA);
  _db = database;
  migrate();
  seedDefaults();
  return database;
}

/** Ajustes de schema para bancos criados em versoes anteriores. */
function migrate() {
  const colunas = (tabela) => {
    try { return all(`PRAGMA table_info(${tabela})`).map((c) => c.name); } catch { return []; }
  };
  if (!colunas('quote_items').includes('price_override')) {
    try { exec('ALTER TABLE quote_items ADD COLUMN price_override REAL'); } catch { /* ja existe */ }
  }
  if (!colunas('suppliers').includes('layout')) {
    try { exec("ALTER TABLE suppliers ADD COLUMN layout TEXT NOT NULL DEFAULT 'classico'"); } catch { /* ja existe */ }
  }
}

export function db() {
  if (!_db) throw new Error('Banco nao inicializado. Chame openDb() primeiro.');
  return _db;
}

export function dbFile() {
  return _file;
}

export function closeDb() {
  if (_db) { try { _db.close(); } catch { /* ignore */ } }
  _db = null;
}

// ---------------------------------------------------------------- helpers
function norm(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    return p;
  });
}

export function all(sql, ...params) {
  return db().prepare(sql).all(...norm(params));
}

export function get(sql, ...params) {
  return db().prepare(sql).get(...norm(params)) ?? null;
}

export function run(sql, ...params) {
  const r = db().prepare(sql).run(...norm(params));
  return { changes: Number(r.changes ?? 0), lastId: Number(r.lastInsertRowid ?? 0) };
}

export function exec(sql) {
  db().exec(sql);
}

let _depth = 0;
/** Executa fn dentro de uma transacao. Suporta aninhamento por savepoint. */
export function tx(fn) {
  const d = db();
  const sp = `sp_${_depth}`;
  if (_depth === 0) d.exec('BEGIN IMMEDIATE');
  else d.exec(`SAVEPOINT ${sp}`);
  _depth += 1;
  try {
    const out = fn();
    _depth -= 1;
    if (_depth === 0) d.exec('COMMIT');
    else d.exec(`RELEASE ${sp}`);
    return out;
  } catch (err) {
    _depth -= 1;
    try {
      if (_depth === 0) d.exec('ROLLBACK');
      else d.exec(`ROLLBACK TO ${sp}`);
    } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------- settings
export function setting(key, fallback = '') {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, String(value ?? ''),
  );
}

function seedDefaults() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!get('SELECT 1 AS x FROM settings WHERE key = ?', k)) setSetting(k, v);
  }
}

export function audit(userId, action, entity = null, entityId = null, detail = null) {
  try {
    run(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?)',
      userId, action, entity, entityId, detail, new Date().toISOString(),
    );
  } catch { /* auditoria nunca deve quebrar a operacao */ }
}

export function nowIso() {
  return new Date().toISOString();
}
