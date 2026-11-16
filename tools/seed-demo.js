// Carrega os dados do orcamento consolidado da Z Materiais para dentro da plataforma.
// Uso:  node tools/seed-demo.js "caminho/da/planilha.xlsx" [--force]
import fs from 'node:fs';
import path from 'node:path';
import { openDb, get, run, all, tx, nowIso, setSetting } from '../src/db.js';
import { DB_FILE } from '../src/config.js';
import { readTable, toNumber, toText } from '../src/xlsx.js';
import { computeQuote, round2 } from '../src/calc.js';
import { updateQuoteTotals } from '../src/repo.js';

const DEFAULT_FILE = 'C:\\Users\\SAMUEL\\Nextcloud\\SEGTEC\\PROJETOS-ESCOLAS-10-2026\\ORCAMENTO_CONSOLIDADO_ZMATERIAIS_ISACI_FINAL.xlsx';
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_FILE;
const force = process.argv.includes('--force');

if (!fs.existsSync(file)) {
  console.error(`Planilha nao encontrada: ${file}`);
  process.exit(1);
}

openDb(DB_FILE);

const jaTem = get("SELECT id FROM suppliers WHERE name = 'Z MATERIAIS'");
if (jaTem && !force) {
  console.log('A base inicial ja foi carregada. Use --force para carregar de novo.');
  process.exit(0);
}
const table = readTable(fs.readFileSync(file), path.basename(file));
const custos = table.sheets.find((s) => s.name.toUpperCase().includes('CUSTOS'));
if (!custos) {
  console.error('A planilha nao tem a aba CUSTOS.');
  process.exit(1);
}

// agrupa as linhas por escola mantendo a ordem
const grupos = new Map();
for (let i = 3; i < custos.rows.length; i += 1) {
  const row = custos.rows[i];
  if (!row) continue;
  const [escola, cod, desc, qty, val] = row;
  if (!desc) continue;
  const chave = toText(escola);
  if (!grupos.has(chave)) grupos.set(chave, []);
  grupos.get(chave).push({
    internal_code: toText(cod) || null,
    description: toText(desc),
    qty: toNumber(qty) ?? 1,
    unit_cost: toNumber(val) ?? 0,
  });
}

