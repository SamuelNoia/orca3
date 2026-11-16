// Deixa a base zerada, com um unico produto de teste para validar o fluxo.
// Uso: node tools/seed-inicial.js [--force]
import { openDb, get, run, tx, nowIso, setSetting } from '../src/db.js';
import { DB_FILE } from '../src/config.js';

const force = process.argv.includes('--force');

openDb(DB_FILE);

const jaTem = Number(get('SELECT COUNT(*) AS n FROM suppliers')?.n || 0);
if (jaTem > 0 && !force) {
  console.log(`A base ja possui ${jaTem} fornecedor(es). Use --force para zerar e recarregar.`);
  process.exit(0);
}

const resultado = tx(() => {
  if (force) {
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
    'Fornecedor Exemplo',
    'FORNECEDOR EXEMPLO LTDA',
    '00.000.000/0001-00',
    '',
    'Rua Exemplo, 100 - Cidade',
    '(00) 00000-0000 | contato@exemplo.com',
    'contato@exemplo.com',
    'Razão Social: FORNECEDOR EXEMPLO LTDA\nCNPJ / PIX: 00.000.000/0001-00\nBanco: 001 - Agência 0000-0 - Conta 00000-0',
    nowIso(),
  );

  const produto = run(
    `INSERT INTO products (supplier_id, internal_code, description, unit_price, brand, stock,
       manufacturer_code, ean, reference, ncm, unit, active, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`,
    fornecedor.lastId,
    '0001',
    'PRODUTO TESTE - CABO FLEXÍVEL 2,5 MM',
    10.00,
    'EXEMPLO',
    100,
    'TESTE-0001',
    '7890000000001',
    'REF-TESTE-0001',
    '85444200',
    'M',
    nowIso(),
  );

  setSetting('default_margin_pct', '60');
  setSetting('default_margin_mode', 'markup');
  setSetting('default_service_pct', '0');
  setSetting('default_valid_days', '15');

  return { fornecedor: fornecedor.lastId, produto: produto.lastId };
});

console.log('Base inicial pronta (zerada):');
console.log(`  fornecedor de teste: id ${resultado.fornecedor}`);
console.log(`  produto de teste:    id ${resultado.produto}`);
console.log('  clientes, projetos e orcamentos: nenhum');
console.log('\nProximo passo: entre no sistema, cadastre um cliente e crie o primeiro orcamento.');
