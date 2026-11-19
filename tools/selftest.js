// Teste de ponta a ponta. Sobe uma instancia isolada (banco temporario),
// percorre as telas como um usuario real e valida a planilha gerada.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readTable, zipRead } from '../src/xlsx.js';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-test-'));
const DB_PATH = path.join(TMP, 'teste.db');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

function section(title) {
  console.log(`\n== ${title}`);
}

// ---------------------------------------------------------------- cliente HTTP
class Http {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  get cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  store(res) {
    const list = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of list) {
      const [pair] = String(raw).split(';');
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, urlPath, { form, files, raw } = {}) {
    const headers = {};
    let body;
    if (this.cookies.size) headers.Cookie = this.cookieHeader;

    if (files && files.length) {
      const boundary = `----orc${Math.random().toString(16).slice(2)}`;
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      const parts = [];
      for (const [k, v] of Object.entries(form || {})) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      }
      for (const f of files) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type || 'application/octet-stream'}\r\n\r\n`));
        parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
        parts.push(Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      body = Buffer.concat(parts);
    } else if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (raw) {
      body = raw;
      headers['Content-Type'] = 'application/octet-stream';
    }

    const res = await fetch(this.base + urlPath, {
      method, headers, body, redirect: 'manual',
    });
    this.store(res);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    return {
      status: res.status,
      location: res.headers.get('location'),
      type,
      buffer: buf,
      text: type.includes('text/html') || type.includes('application/json') ? buf.toString('utf8') : '',
    };
  }

  get(p) { return this.request('GET', p); }
  post(p, form) { return this.request('POST', p, { form }); }
}

function hasNestedForm(html) {
  const re = /<\/?form\b/gi;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].toLowerCase() === '<form') {
      if (depth > 0) return true;
      depth += 1;
    } else {
      depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

function tokenOf(html) {
  const m = /name="_csrf" value="([^"]+)"/.exec(html);
  return m ? m[1] : '';
}

function waitForServer(tries = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = async () => {
      n += 1;
      try {
        const res = await fetch(`${BASE}/login`);
        if (res.ok) return resolve();
      } catch { /* ainda subindo */ }
      if (n > tries) return reject(new Error('Servidor nao respondeu.'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

// ---------------------------------------------------------------- execucao
const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_FILE: DB_PATH,
    DATA_DIR: TMP,
    ADMIN_EMAIL: 'admin@teste.local',
    ADMIN_PASSWORD: 'senha12345',
  },
  stdio: 'ignore',
});

async function main() {
  await waitForServer();
  const http = new Http(BASE);

  section('Autenticacao');
  const login = await http.get('/login');
  ok('pagina de login carrega', login.status === 200 && login.text.includes('Central de Orçamentos'));

  const semToken = await http.post('/login', { email: 'admin@teste.local', password: 'senha12345' });
  ok('POST sem token CSRF e recusado', semToken.status === 400, `status=${semToken.status}`);

  const badLogin = await http.post('/login', {
    _csrf: tokenOf(login.text), email: 'admin@teste.local', password: 'errada', next: '/',
  });
  ok('senha incorreta nao entra', badLogin.status === 401 || badLogin.text.includes('inválidos'));

  const goodLogin = await http.post('/login', {
    _csrf: tokenOf(login.text), email: 'admin@teste.local', password: 'senha12345', next: '/',
  });
  ok('login valido redireciona', goodLogin.status === 303 && goodLogin.location === '/');

  const dash = await http.get('/');
  ok('painel abre autenticado', dash.status === 200 && dash.text.includes('Painel'));

  section('Clientes');
  const clientes = await http.get('/clientes');
  ok('lista de clientes abre', clientes.status === 200);
  const novoCliente = await http.get('/clientes/novo');
  const c1 = await http.post('/clientes', {
    _csrf: tokenOf(novoCliente.text),
    name: 'CLIENTE TESTE LTDA',
    cnpj: '11.222.333/0001-44',
    ie: '123.456.789',
    address: 'Rua do Teste, 100 - Cidade',
    contact: 'Maria Silva',
    phone: '(00) 90000-0000',
  });
  ok('cliente criado', c1.status === 303, `status=${c1.status}`);

  section('Fornecedores e importacao de planilha');
  const novoForn = await http.get('/fornecedores/novo');
  const f1 = await http.post('/fornecedores', {
    _csrf: tokenOf(novoForn.text),
    name: 'Fornecedor Alfa',
    legal_name: 'ALFA MATERIAIS ELETRICOS LTDA',
    cnpj: '11.111.111/0001-11',
    is_own: '1',
    bank_info: 'Banco do Brasil 001\nAgencia 3245-0\nConta 107724-4',
  });
  ok('fornecedor emitente criado', f1.status === 303);

  const fornecedores = await http.get('/fornecedores');
  ok('lista de fornecedores abre', fornecedores.status === 200 && fornecedores.text.includes('Fornecedor Alfa'));
  const idAlfa = Number((/\/fornecedores\/(\d+)"/.exec(fornecedores.text) || [])[1] || 0);
  ok('id do fornecedor identificado', idAlfa > 0, `id=${idAlfa}`);

  const csvAlfa = [
    'Descrição;Valor Unitário;Marca;Estoque;Código Fabricante;EAN;Referência;NCM',
    'CAIXA CABO REDE SOHO;2135,00;SOHO;10;6881;7891234567890;REF6881;85369090',
    'CABO PP 2C 2,5 MM;17,00;SIL;300;661;7891234567891;REF661;85444200',
    'ELETRODUTO COLOR;24,00;TIGRE;100;7691;7891234567892;REF7691;39172900',
    'RACK 12U;2450,00;SOHO;7;10242;7891234567893;REF10242;85381000',
  ].join('\r\n');

  const impForm = await http.get(`/fornecedores/${idAlfa}/importar`);
  ok('tela de importacao abre', impForm.status === 200 && impForm.text.includes('Enviar planilha'));

  const envio = await http.request('POST', `/fornecedores/${idAlfa}/importar`, {
    form: { _csrf: tokenOf(impForm.text), mode: 'merge' },
    files: [{ field: 'file', filename: 'catalogo_alfa.csv', type: 'text/csv', data: Buffer.from(csvAlfa, 'utf8') }],
  });
  ok('upload redireciona para conferencia', envio.status === 303 && String(envio.location).includes('/importar/preview'), `status=${envio.status}`);

  const preview = await http.get(envio.location);
  ok('preview identifica 4 produtos', preview.status === 200 && preview.text.includes('4 produtos'), '');
  ok('preview mostra o mapeamento', preview.text.includes('Descrição') && preview.text.includes('EAN'));

  const token = (/name="t" value="([^"]+)"/.exec(preview.text) || [])[1] || '';
  const mapa = {};
  for (const key of ['internal_code', 'description', 'unit_price', 'brand', 'stock', 'manufacturer_code', 'ean', 'reference', 'ncm']) {
    const m = new RegExp(`name="map_${key}"[^>]*>[\\s\\S]*?<option value="([^"]*)" selected`).exec(preview.text);
    if (m && m[1] !== '') mapa[`map_${key}`] = m[1];
  }

  const confirm = await http.post(`/fornecedores/${idAlfa}/importar/confirmar`, {
    _csrf: tokenOf(preview.text), t: token, name: 'catalogo_alfa.csv', mode: 'merge', sheet: '0', ...mapa,
  });
  ok('importacao confirma', confirm.status === 303);
  ok('mensagem de importacao', decodeURIComponent(String(confirm.location)).includes('4 novos'), decodeURIComponent(String(confirm.location)));

  const listaProd = await http.get('/produtos');
  ok('catalogo mostra os 4 produtos', listaProd.status === 200 && (listaProd.text.match(/CAIXA CABO|CABO PP|ELETRODUTO|RACK/g) || []).length >= 4);

  // segundo fornecedor, mesmo EAN -> habilita comparativo
  const novoForn2 = await http.get('/fornecedores/novo');
  await http.post('/fornecedores', { _csrf: tokenOf(novoForn2.text), name: 'Fornecedor Beta', legal_name: 'BETA DISTRIBUIDORA' });
  const fornecedores2 = await http.get('/fornecedores');
  const idBeta = Number((/\/fornecedores\/(\d+)"/g.exec(fornecedores2.text) || [])[1] || 0);
  const ids = [...fornecedores2.text.matchAll(/\/fornecedores\/(\d+)"/g)].map((m) => Number(m[1]));
  const betaId = Math.max(...ids);

  const csvBeta = [
    'Descricao;Preco;Marca;Estoque;Part Number;GTIN;Ref;NCM',
    'CAIXA CABO REDE SOHO;1980,00;SOHO;5;6881;7891234567890;REF6881;85369090',
    'CABO PP 2C 2,5 MM;19,50;SIL;500;661;7891234567891;REF661;85444200',
    'RACK 12U;2390,00;SOHO;3;10242;7891234567893;REF10242;85381000',
  ].join('\n');

  const imp2 = await http.get(`/fornecedores/${betaId}/importar`);
  const envio2 = await http.request('POST', `/fornecedores/${betaId}/importar`, {
    form: { _csrf: tokenOf(imp2.text), mode: 'merge' },
    files: [{ field: 'file', filename: 'beta.csv', type: 'text/csv', data: Buffer.from(csvBeta, 'utf8') }],
  });
  const preview2 = await http.get(envio2.location);
  const token2 = (/name="t" value="([^"]+)"/.exec(preview2.text) || [])[1] || '';
  const mapa2 = {};
  for (const key of ['internal_code', 'description', 'unit_price', 'brand', 'stock', 'manufacturer_code', 'ean', 'reference', 'ncm']) {
    const m = new RegExp(`name="map_${key}"[^>]*>[\\s\\S]*?<option value="([^"]*)" selected`).exec(preview2.text);
    if (m && m[1] !== '') mapa2[`map_${key}`] = m[1];
  }
  const confirm2 = await http.post(`/fornecedores/${betaId}/importar/confirmar`, {
    _csrf: tokenOf(preview2.text), t: token2, name: 'beta.csv', mode: 'merge', sheet: '0', ...mapa2,
  });
  ok('segundo fornecedor importado', confirm2.status === 303);
  ok('detectou layout diferente do Beta', preview2.text.includes('3 produtos'), '');

  section('Projetos e orcamentos');
  const projetosPage = await http.get('/projetos');
  const clienteId = Number((/name="client_id"[\s\S]*?<option value="(\d+)"/.exec(projetosPage.text) || [])[1] || 0);
  const proj = await http.post('/projetos', {
    _csrf: tokenOf(projetosPage.text), name: 'Projetos Escolas 10/2026', client_id: clienteId, code: 'ESCOLAS-10-2026',
  });
  ok('projeto criado', proj.status === 303);
  const projId = Number((/\/projetos\/(\d+)/.exec(String(proj.location)) || [])[1] || 0);
  ok('id do projeto', projId > 0, `id=${projId}`);

  const novoOrc = await http.get('/orcamentos/novo');
  ok('tela de novo orcamento abre', novoOrc.status === 200);
  const cliId = Number((/name="client_id"[\s\S]*?<option value="(\d+)"/.exec(novoOrc.text) || [])[1] || 0);
  const orc = await http.post('/orcamentos', {
    _csrf: tokenOf(novoOrc.text),
    title: 'EMEB Bela Vista',
    client_id: cliId,
    supplier_id: idAlfa,
    project_id: projId,
    location: 'Redes, Eletrica e CFTV - EMEB BELA VISTA',
    margin_pct: '60',
    margin_mode: 'markup',
    service_pct: '65',
    valid_days: '15',
  });
  ok('orcamento criado', orc.status === 303);
  const orcId = Number((/\/orcamentos\/(\d+)/.exec(String(orc.location)) || [])[1] || 0);
  ok('id do orcamento', orcId > 0, `id=${orcId}`);

  const editor = await http.get(`/orcamentos/${orcId}`);
  ok('editor abre', editor.status === 200 && editor.text.includes('EMEB Bela Vista'));

  const listaProdutos = await http.get('/produtos?q=');
  const catIds = [...new Set([...listaProdutos.text.matchAll(/\/produtos\/(\d+)\/excluir/g)].map((m) => Number(m[1])))];
  ok('catalogo expoe produtos', catIds.length >= 7, `encontrados=${catIds.length}`);

  for (const pid of catIds.slice(0, 3)) {
    const r = await http.post(`/orcamentos/${orcId}/itens`, {
      _csrf: tokenOf(editor.text), product_id: pid, qty: '2',
    });
    ok(`produto ${pid} adicionado`, r.status === 303);
  }

  const editor2 = await http.get(`/orcamentos/${orcId}`);
  const itensCount = (editor2.text.match(/name="q\d+"/g) || []).length;
  ok('editor lista 3 itens', itensCount === 3, `itens=${itensCount}`);
  ok('coluna de fornecedor disponivel', editor2.text.includes('Fornecedor'));

  section('Calculo e exportacao');
  const xlsx = await http.get(`/orcamentos/${orcId}/exportar.xlsx`);
  ok('planilha gerada', xlsx.status === 200 && xlsx.buffer[0] === 0x50 && xlsx.buffer[1] === 0x4b, `status=${xlsx.status}`);
  ok('content-type xlsx', String(xlsx.type).includes('spreadsheetml'), xlsx.type);

  const wb = readTable(xlsx.buffer, 'orc.xlsx');
  ok('planilha tem aba CUSTOS', wb.sheets.some((s) => s.name === 'CUSTOS'));
  const orcSheet = wb.sheets.find((s) => s.name.startsWith('Or'));
  ok('planilha tem aba de orcamento', !!orcSheet);
  ok('aba tem titulo da empresa', String(orcSheet.rows[0][0]).includes('ORÇAMENTO'));
  const headerRow = orcSheet.rows.find((r) => r && r[0] === 'Código');
  ok('cabecalho da tabela presente', !!headerRow);
  const totalCell = orcSheet.rows.flat().find((c) => typeof c === 'number' && c > 0);
  ok('planilha tem valores numericos', totalCell !== undefined);

  const comparativo = await http.get(`/orcamentos/${orcId}/comparativo.xlsx`);
  ok('comparativo gerado', comparativo.status === 200 && comparativo.buffer[0] === 0x50, `status=${comparativo.status}`);
  if (comparativo.status === 200) {
    const cmp = readTable(comparativo.buffer, 'cmp.xlsx');
    ok('comparativo lista fornecedores', cmp.sheets[0].rows.some((r) => r && r.some((c) => String(c).includes('Fornecedor'))));
  }

  // duplica o orcamento para uma segunda unidade do mesmo projeto
  const edAtual = await http.get(`/orcamentos/${orcId}`);
  const dup = await http.post(`/orcamentos/${orcId}/duplicar`, { _csrf: tokenOf(edAtual.text) });
  ok('orcamento duplicado', dup.status === 303, `status=${dup.status}`);

  const projXlsx = await http.get(`/projetos/${projId}/exportar.xlsx`);
  ok('consolidado do projeto gerado', projXlsx.status === 200, `status=${projXlsx.status}`);
  if (projXlsx.status === 200) {
    const consolidado = readTable(projXlsx.buffer, 'proj.xlsx');
    const nomes = consolidado.sheets.map((s) => s.name);
    ok('consolidado tem RESUMO CONSOLIDADO', nomes.includes('RESUMO CONSOLIDADO'), nomes.join(', '));
    ok('consolidado tem aba CUSTOS', nomes.includes('CUSTOS'));
    ok('consolidado tem 2 abas de orcamento', nomes.filter((n) => n.startsWith('Orçamento')).length === 2, nomes.join(', '));
  }

  const print = await http.get(`/orcamentos/${orcId}/imprimir`);
  ok('pagina de impressao abre', print.status === 200 && print.text.includes('ORÇAMENTO DE MATERIAIS'));

  section('Painel administrativo');
  const usuarios = await http.get('/usuarios');
  ok('lista de usuarios abre', usuarios.status === 200);
  const novoUser = await http.get('/usuarios/novo');
  const u = await http.post('/usuarios', {
    _csrf: tokenOf(novoUser.text), name: 'Joao Vendedor', email: 'joao@teste.local', password: 'senha12345', role: 'user',
  });
  ok('usuario comum criado', u.status === 303);
  const config = await http.get('/configuracoes');
  ok('configuracoes abre', config.status === 200 && config.text.includes('Empresa principal'));
  const salvarConfig = await http.post('/configuracoes', {
    _csrf: tokenOf(config.text),
    app_name: 'Central de Orcamentos',
    name: 'EMPRESA TESTE', legal_name: 'EMPRESA TESTE LTDA',
    cnpj: '22.333.444/0001-55', ie: '987.654.321',
    address: 'Avenida Teste, 200 - Cidade',
    contact: '(00) 90000-1111', email: 'contato@teste.local',
    bank_info: 'Banco Teste (000) | Agencia 0000-0 | Conta 00000-0',
    default_margin_pct: '60', default_margin_mode: 'markup',
    default_service_pct: '65', default_valid_days: '15',
  });
  ok('configuracoes salvas', salvarConfig.status === 303);

  section('Despesas e margem');
  const addDesp = await http.post(`/orcamentos/${orcId}/despesas`, {
    _csrf: tokenOf(editor2.text), description: 'Frete', kind: 'percent', value: '5', base: 'products',
  });
  ok('despesa adicionada', addDesp.status === 303);
  const editor3 = await http.get(`/orcamentos/${orcId}`);
  ok('despesa aparece no resumo', editor3.text.includes('Frete'));

  const params = await http.post(`/orcamentos/${orcId}/parametros`, {
    _csrf: tokenOf(editor3.text), margin_pct: '25', margin_mode: 'margin', service_pct: '0', rounding: '0', valid_days: '30', status: 'sent',
  });
  ok('parametros atualizados', params.status === 303);
  const editor4 = await http.get(`/orcamentos/${orcId}`);
  ok('modo margem sobre venda aplicado', editor4.text.includes('Margem sobre a venda') || editor4.text.includes('margin'));

  section('Catalogo: criar e editar produto');
  const novoProd = await http.get('/produtos/novo');
  ok('formulario de novo produto abre', novoProd.status === 200 && novoProd.text.includes('Novo produto'));
  const criarProd = await http.post('/produtos', {
    _csrf: tokenOf(novoProd.text),
    supplier_id: idAlfa,
    description: 'PRODUTO CRIADO NA TELA',
    unit_price: '123,45',
    brand: 'TESTE',
    stock: '7',
    unit: 'UN',
  });
  ok('produto criado pela tela', criarProd.status === 303, `status=${criarProd.status}`);

  const buscaProd = await http.get('/produtos?q=CRIADO');
  ok('produto aparece no catalogo', buscaProd.text.includes('PRODUTO CRIADO NA TELA'));
  ok('preco gravado corretamente', buscaProd.text.includes('123,45'), '');
  const novoProdId = Number((/\/produtos\/(\d+)\/editar/.exec(buscaProd.text) || [])[1] || 0);
  ok('link de edicao presente', novoProdId > 0, `id=${novoProdId}`);

  const formEditar = await http.get(`/produtos/${novoProdId}/editar`);
  ok('formulario de edicao abre', formEditar.status === 200 && formEditar.text.includes('PRODUTO CRIADO NA TELA'));
  const salvarProd = await http.post(`/produtos/${novoProdId}`, {
    _csrf: tokenOf(formEditar.text),
    supplier_id: idAlfa,
    description: 'PRODUTO CRIADO NA TELA (EDITADO)',
    unit_price: '200,00',
    brand: 'TESTE2',
    stock: '9',
    unit: 'UN',
  });
  ok('produto editado', salvarProd.status === 303);
  const buscaProd2 = await http.get('/produtos?q=EDITADO');
  ok('edicao refletida no catalogo',
    buscaProd2.text.includes('PRODUTO CRIADO NA TELA (EDITADO)') && buscaProd2.text.includes('200,00'));

  section('Preco de venda manual no orcamento');
  const edManual = await http.get(`/orcamentos/${orcId}`);
  const itemAlvo = Number((/name="q(\d+)"/.exec(edManual.text) || [])[1] || 0);
  ok('item identificado para edicao', itemAlvo > 0, `id=${itemAlvo}`);
  const salvarPreco = await http.post(`/orcamentos/${orcId}/itens/salvar`, {
    _csrf: tokenOf(edManual.text),
    [`p${itemAlvo}`]: '999,99',
  });
  ok('preco manual salvo', salvarPreco.status === 303, `status=${salvarPreco.status}`);
  const edManual2 = await http.get(`/orcamentos/${orcId}`);
  ok('preco manual aparece no editor', edManual2.text.includes('999,99'));

  const xManual = await http.get(`/orcamentos/${orcId}/exportar.xlsx`);
  const wbManual = readTable(xManual.buffer, 'm.xlsx');
  const shManual = wbManual.sheets.find((s) => s.name.startsWith('Orçamento'));
  const temPrecoManual = shManual.rows.some(
    (r) => r && r.some((c) => typeof c === 'number' && Math.abs(c - 999.99) < 0.01),
  );
  ok('planilha gerada com o preco manual', xManual.status === 200 && temPrecoManual);

  section('Orcamento sem servico');
  const semServico = await http.post(`/orcamentos/${orcId}/parametros`, {
    _csrf: tokenOf(edManual2.text),
    margin_pct: '60', margin_mode: 'markup', service_pct: '0',
    rounding: '0', valid_days: '15', status: 'draft',
  });
  ok('parametros sem servico salvos', semServico.status === 303);

  const xSemSvc = await http.get(`/orcamentos/${orcId}/exportar.xlsx`);
  const wbSemSvc = readTable(xSemSvc.buffer, 's.xlsx');
  const shSemSvc = wbSemSvc.sheets.find((s) => s.name.startsWith('Orçamento'));
  const temLinhaServico = shSemSvc.rows.some((r) => r && String(r[0] || '').startsWith('SERV'));
  ok('planilha sem linha de servico', !temLinhaServico);

  const printSemSvc = await http.get(`/orcamentos/${orcId}/imprimir`);
  ok('impressao sem linha de servico', !printSemSvc.text.includes('Serviço de instalação'));

  section('Orcamento nao revela o calculo interno');
  const edCalc = await http.get(`/orcamentos/${orcId}`);
  await http.post(`/orcamentos/${orcId}/parametros`, {
    _csrf: tokenOf(edCalc.text),
    margin_pct: '60', margin_mode: 'markup', service_pct: '65',
    rounding: '0', valid_days: '15', status: 'draft',
  });

  const xCalc = await http.get(`/orcamentos/${orcId}/exportar.xlsx`);
  const filesCalc = zipRead(xCalc.buffer);
  const wbCalc = readTable(xCalc.buffer, 'c.xlsx');
  const shCalc = wbCalc.sheets.find((s) => s.name.startsWith('Orçamento'));
  const conteudoCalc = JSON.stringify(shCalc.rows).toUpperCase();

  ok('sem linha de margem/reajuste percentual', !conteudoCalc.includes('MARGEM') && !conteudoCalc.includes('ACRÉSCIMO'));
  ok('linha de servico sem percentual', !/SERVIÇO DE INSTALAÇÃO \(/.test(conteudoCalc), '');
  ok('nao menciona percentual nas observacoes', !/PERCENTUAL/i.test(conteudoCalc));

  const wbXmlCalc = filesCalc.get('xl/workbook.xml').toString('utf8');
  ok('aba CUSTOS oculta ao cliente', /<sheet name="CUSTOS"[^>]*state="hidden"/.test(wbXmlCalc), wbXmlCalc.match(/<sheet name="CUSTOS"[^>]*>/)?.[0] || '');

  const algumaFormulaComD7 = [...filesCalc.keys()]
    .filter((k) => k.startsWith('xl/worksheets/'))
    .some((k) => filesCalc.get(k).toString('utf8').includes('$D$7'));
  ok('formulas nao dependem de celula de reajuste', !algumaFormulaComD7);

  const printComSvc = await http.get(`/orcamentos/${orcId}/imprimir`);
  ok('impressao mostra servico sem percentual',
    printComSvc.text.includes('Serviço de instalação') && !printComSvc.text.includes('Serviço de instalação ('));
  ok('impressao sem percentual de reajuste', !/reajuste conforme percentual/i.test(printComSvc.text));

  section('Documento de impressao limpo');
  const tituloPdf = (/<title>([^<]*)<\/title>/.exec(printComSvc.text) || [])[1] || '';
  ok('titulo do PDF e o do orcamento, sem nome da plataforma',
    tituloPdf === 'EMEB Bela Vista', `titulo="${tituloPdf}"`);
  ok('impressao sem barra de titulo/pre-visualizacao',
    !printComSvc.text.includes('Pré-visualização') && !printComSvc.text.includes('page-head'));
  ok('impressao sem menu lateral', !printComSvc.text.includes('class="sidebar"'));
  ok('impressao sem rodape com link da plataforma',
    !printComSvc.text.includes('127.0.0.1') && !/Central de Or[cç]amentos/.test(printComSvc.text));

  const css = await http.get('/app.css');
  const cssTexto = css.buffer.toString('utf8');
  ok('CSS zera a margem da pagina (tira cabecalho/rodape do navegador)',
    cssTexto.includes('@page { size: A4; margin: 0; }'));
  ok('CSS esconde a barra de acoes na impressao',
    cssTexto.includes('.print-toolbar { display: none !important; }'));

  section('Clonar orcamento para outro fornecedor');
  const formClone = await http.get(`/orcamentos/${orcId}/clonar`);
  ok('formulario de clonagem abre',
    formClone.status === 200 && formClone.text.includes('Clonar para outra empresa participante'));
  ok('rotulo fala em empresa participante',
    formClone.text.includes('Empresa participante (quem assina)'));
  ok('sugere titulo com o nome da empresa', /value="EMEB Bela Vista — [^"]+"/.test(formClone.text));
  ok('nao usa mais o rotulo emitente no formulario', !formClone.text.includes('Empresa emitente'));
  ok('liga titulo ao seletor de empresa',
    formClone.text.includes('data-participante') && formClone.text.includes('data-titulo'));

  const clone = await http.post(`/orcamentos/${orcId}/clonar`, {
    _csrf: tokenOf(formClone.text),
    title: 'EMEB Bela Vista - Beta',
    supplier_id: String(betaId),
    item_supplier_id: String(betaId),
    mode: 'preco',
    adjust_pct: '10',
    margin_pct: '60',
    service_pct: '65',
    valid_days: '15',
    copy_expenses: '1',
  });
  ok('clone criado', clone.status === 303, `status=${clone.status}`);
  const cloneId = Number((/\/orcamentos\/(\d+)/.exec(String(clone.location)) || [])[1] || 0);
  ok('id do clone', cloneId > 0, `id=${cloneId}`);

  const dbCheck = new DatabaseSync(DB_PATH, { readOnly: true });
  const qOrig = dbCheck.prepare('SELECT total_cache, supplier_id, project_id FROM quotes WHERE id = ?').get(orcId);
  const qClone = dbCheck.prepare('SELECT total_cache, supplier_id, project_id FROM quotes WHERE id = ?').get(cloneId);
  const itClone = dbCheck.prepare('SELECT unit_cost, price_override FROM quote_items WHERE quote_id = ?').all(cloneId);
  const itOrig = dbCheck.prepare('SELECT COUNT(*) AS n FROM quote_items WHERE quote_id = ?').get(orcId);
  dbCheck.close();

  ok('clone no mesmo projeto', qClone.project_id === qOrig.project_id);
  ok('clone com o novo fornecedor emitente', qClone.supplier_id === betaId, `emitente=${qClone.supplier_id} esperado=${betaId}`);
  ok('clone com a mesma quantidade de itens', itClone.length === itOrig.n, `${itClone.length} vs ${itOrig.n}`);
  ok('todos os itens com preco derivado', itClone.every((x) => x.price_override !== null && x.price_override > 0));

  const esperado = Math.round(qOrig.total_cache * 1.1 * 100) / 100;
  const diff = Math.abs(qClone.total_cache - esperado);
  ok('total do clone = total original + 10%',
    diff < 0.05, `original=${qOrig.total_cache} clone=${qClone.total_cache} esperado=${esperado}`);

  const clonePage = await http.get(`/orcamentos/${cloneId}`);
  ok('clone abre para edicao', clonePage.status === 200 && clonePage.text.includes('EMEB Bela Vista - Beta'));

  const formClone2 = await http.get(`/orcamentos/${cloneId}/clonar`);
  ok('titulo nao acumula sufixo ao clonar de novo',
    !formClone2.text.includes('— novo fornecedor —') && !formClone2.text.includes('— novo fornecedor"'));

  section('Layouts do orcamento');
  const formForn = await http.get(`/fornecedores/${idAlfa}/editar`);
  ok('fornecedor tem campo de layout', formForn.text.includes('Layout do orçamento'));
  for (const l of ['classico', 'moderno', 'compacto', 'formal', 'executivo']) {
    ok(`layout ${l} disponivel no cadastro`, formForn.text.includes(`value="${l}"`));
  }

  const exemplos = {};
  for (const l of ['classico', 'moderno', 'compacto', 'formal', 'executivo']) {
    const ex = await http.get(`/layout-exemplo/${l}.xlsx`);
    const okZip = ex.status === 200 && ex.buffer[0] === 0x50 && ex.buffer[1] === 0x4b;
    ok(`exemplo do layout ${l} gera planilha`, okZip, `status=${ex.status}`);
    if (okZip) {
      const st = zipRead(ex.buffer).get('xl/styles.xml').toString('utf8');
      exemplos[l] = (st.match(/<name val="([^"]+)"/) || [])[1];
    }
  }
  ok('layouts usam fontes diferentes',
    new Set(Object.values(exemplos)).size >= 4,
    Object.entries(exemplos).map(([k, v]) => `${k}=${v}`).join(', '));

  const salvarLayout = await http.post(`/fornecedores/${idAlfa}`, {
    _csrf: tokenOf(formForn.text),
    name: 'Fornecedor Alfa',
    legal_name: 'ALFA MATERIAIS ELETRICOS LTDA',
    cnpj: '11.111.111/0001-11',
    layout: 'executivo',
    is_own: '1',
    bank_info: 'Banco do Brasil 001',
  });
  ok('layout salvo no cadastro do fornecedor', salvarLayout.status === 303);

  const xLayout = await http.get(`/orcamentos/${orcId}/exportar.xlsx`);
  const stylesLayout = zipRead(xLayout.buffer).get('xl/styles.xml').toString('utf8');
  const fonteGerada = (stylesLayout.match(/<name val="([^"]+)"/) || [])[1];
  ok('orcamento usa o layout do fornecedor emitente', fonteGerada === 'Verdana', `fonte=${fonteGerada}`);

  const printLayout = await http.get(`/orcamentos/${orcId}/imprimir`);
  ok('PDF/impressao tambem segue o layout do fornecedor',
    printLayout.text.includes('Verdana'), 'fonte aplicada no CSS de impressao');

  section('Trocar a empresa participante de um rascunho');
  const dbC = new DatabaseSync(DB_PATH, { readOnly: true });
  const baseQuote = dbC.prepare(
    'SELECT title, location, client_id, project_id, service_code, service_description, observations, supplier_id FROM quotes WHERE id = ?',
  ).get(orcId);
  dbC.close();

  const edPart = await http.get(`/orcamentos/${orcId}`);
  ok('editor mostra o seletor de empresa participante',
    edPart.text.includes('Empresa participante (quem assina)'));

  const trocaIda = await http.post(`/orcamentos/${orcId}/cabecalho`, {
    _csrf: tokenOf(edPart.text),
    title: baseQuote.title,
    location: baseQuote.location || '',
    client_id: String(baseQuote.client_id),
    project_id: String(baseQuote.project_id),
    supplier_id: String(betaId),
    service_code: baseQuote.service_code || 'SERV-01',
    service_description: baseQuote.service_description || '',
    observations: baseQuote.observations || '',
  });
  ok('troca de empresa participante salva', trocaIda.status === 303);

  const dbC2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const aposTroca = dbC2.prepare('SELECT supplier_id FROM quotes WHERE id = ?').get(orcId);
  dbC2.close();
  ok('empresa do orcamento atualizada', aposTroca.supplier_id === betaId, `supplier=${aposTroca.supplier_id}`);

  // devolve ao fornecedor original para nao afetar os testes seguintes
  await http.post(`/orcamentos/${orcId}/cabecalho`, {
    _csrf: tokenOf(edPart.text),
    title: baseQuote.title,
    location: baseQuote.location || '',
    client_id: String(baseQuote.client_id),
    project_id: String(baseQuote.project_id),
    supplier_id: String(baseQuote.supplier_id),
    service_code: baseQuote.service_code || 'SERV-01',
    service_description: baseQuote.service_description || '',
    observations: baseQuote.observations || '',
  });

  section('Projeto v2: vencedor e perdedores');
  const hub = await http.get(`/projetos/${projId}`);
  ok('pagina do projeto abre', hub.status === 200);
  ok('mostra o orcamento vencedor', hub.text.includes('Orçamento vencedor'));
  ok('tem formulario de perdedor', hub.text.includes('Adicionar perdedor'));
  ok('oferece PDF de todos', hub.text.includes(`/projetos/${projId}/imprimir`));
  ok('oferece pacote de planilhas', hub.text.includes(`/projetos/${projId}/planilhas.zip`));

  let dbV = new DatabaseSync(DB_PATH, { readOnly: true });
  const projRow = dbV.prepare('SELECT winner_quote_id FROM projects WHERE id = ?').get(projId);
  ok('primeiro orcamento virou vencedor automaticamente',
    projRow.winner_quote_id === orcId, `winner=${projRow.winner_quote_id} esperado=${orcId}`);

  const criarPerdedor = await http.post(`/projetos/${projId}/perdedor`, {
    _csrf: tokenOf(hub.text),
    title: 'Proposta Fornecedor B',
    supplier_id: String(betaId),
    adjust_pct: '25',
  });
  ok('perdedor criado', criarPerdedor.status === 303, `status=${criarPerdedor.status}`);

  const winRow = dbV.prepare('SELECT total_cache FROM quotes WHERE id = ?').get(projRow.winner_quote_id);
  const perdedores = dbV.prepare('SELECT id, total_cache, adjust_pct FROM quotes WHERE project_id = ? AND id <> ?')
    .all(projId, projRow.winner_quote_id);
  const novoPerdedor = perdedores.find((p) => Math.abs((p.adjust_pct || 0) - 25) < 0.001);
  dbV.close();

  ok('aumento de 25% registrado no perdedor', !!novoPerdedor);
  if (novoPerdedor) {
    const esperado = Math.round(winRow.total_cache * 1.25 * 100) / 100;
    ok('total do perdedor = vencedor + 25%',
      Math.abs(novoPerdedor.total_cache - esperado) < 0.05,
      `vencedor=${winRow.total_cache} perdedor=${novoPerdedor.total_cache} esperado=${esperado}`);
  }

  const zip = await http.get(`/projetos/${projId}/planilhas.zip`);
  ok('pacote de planilhas gerado', zip.status === 200 && zip.buffer[0] === 0x50 && zip.buffer[1] === 0x4b, `status=${zip.status}`);
  if (zip.status === 200) {
    const dentro = zipRead(zip.buffer);
    const nomes = [...dentro.keys()];
    ok('pacote contem um xlsx por orcamento', nomes.filter((n) => n.endsWith('.xlsx')).length === perdedores.length + 1, nomes.join(', '));
    ok('pacote tem arquivo de leia-me', nomes.some((n) => n.startsWith('LEIA-ME')));
    ok('pacote marca o vencedor no nome', nomes.some((n) => n.includes('vencedor')));
  }

  const printAll = await http.get(`/projetos/${projId}/imprimir`);
  ok('PDF de todas as propostas abre', printAll.status === 200);
  const blocos = (printAll.text.match(/class="print-sheet"/g) || []).length;
  ok('traz todas as propostas na mesma pagina', blocos === perdedores.length + 1, `blocos=${blocos}`);
  ok('quebra pagina entre propostas', printAll.text.includes('page-break-after:always'));
  ok('PDF conjunto sem cabecalho da plataforma',
    !printAll.text.includes('Pré-visualização') && !printAll.text.includes('class="sidebar"'));

  section('Planilha modelo');
  const modelo = await http.get('/modelo-importacao.xlsx');
  ok('modelo .xlsx disponivel', modelo.status === 200 && modelo.buffer[0] === 0x50, `status=${modelo.status}`);
  const mwb = readTable(modelo.buffer, 'modelo.xlsx');
  ok('modelo tem aba PRODUTOS', mwb.sheets.some((s) => s.name === 'PRODUTOS'));
  ok('modelo tem aba INSTRUCOES', mwb.sheets.some((s) => s.name === 'INSTRUCOES'));
  const msheet = mwb.sheets.find((s) => s.name === 'PRODUTOS');
  const mhdr = msheet.rows.find((r) => r && r[0] === 'Código');
  ok('modelo tem as 10 colunas', mhdr && mhdr.length === 10, JSON.stringify(mhdr));
  ok('modelo tem 6 linhas de exemplo', msheet.rows.filter((r) => r && typeof r[2] === 'number').length === 6);
  const mcsv = await http.get('/modelo-importacao.csv');
  ok('modelo .csv disponivel', mcsv.status === 200 && mcsv.buffer.length > 100, `status=${mcsv.status}`);

  // ida e volta: o proprio modelo precisa ser importavel sem erros
  const novoForn3 = await http.get('/fornecedores/novo');
  await http.post('/fornecedores', { _csrf: tokenOf(novoForn3.text), name: 'Fornecedor Modelo' });
  const forn3List = await http.get('/fornecedores');
  const ids3 = [...forn3List.text.matchAll(/\/fornecedores\/(\d+)"/g)].map((m) => Number(m[1]));
  const forn3Id = Math.max(...ids3);

  const imp3 = await http.get(`/fornecedores/${forn3Id}/importar`);
  const up3 = await http.request('POST', `/fornecedores/${forn3Id}/importar`, {
    form: { _csrf: tokenOf(imp3.text), mode: 'merge' },
    files: [{
      field: 'file',
      filename: 'modelo_importacao_produtos.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: modelo.buffer,
    }],
  });
  ok('modelo aceito no upload', up3.status === 303, `status=${up3.status}`);
  const pv3 = await http.get(up3.location);
  ok('modelo detecta 6 produtos (nao importa o cabecalho)', pv3.text.includes('6 produtos'), (pv3.text.match(/(\d+) produtos/) || [])[0] || '');

  const mapa3 = {};
  for (const key of ['internal_code', 'description', 'unit_price', 'brand', 'stock', 'manufacturer_code', 'ean', 'reference', 'ncm', 'unit']) {
    const m = new RegExp(`name="map_${key}"[^>]*>[\\s\\S]*?<option value="([^"]*)" selected`).exec(pv3.text);
    if (m && m[1] !== '') mapa3[`map_${key}`] = m[1];
  }
  const cf3 = await http.post(`/fornecedores/${forn3Id}/importar/confirmar`, {
    _csrf: tokenOf(pv3.text),
    t: (/name="t" value="([^"]+)"/.exec(pv3.text) || [])[1] || '',
    header: (/name="header" value="([^"]+)"/.exec(pv3.text) || [])[1] || '',
    name: 'modelo_importacao_produtos.xlsx', mode: 'merge', sheet: '0', ...mapa3,
  });
  ok('modelo importado com 6 novos', cf3.status === 303 && decodeURIComponent(String(cf3.location)).includes('6 novos'), decodeURIComponent(String(cf3.location)));

  const prodsModelo = await http.get(`/produtos?fornecedor=${forn3Id}`);
  ok('catalogo do fornecedor modelo tem 6 produtos', prodsModelo.text.includes('6 produto(s)'), (prodsModelo.text.match(/(\d+) produto\(s\)/) || [])[0] || '');
  ok('preco importado corretamente (2.135,00)', prodsModelo.text.includes('2.135,00'), '');
  ok('estoque nao foi confundido com preco', !prodsModelo.text.includes('R$ 10,00'), '');

  section('Busca em texto completo (indice invertido)');
  const buscarProd = (q) => http.get(`/produtos?q=${encodeURIComponent(q)}`);
  const achaCabo = async (q) => (await buscarProd(q)).text.includes('CABO PP 2C 2,5 MM');

  ok('acha por termos separados: "CABO PP 2,5"', await achaCabo('CABO PP 2,5'));
  ok('acha ignorando maiusculas: "cabo pp"', await achaCabo('cabo pp'));
  ok('acha pela medida: "2,5 mm"', await achaCabo('2,5 mm'));
  ok('acha por palavra unica: "eletroduto"', (await buscarProd('eletroduto')).text.includes('ELETRODUTO'));
  ok('acha por codigo: "661"', await achaCabo('661'));
  ok('acha por EAN', await achaCabo('7891234567891'));
  ok('acha por referencia do fabricante', await achaCabo('REF661'));
  ok('acha por marca', await achaCabo('sil'));
  ok('termo inexistente nao retorna nada',
    (await buscarProd('zzz nao existe')).text.includes('Nenhum produto encontrado'));

  const buscaNoOrcamento = await http.get(`/orcamentos/${orcId}?busca=${encodeURIComponent('CABO PP 2,5')}`);
  ok('busca dentro do orcamento tambem acha',
    buscaNoOrcamento.text.includes('CABO PP 2C 2,5 MM'));

  section('Busca ao vivo e identificacao na barra lateral');
  const paginaLateral = await http.get('/orcamentos');
  const versaoApp = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  ok('barra lateral tem o bloco de identificacao', paginaLateral.text.includes('sidebar-info'));
  ok('barra lateral mostra a versao do sistema', paginaLateral.text.includes(`v${versaoApp}`), versaoApp);
  ok('barra lateral mostra o nome do banco', paginaLateral.text.includes('teste.db'));

  const fragCatalogo = await http.get('/produtos/lista?q=cab');
  ok('busca ao vivo do catalogo responde', fragCatalogo.status === 200);
  ok('busca ao vivo devolve so o pedaco (sem html)', !fragCatalogo.text.toLowerCase().includes('<html'));
  ok('busca ao vivo do catalogo acha o cabo', fragCatalogo.text.includes('CABO PP 2C 2,5 MM'));

  const fragCurto = await http.get('/produtos/lista?q=ca');
  ok('busca ao vivo pede ao menos 3 letras', fragCurto.text.includes('Continue digitando'));

  const fragOrcamento = await http.get(`/orcamentos/${orcId}/busca?busca=cab`);
  ok('busca ao vivo dentro do orcamento responde', fragOrcamento.status === 200);
  ok('busca ao vivo dentro do orcamento acha o cabo', fragOrcamento.text.includes('CABO PP 2C 2,5 MM'));
  ok('resultado traz o botao de adicionar', fragOrcamento.text.includes('name="product_id"'));

  const fragMeio = await http.get('/produtos/lista?q=1234567');
  ok('acha pedaco no meio do EAN (busca por termos)', fragMeio.text.includes('CABO PP 2C 2,5 MM'));

  const formComBuscaViva = await http.get('/produtos');
  ok('campo do catalogo tem busca ao vivo', formComBuscaViva.text.includes('data-busca-viva="/produtos/lista"'));
  const editorComBuscaViva = await http.get(`/orcamentos/${orcId}`);
  ok('campo do orcamento tem busca ao vivo', editorComBuscaViva.text.includes(`data-busca-viva="/orcamentos/${orcId}/busca"`));

  section('Ajuste de precos em massa no catalogo');
  const dbA = new DatabaseSync(DB_PATH, { readOnly: true });
  const antesA = dbA.prepare(
    'SELECT COUNT(*) AS n FROM products WHERE supplier_id = ? AND active = 1 AND unit_price > 0',
  ).get(idAlfa);
  const amostra = dbA.prepare(
    'SELECT id, unit_price FROM products WHERE supplier_id = ? AND active = 1 AND unit_price > 0 LIMIT 1',
  ).get(idAlfa);
  dbA.close();
  ok('fornecedor tem produtos para ajustar', antesA.n > 0, `n=${antesA.n}`);

  const telaAjuste = await http.get(`/produtos/reajustar?fornecedor=${idAlfa}`);
  ok('tela de ajuste abre', telaAjuste.status === 200 && telaAjuste.text.includes('Ajustar preços do catálogo'));
  ok('tela de ajuste sem popup de confirmacao', !telaAjuste.text.includes('data-confirm'));

  const appJs = await http.get('/app.js');
  ok('confirmacao so dispara em botoes/links',
    appJs.buffer.toString('utf8').includes('closest(\'button, a, input[type="submit"]\')'));
  ok('tela mostra a situacao atual', telaAjuste.text.includes('Situação atual'));
  ok('botao Ajustar precos existe no catalogo',
    (await http.get('/produtos')).text.includes('/produtos/reajustar')
    || (await http.get('/produtos')).text.includes('Ajustar preços'));

  const semFornecedor = await http.get('/produtos/reajustar');
  ok('sem fornecedor pede para selecionar', semFornecedor.text.includes('Selecione um fornecedor'));

  const aplicarAumento = await http.post('/produtos/reajustar', {
    _csrf: tokenOf(telaAjuste.text),
    supplier_id: String(idAlfa),
    direction: 'aumento',
    pct: '10',
  });
  ok('aumento de 10% aplicado', aplicarAumento.status === 303, `status=${aplicarAumento.status}`);

  const dbA2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const depoisA = dbA2.prepare('SELECT unit_price FROM products WHERE id = ?').get(amostra.id);
  const lote = dbA2.prepare('SELECT filename FROM import_batches WHERE supplier_id = ? ORDER BY id DESC LIMIT 1').get(idAlfa);
  dbA2.close();

  const esperadoA = Math.round(amostra.unit_price * 1.1 * 100) / 100;
  ok('preco multiplicado por 1,1',
    Math.abs(depoisA.unit_price - esperadoA) < 0.011,
    `${amostra.unit_price} -> ${depoisA.unit_price} (esperado ${esperadoA})`);
  ok('ajuste registrado no historico do fornecedor', String(lote.filename).includes('10%'), lote.filename);

  const telaDesconto = await http.get(`/produtos/reajustar?fornecedor=${idAlfa}`);
  const aplicarDesconto = await http.post('/produtos/reajustar', {
    _csrf: tokenOf(telaDesconto.text),
    supplier_id: String(idAlfa),
    direction: 'desconto',
    pct: '5',
  });
  ok('desconto de 5% aplicado', aplicarDesconto.status === 303);

  const dbA3 = new DatabaseSync(DB_PATH, { readOnly: true });
  const depoisB = dbA3.prepare('SELECT unit_price FROM products WHERE id = ?').get(amostra.id);
  dbA3.close();
  const esperadoB = Math.round(depoisA.unit_price * 0.95 * 100) / 100;
  ok('desconto reduz o preco', Math.abs(depoisB.unit_price - esperadoB) < 0.011, `${depoisA.unit_price} -> ${depoisB.unit_price}`);

  const invalido = await http.post('/produtos/reajustar', {
    _csrf: tokenOf(telaDesconto.text),
    supplier_id: String(idAlfa),
    direction: 'desconto',
    pct: '100',
  });
  ok('desconto de 100% e recusado',
    String(invalido.location || '').includes('err='), String(invalido.location));

  section('Arquivar documentos com descricao');
  const formArq = await http.get(`/orcamentos/${orcId}/arquivar`);
  ok('tela de arquivar abre', formArq.status === 200 && formArq.text.includes('Baixar e arquivar'));

  const pedidoArq = await http.request('POST', `/orcamentos/${orcId}/arquivar`, {
    form: { _csrf: tokenOf(formArq.text), description: 'PROPOSTA ENVIADA AO CLIENTE', formato: 'xlsx' },
  });
  ok('arquivar devolve a planilha na hora', pedidoArq.status === 200 && pedidoArq.buffer[0] === 0x50 && pedidoArq.buffer[1] === 0x4b);

  const dbF = new DatabaseSync(DB_PATH, { readOnly: true });
  const guardado = dbF.prepare('SELECT id, description, size, created_at, kind FROM quote_files ORDER BY id DESC LIMIT 1').get();
  dbF.close();
  ok('arquivo guardado com a descricao', guardado && guardado.description === 'PROPOSTA ENVIADA AO CLIENTE', guardado?.description);
  ok('arquivo guardado com data e hora', !!guardado?.created_at && guardado.created_at.includes('T'), guardado?.created_at);
  ok('arquivo guardado com conteudo', (guardado?.size || 0) > 1000, `${guardado?.size} bytes`);

  const listaArq = await http.get('/arquivos');
  ok('pagina de arquivos lista o item', listaArq.status === 200 && listaArq.text.includes('PROPOSTA ENVIADA AO CLIENTE'));
  ok('pagina de arquivos mostra data/hora',
    /\d{2}\/\d{2}\/\d{4}/.test(listaArq.text));

  const downloadArq = await http.get(`/arquivos/${guardado.id}/download`);
  ok('download do arquivo guardado', downloadArq.status === 200 && downloadArq.buffer[0] === 0x50);

  const formArqProj = await http.get(`/projetos/${projId}/arquivar`);
  ok('arquivar pacote do projeto abre', formArqProj.status === 200);
  const pacote = await http.request('POST', `/projetos/${projId}/arquivar`, {
    form: { _csrf: tokenOf(formArqProj.text), description: 'PACOTE DO PREGAO', formato: 'zip' },
  });
  ok('pacote do projeto gerado e guardado', pacote.status === 200 && pacote.buffer[0] === 0x50);

  const dbF2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const zipGuardado = dbF2.prepare("SELECT size FROM quote_files WHERE kind = 'zip' ORDER BY id DESC LIMIT 1").get();
  dbF2.close();
  ok('pacote tem conteudo guardado', (zipGuardado?.size || 0) > 1000, `${zipGuardado?.size} bytes`);

  const excluirArq = await http.post(`/arquivos/${guardado.id}/excluir`, {
    _csrf: tokenOf(listaArq.text),
  });
  ok('excluir arquivo guardado', excluirArq.status === 303);

  section('PDF gerado no servidor');
  const pdfOrc = await http.get(`/orcamentos/${orcId}/pdf`);
  ok('baixa o PDF do orcamento', pdfOrc.status === 200, `status=${pdfOrc.status}`);
  ok('arquivo comeca com %PDF',
    pdfOrc.buffer.subarray(0, 5).toString('latin1') === '%PDF-', pdfOrc.buffer.subarray(0, 8).toString('latin1'));
  ok('PDF termina com EOF', pdfOrc.buffer.subarray(-8).toString('latin1').includes('%%EOF'));
  ok('PDF tem mais de um objeto', (pdfOrc.buffer.toString('latin1').match(/\/Type \/Page /g) || []).length >= 1);
  ok('PDF tem a fonte Helvetica', pdfOrc.buffer.toString('latin1').includes('/BaseFont /Helvetica'));

  const pdfProj = await http.get(`/projetos/${projId}/pdf`);
  ok('baixa o PDF do projeto', pdfProj.status === 200 && pdfProj.buffer.subarray(0, 5).toString('latin1') === '%PDF-');
  const paginasProj = (pdfProj.buffer.toString('latin1').match(/\/Type \/Page /g) || []).length;
  ok('PDF do projeto tem uma pagina por proposta', paginasProj >= 2, `${paginasProj} pagina(s)`);

  section('Arquivar em PDF');
  const formPdf = await http.get(`/orcamentos/${orcId}/arquivar`);
  ok('tela de arquivar oferece PDF', formPdf.text.includes('value="pdf"'));
  ok('tela de arquivar oferece os dois', formPdf.text.includes('value="ambos"'));

  const arqPdf = await http.request('POST', `/orcamentos/${orcId}/arquivar`, {
    form: { _csrf: tokenOf(formPdf.text), description: 'PROPOSTA EM PDF', formato: 'pdf' },
  });
  ok('arquivar em PDF devolve o arquivo',
    arqPdf.status === 200 && arqPdf.buffer.subarray(0, 5).toString('latin1') === '%PDF-');

  const dbPdf = new DatabaseSync(DB_PATH, { readOnly: true });
  const guardadoPdf = dbPdf.prepare("SELECT id, kind, size FROM quote_files WHERE kind = 'pdf' ORDER BY id DESC LIMIT 1").get();
  dbPdf.close();
  ok('PDF guardado com tipo pdf', guardadoPdf && guardadoPdf.kind === 'pdf', String(guardadoPdf?.kind));
  ok('PDF guardado tem tamanho', (guardadoPdf?.size || 0) > 1000, `${guardadoPdf?.size} bytes`);

  const baixarPdf = await http.get(`/arquivos/${guardadoPdf.id}/download`);
  ok('baixar o PDF guardado', baixarPdf.status === 200 && baixarPdf.buffer.subarray(0, 5).toString('latin1') === '%PDF-');

  const listaComPdf = await http.get('/arquivos');
  ok('lista mostra o PDF', listaComPdf.text.includes('PDF</span>') || listaComPdf.text.includes('>PDF<'));

  const arqAmbos = await http.request('POST', `/orcamentos/${orcId}/arquivar`, {
    form: { _csrf: tokenOf(formPdf.text), description: 'PACOTE COMPLETO', formato: 'ambos' },
  });
  ok('arquivar os dois devolve zip',
    arqAmbos.status === 200 && arqAmbos.buffer[0] === 0x50 && arqAmbos.buffer[1] === 0x4b);

  const dbAmbos = new DatabaseSync(DB_PATH, { readOnly: true });
  const qtdAmbos = dbAmbos.prepare("SELECT COUNT(*) AS n FROM quote_files WHERE description LIKE 'PACOTE COMPLETO%'").get();
  dbAmbos.close();
  ok('os dois formatos foram guardados', Number(qtdAmbos?.n) === 2, `${qtdAmbos?.n} registro(s)`);

  section('Estrutura das paginas');
  const paginas = [
    '/', '/clientes', '/clientes/novo', '/fornecedores', '/fornecedores/novo',
    `/fornecedores/${idAlfa}`, `/fornecedores/${idAlfa}/importar`, '/produtos',
    '/projetos', `/projetos/${projId}`, '/orcamentos', '/orcamentos/novo',
    `/orcamentos/${orcId}`, `/orcamentos/${orcId}/clonar`, `/orcamentos/${orcId}/imprimir`, '/usuarios',
    '/usuarios/novo', '/configuracoes',
  ];
  for (const p of paginas) {
    const r = await http.get(p);
    const html = r.text;
    const problemas = [];
    if (r.status !== 200) problemas.push(`status ${r.status}`);
    if (hasNestedForm(html)) problemas.push('form aninhado');
    if ((html.match(/<form/gi) || []).length !== (html.match(/<\/form>/gi) || []).length) problemas.push('form nao fechado');
    if ((html.match(/<table/gi) || []).length !== (html.match(/<\/table>/gi) || []).length) problemas.push('table nao fechada');
    if ((html.match(/<div/gi) || []).length !== (html.match(/<\/div>/gi) || []).length) problemas.push('div nao fechada');
    ok(`estrutura ${p}`, problemas.length === 0, problemas.join(', '));
  }

  section('Seguranca e sessao');
  const semSessao = new Http(BASE);
  const bloqueado = await semSessao.get('/orcamentos');
  ok('acesso sem login redireciona', bloqueado.status === 303 && String(bloqueado.location).startsWith('/login'), `status=${bloqueado.status}`);

  const logout = await http.post('/logout', { _csrf: tokenOf(editor4.text) });
  ok('logout funciona', logout.status === 303);
  const aposLogout = await http.get('/orcamentos');
  ok('sessao encerrada', aposLogout.status === 303);

  section('Backup e restauracao do banco');
  const hb = new Http(BASE);
  const l0 = await hb.get('/login');
  await hb.post('/login', { _csrf: tokenOf(l0.text), email: 'admin@teste.local', password: 'senha12345', next: '/' });

  const conf = await hb.get('/configuracoes');
  ok('configuracoes tem area de backup', conf.status === 200 && conf.text.includes('Backup do banco de dados'));

  const backup = await hb.get('/configuracoes/backup.db');
  ok('baixa o backup do banco',
    backup.status === 200 && backup.buffer.subarray(0, 15).toString('latin1') === 'SQLite format 3',
    `status=${backup.status} bytes=${backup.buffer.length}`);
  ok('backup nao esta vazio', backup.buffer.length > 1000);

  const ruim = await hb.request('POST', '/configuracoes/restaurar', {
    form: { _csrf: tokenOf(conf.text) },
    files: [{ field: 'file', filename: 'falso.db', type: 'application/octet-stream', data: Buffer.from('isto nao e um banco') }],
  });
  ok('arquivo invalido e recusado',
    ruim.status === 303 && String(ruim.location).includes('err='), String(ruim.location));

  const dbAntes = new DatabaseSync(DB_PATH, { readOnly: true });
  const nUsers = dbAntes.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const nFiles = dbAntes.prepare('SELECT COUNT(*) AS n FROM quote_files').get().n;
  dbAntes.close();

  const restore = await hb.request('POST', '/configuracoes/restaurar', {
    form: { _csrf: tokenOf(conf.text) },
    files: [{ field: 'file', filename: 'backup.db', type: 'application/x-sqlite3', data: backup.buffer }],
  });
  ok('restauracao aceita o backup',
    restore.status === 303 && String(restore.location).includes('/login'),
    `status=${restore.status} -> ${restore.location}`);

  const semSessaoPosRestore = await hb.get('/orcamentos');
  ok('sessao encerrada apos restaurar', semSessaoPosRestore.status === 303);

  const dbDepois = new DatabaseSync(DB_PATH, { readOnly: true });
  const nUsers2 = dbDepois.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const nFiles2 = dbDepois.prepare('SELECT COUNT(*) AS n FROM quote_files').get().n;
  dbDepois.close();
  ok('dados preservados apos restaurar',
    nUsers2 === nUsers && nFiles2 === nFiles,
    `${nUsers2}/${nUsers} usuarios, ${nFiles2}/${nFiles} arquivos`);

  const pastaBackups = path.join(TMP, 'backups');
  const zips = fs.existsSync(pastaBackups) ? fs.readdirSync(pastaBackups) : [];
  ok('copia do banco anterior guardada', zips.some((f) => f.startsWith('antes-restauracao')), zips.join(', '));

  const lr = await hb.get('/login');
  const lgFinal = await hb.post('/login', {
    _csrf: tokenOf(lr.text), email: 'admin@teste.local', password: 'senha12345', next: '/',
  });
  ok('login funciona com o banco restaurado', lgFinal.status === 303);

  section('Servicos lancados a mao e observacoes');
  const paginaServ = await hb.get(`/orcamentos/${orcId}`);
  const addServico = await hb.post(`/orcamentos/${orcId}/itens`, {
    _csrf: tokenOf(paginaServ.text),
    manual: '1',
    is_service: '1',
    description: 'Servico de lancamento de cabo',
    qty: '1',
    unit_cost: '1000,00',
  });
  ok('adicionar servico aceito', addServico.status === 303, `status=${addServico.status}`);

  const dbS = new DatabaseSync(DB_PATH, { readOnly: true });
  const servico = dbS.prepare(
    "SELECT id, is_service, qty, unit_cost FROM quote_items WHERE description = 'Servico de lancamento de cabo' ORDER BY id DESC LIMIT 1",
  ).get();
  dbS.close();
  ok('servico gravado como servico', servico && Number(servico.is_service) === 1, `is_service=${servico?.is_service}`);
  ok('valor do servico gravado', Math.abs((servico?.unit_cost || 0) - 1000) < 0.01, String(servico?.unit_cost));

  const paginaComServico = await hb.get(`/orcamentos/${orcId}`);
  ok('pagina mostra o servico', paginaComServico.text.includes('Servico de lancamento de cabo'));
  ok('pagina marca a linha como servico', paginaComServico.text.includes('>serviço<'));
  ok('resumo separa servicos lancados', paginaComServico.text.includes('Serviços lançados'));

  const impressaoServ = await hb.get(`/orcamentos/${orcId}/imprimir`);
  ok('impressao tem o bloco de servicos', impressaoServ.text.includes('>Serviços<'));
  ok('impressao mostra o valor do servico', impressaoServ.text.includes('1.000,00'));
  ok('impressao mostra o total dos servicos', impressaoServ.text.includes('Serviços</td>'));

  const planilhaServ = await hb.get(`/orcamentos/${orcId}/exportar.xlsx`);
  ok('planilha com servico gera', planilhaServ.status === 200 && planilhaServ.buffer[0] === 0x50);

  // observacoes: texto padrao editavel nas configuracoes
  const dbConf = new DatabaseSync(DB_PATH, { readOnly: true });
  const confAtual = Object.fromEntries(dbConf.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const empresaAtual = dbConf.prepare('SELECT * FROM suppliers WHERE is_own = 1 LIMIT 1').get() || {};
  dbConf.close();

  const pagConf = await hb.get('/configuracoes');
  const salvarConf = await hb.post('/configuracoes', {
    _csrf: tokenOf(pagConf.text),
    app_name: confAtual.app_name || 'Central de Orcamentos',
    default_margin_pct: confAtual.default_margin_pct || '60',
    default_margin_mode: confAtual.default_margin_mode || 'markup',
    default_service_pct: confAtual.default_service_pct || '0',
    default_valid_days: confAtual.default_valid_days || '15',
    observacoes_padrao: '1. GARANTIA DE 24 MESES PARA OS SERVICOS.\n2. ENTREGA EM 30 DIAS.',
    legal_name: empresaAtual.legal_name || 'Empresa',
    name: empresaAtual.name || 'Empresa',
    cnpj: empresaAtual.cnpj || '',
    ie: empresaAtual.ie || '',
    address: empresaAtual.address || '',
    contact: empresaAtual.contact || '',
    email: empresaAtual.email || '',
    bank_info: empresaAtual.bank_info || '',
    layout: empresaAtual.layout || 'classico',
  });
  ok('configuracoes salvam as observacoes', salvarConf.status === 303);

  const dbObs = new DatabaseSync(DB_PATH, { readOnly: true });
  const obsSalvas = dbObs.prepare("SELECT value FROM settings WHERE key = 'observacoes_padrao'").get();
  dbObs.close();
  ok('texto padrao gravado', String(obsSalvas?.value).includes('GARANTIA DE 24 MESES'));

  const impressaoPadrao = await hb.get(`/orcamentos/${orcId}/imprimir`);
  ok('impressao usa o texto padrao novo', impressaoPadrao.text.includes('GARANTIA DE 24 MESES'));
  ok('impressao nao mostra o texto antigo', !impressaoPadrao.text.includes('12 meses para os serviços'));

  // texto do proprio orcamento tem prioridade
  const dbQ = new DatabaseSync(DB_PATH);
  dbQ.prepare('UPDATE quotes SET observations = ? WHERE id = ?').run('TEXTO EXCLUSIVO DESTE ORCAMENTO', orcId);
  dbQ.close();
  const impressaoPropria = await hb.get(`/orcamentos/${orcId}/imprimir`);
  ok('observacao do orcamento tem prioridade', impressaoPropria.text.includes('TEXTO EXCLUSIVO DESTE ORCAMENTO'));
  ok('nao mistura com o texto padrao', !impressaoPropria.text.includes('GARANTIA DE 24 MESES'));

  const pagOrcObs = await hb.get(`/orcamentos/${orcId}`);
  ok('campo de observacoes vem preenchido', pagOrcObs.text.includes('TEXTO EXCLUSIVO DESTE ORCAMENTO'));

  // desfaz para nao afetar o restante
  const dbQ2 = new DatabaseSync(DB_PATH);
  dbQ2.prepare('UPDATE quotes SET observations = NULL WHERE id = ?').run(orcId);
  dbQ2.prepare("UPDATE settings SET value = ? WHERE key = 'observacoes_padrao'").run(
    Object.keys(confAtual).length ? confAtual.observacoes_padrao || '' : '',
  );
  dbQ2.prepare('DELETE FROM quote_items WHERE id = ?').run(servico?.id);
  dbQ2.close();

  section('Excluir projeto');
  const dbProj = new DatabaseSync(DB_PATH, { readOnly: true });
  const clienteTeste = dbProj.prepare('SELECT id FROM clients LIMIT 1').get();
  dbProj.close();

  const listaProj = await hb.get('/projetos');
  ok('lista de projetos tem acao de excluir', listaProj.text.includes('/excluir'));

  const criarA = await hb.post('/projetos', {
    _csrf: tokenOf(listaProj.text), name: 'PROJETO DESCARTE A', client_id: String(clienteTeste.id),
  });
  const idA = Number((/\/projetos\/(\d+)/.exec(String(criarA.location)) || [])[1] || 0);
  ok('projeto A criado', idA > 0);

  const paginaA = await hb.get(`/projetos/${idA}`);
  ok('pagina do projeto tem botao excluir', paginaA.text.includes('Excluir projeto'));
  ok('opcao de apagar tambem os orcamentos', paginaA.text.includes('apagar_orcamentos'));

  const orcAresp = await hb.post('/orcamentos', {
    _csrf: tokenOf(paginaA.text), title: 'Orcamento do projeto A', client_id: String(clienteTeste.id),
    project_id: String(idA), margin_pct: '60', margin_mode: 'markup', service_pct: '0', valid_days: '15',
  });
  const orcA = Number((/\/orcamentos\/(\d+)/.exec(String(orcAresp.location)) || [])[1] || 0);
  ok('orcamento criado no projeto A', orcA > 0);

  const paginaA2 = await hb.get(`/projetos/${idA}`);
  const excluirA = await hb.post(`/projetos/${idA}/excluir`, { _csrf: tokenOf(paginaA2.text) });
  ok('excluir projeto mantendo orcamentos', excluirA.status === 303);

  const dbProjA = new DatabaseSync(DB_PATH, { readOnly: true });
  const projA = dbProjA.prepare('SELECT id FROM projects WHERE id = ?').get(idA);
  const orcARow = dbProjA.prepare('SELECT project_id FROM quotes WHERE id = ?').get(orcA);
  dbProjA.close();
  ok('projeto A removido', !projA);
  ok('orcamento mantido e sem projeto', orcARow && orcARow.project_id === null, String(orcARow?.project_id));

  const listaProj2 = await hb.get('/projetos');
  const criarB = await hb.post('/projetos', {
    _csrf: tokenOf(listaProj2.text), name: 'PROJETO DESCARTE B', client_id: String(clienteTeste.id),
  });
  const idB = Number((/\/projetos\/(\d+)/.exec(String(criarB.location)) || [])[1] || 0);
  const paginaB = await hb.get(`/projetos/${idB}`);
  const orcBresp = await hb.post('/orcamentos', {
    _csrf: tokenOf(paginaB.text), title: 'Orcamento do projeto B', client_id: String(clienteTeste.id),
    project_id: String(idB), margin_pct: '60', margin_mode: 'markup', service_pct: '0', valid_days: '15',
  });
  const orcB = Number((/\/orcamentos\/(\d+)/.exec(String(orcBresp.location)) || [])[1] || 0);

  const paginaB2 = await hb.get(`/projetos/${idB}`);
  const excluirB = await hb.post(`/projetos/${idB}/excluir`, {
    _csrf: tokenOf(paginaB2.text), apagar_orcamentos: '1',
  });
  ok('excluir projeto apagando orcamentos', excluirB.status === 303);

  const dbProjB = new DatabaseSync(DB_PATH, { readOnly: true });
  const projB = dbProjB.prepare('SELECT id FROM projects WHERE id = ?').get(idB);
  const orcBRow = dbProjB.prepare('SELECT id FROM quotes WHERE id = ?').get(orcB);
  dbProjB.close();
  ok('projeto B e seu orcamento removidos', !projB && !orcBRow);
}

main()
  .catch((err) => {
    failed += 1;
    failures.push(String(err?.stack || err));
    console.error('\nERRO NO TESTE:', err?.stack || err);
  })
  .finally(() => {
    console.log(`\n${'='.repeat(58)}`);
    console.log(`  RESULTADO: ${passed} passaram, ${failed} falharam`);
    if (failures.length) {
      console.log('\n  Falhas:');
      for (const f of failures) console.log(`   - ${f}`);
    }
    console.log('='.repeat(58));
    try { child.kill(); } catch { /* ignore */ }
    setTimeout(() => {
      try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
      process.exit(failed ? 1 : 0);
    }, 300);
  });
