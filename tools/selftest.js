// Teste de ponta a ponta. Sobe uma instancia isolada (banco temporario),
// percorre as telas como um usuario real e valida a planilha gerada.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readTable } from '../src/xlsx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-test-'));

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
    DB_FILE: path.join(TMP, 'teste.db'),
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
    name: 'ISACI - INST. SUSTENTABILIDADE DA AMAZONIA',
    cnpj: '51.798.925/0001-60',
    ie: '75.091.198-0',
    address: 'Ave Perimetral da Ciencia, SN, Belem - PA',
    contact: 'Maria Silva',
    phone: '(91) 99999-0000',
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
  ok('configuracoes abre', config.status === 200 && config.text.includes('Empresa emitente'));
  const salvarConfig = await http.post('/configuracoes', {
    _csrf: tokenOf(config.text),
    app_name: 'Z Materiais - Central de Orcamentos',
    name: 'Z MATERIAIS', legal_name: 'Z MATERIAL ELETRICO LTDA',
    cnpj: '08.605.022/0001-97', ie: '15.283.872',
    address: 'PA 160, Qd 06G, Lt 07 - Cidade Jardim, Parauapebas - PA',
    contact: '(94) 99223-8524', email: 'zmateriaiseletricos@gmail.com',
    bank_info: 'Banco do Brasil (001) | Agencia 3245-0 | Conta 107724-4',
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

  section('Estrutura das paginas');
  const paginas = [
    '/', '/clientes', '/clientes/novo', '/fornecedores', '/fornecedores/novo',
    `/fornecedores/${idAlfa}`, `/fornecedores/${idAlfa}/importar`, '/produtos',
    '/projetos', `/projetos/${projId}`, '/orcamentos', '/orcamentos/novo',
    `/orcamentos/${orcId}`, `/orcamentos/${orcId}/imprimir`, '/usuarios',
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