const resultado = tx(() => {
  if (force) {
    // reset limpo dos dados operacionais (usuarios sao preservados)
    run('DELETE FROM quote_item_offers');
    run('DELETE FROM quote_items');
    run('DELETE FROM quote_expenses');
    run('DELETE FROM quotes');
    run('DELETE FROM projects');
    run('DELETE FROM clients');
    run('DELETE FROM products');
    run('DELETE FROM import_batches');
    run('DELETE FROM supplier_mappings');
    run('DELETE FROM suppliers');
    run(`DELETE FROM sqlite_sequence WHERE name IN
      ('quotes','quote_items','quote_item_offers','quote_expenses','projects','clients','products','suppliers','import_batches')`);
  }

  const fornecedor = run(
    `INSERT INTO suppliers (name, legal_name, cnpj, ie, address, contact, email, bank_info, is_own, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,1,?)`,
    'Z MATERIAIS',
    'Z MATERIAL ELETRICO LTDA',
    '08.605.022/0001-97',
    '15.283.872',
    'PA 160, Qd 06G, Lt 07 - Cidade Jardim, Parauapebas - PA',
    '(94) 99223-8524 / 2123-0008 | zmateriaiseletricos@gmail.com',
    'zmateriaiseletricos@gmail.com',
    'Banco do Brasil (001)  |  Agência: 3245-0  |  Conta Corrente: 107724-4',
    nowIso(),
  );
  const supplierId = fornecedor.lastId;

  const cliente = run(
    `INSERT INTO clients (name, cnpj, ie, address, contact, active, created_at)
     VALUES (?,?,?,?,?,1,?)`,
    'ISACI - INST. SUSTENTABILIDADE DA AMAZONIA COM CIENCIA E INOVACAO',
    '51.798.925/0001-60',
    '75.091.198-0',
    'Ave Perimetral da Ciencia, SN, Andar 3 Sala 9 - Belém - PA',
    'Diretoria ISACI',
    nowIso(),
  );
  const clientId = cliente.lastId;

  const projeto = run(
    'INSERT INTO projects (client_id, name, code, created_at) VALUES (?,?,?,?)',
    clientId, 'Projetos Escolas 10/2026', 'ESCOLAS-10-2026', nowIso(),
  );
  const projectId = projeto.lastId;

  // catalogo (deduplicado)
  const vistos = new Set();
  let produtos = 0;
  for (const itens of grupos.values()) {
    for (const item of itens) {
      const chave = `${item.internal_code}|${item.description}`.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      run(
        `INSERT INTO products (supplier_id, internal_code, description, unit_price, stock, unit, active, updated_at)
         VALUES (?,?,?,?,0,'UN',1,?)`,
        supplierId, item.internal_code, item.description, item.unit_cost, nowIso(),
      );
      produtos += 1;
    }
  }

  // um orcamento por escola — usa os titulos das abas do arquivo original
  const nomesAbas = table.sheets
    .map((s) => s.name)
    .filter((n) => /^or[çc]amento\s*-/i.test(n))
    .map((n) => n.replace(/^or[çc]amento\s*-\s*/i, '').trim());

  let orcamentos = 0;
  let indice = 0;
  for (const [escola, itens] of grupos) {
    const titulo = nomesAbas[indice] || tituloCurto(escola);
    indice += 1;
    const quote = {
      title: titulo,
      location: `Redes, Elétrica e CFTV - ${escola}`,
      margin_pct: 60,
      margin_mode: 'markup',
      service_pct: 65,
      valid_days: 15,
      rounding: 0,
    };
    const calc = computeQuote(quote, itens, []);

    const q = run(
      `INSERT INTO quotes (code, project_id, client_id, supplier_id, title, location, status,
        margin_pct, margin_mode, service_pct, service_code, service_description, valid_days, total_cache, created_at)
       VALUES (?,?,?,?,?,?,'draft',?,?,?,'SERV-01',?,?,?,?)`,
      null, projectId, clientId, supplierId, quote.title, quote.location,
      quote.margin_pct, quote.margin_mode, quote.service_pct,
      'SERVIÇO ESPECIALIZADO DE INSTALAÇÃO E MONTAGEM TÉCNICA',
      quote.valid_days, calc.total, nowIso(),
    );
    run('UPDATE quotes SET code = ? WHERE id = ?', `ORC-${String(q.lastId).padStart(4, '0')}`, q.lastId);

    itens.forEach((item, i) => {
      const prod = get(
        'SELECT id FROM products WHERE supplier_id = ? AND internal_code IS ? AND description = ? LIMIT 1',
        supplierId, item.internal_code, item.description,
      );
      run(
        `INSERT INTO quote_items (quote_id, position, internal_code, description, qty, unit_cost, product_id, supplier_id, unit)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        q.lastId, i + 1, item.internal_code, item.description, item.qty, item.unit_cost,
        prod?.id || null, supplierId, 'UN',
      );
    });
    orcamentos += 1;
    console.log(`  ${quote.title.padEnd(36)} itens=${String(itens.length).padStart(2)}  total=${calc.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  }

  setSetting('default_margin_pct', '60');
  setSetting('default_margin_mode', 'markup');
  setSetting('default_service_pct', '65');

  return { supplierId, clientId, projectId, produtos, orcamentos };
});

console.log('\nBase carregada:');
console.log(`  fornecedor: ${resultado.supplierId}`);
console.log(`  cliente:    ${resultado.clientId}`);
console.log(`  projeto:    ${resultado.projectId}`);
console.log(`  produtos:   ${resultado.produtos}`);
console.log(`  orcamentos: ${resultado.orcamentos}`);
console.log('\nAcesse http://127.0.0.1:3000');

function tituloCurto(escola) {
  const bruto = String(escola).trim();
  const semPrefixo = bruto.replace(/^CENTRO DE FORMA[ÇC][ÃA]O\s+/i, '');
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o']);
  const capitalizar = (txt) => txt
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');

  const nome = capitalizar(semPrefixo);
  if (/^EMEB\s+/i.test(bruto)) return `EMEB ${nome.replace(/^Emeb\s+/i, '')}`;
  return nome;
}
