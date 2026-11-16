// Modelo de planilha para os fornecedores preencherem.
// Gerado pela propria aplicacao (download) e tambem por tools/gerar-modelo.js.
import { buildXlsx } from './xlsx.js';

const CABECALHO = [
  'Código',
  'Descrição',
  'Valor Unitário',
  'Marca',
  'Estoque',
  'Código Fabricante',
  'Código de Barras (EAN)',
  'Referência',
  'NCM',
  'Unidade',
];

const EXEMPLOS = [
  ['6881', 'CAIXA CABO REDE SOHO', 2135.00, 'SOHO', 10, '6881', '7891234567890', 'REF6881', '85369090', 'UN'],
  ['661', 'CABO PP 2C 2,5 MM', 17.00, 'SIL', 300, '661', '7891234567891', 'REF661', '85444200', 'M'],
  ['7691', 'ELETRODUTO CORRUGADO 3/4', 24.00, 'TIGRE', 100, '7691', '7891234567892', 'REF7691', '39172900', 'PC'],
  ['10242', 'RACK 12U FECHADO', 2450.00, 'SOHO', 7, '10242', '7891234567893', 'REF10242', '85381000', 'UN'],
  ['28084', 'CONECTOR RJ45 CAT6 PASSAGEM', 11.00, 'SOHO', 500, '28084', '7891234567894', 'REF28084', '85367000', 'UN'],
  ['1152', 'ELETROCALHA 50x50 PERFILADA', 45.00, 'TIGRE', 60, '1152', '7891234567895', 'REF1152', '85369010', 'M'],
];

const INSTRUCOES = [
  ['Como preencher esta planilha', '', ''],
  ['', '', ''],
  ['Campo', 'Obrigatório', 'O que preencher'],
  ['Código', 'Não', 'Código interno do fornecedor (o "cod Z" que aparece na proposta).'],
  ['Descrição', 'SIM', 'Nome do produto como deve aparecer no orçamento. Não deixe em branco.'],
  ['Valor Unitário', 'SIM', 'Preço de custo unitário. Use vírgula para centavos (ex.: 1.234,56) ou apenas 1234.56.'],
  ['Marca', 'Não', 'Marca ou fabricante do item.'],
  ['Estoque', 'Não', 'Quantidade disponível. Pode ficar em branco.'],
  ['Código Fabricante', 'Não', 'Part number / código do fabricante. É por ele que o sistema cruza o mesmo item entre fornecedores diferentes.'],
  ['Código de Barras (EAN)', 'Não', 'EAN/GTIN com 13 dígitos. Também usado para cruzar o mesmo produto entre fornecedores.'],
  ['Referência', 'Não', 'Referência comercial do fornecedor.'],
  ['NCM', 'Não', 'Código fiscal de 8 dígitos (ex.: 85444200).'],
  ['Unidade', 'Não', 'UN, M, PC, CX, KG... Se ficar em branco assume UN.'],
  ['', '', ''],
  ['Regras importantes', '', ''],
  ['1', '', 'A primeira linha (cabeçalho) deve ser mantida. Os dados começam na linha 2.'],
  ['2', '', 'Cada linha deve ter pelo menos Descrição e Valor Unitário.'],
  ['3', '', 'Não inclua linhas de total, subtotal ou observações no meio dos produtos.'],
  ['4', '', 'Podem ser enviados vários arquivos, um por fornecedor, com layouts diferentes — o sistema identifica as colunas pelo nome.'],
  ['5', '', 'Aceita .xlsx e .csv. Se usar Excel antigo (.xls), salve como .xlsx antes de enviar.'],
  ['', '', ''],
  ['Ordem das colunas', '', 'A ordem não importa. O sistema procura pelo nome do cabeçalho.'],
  ['Vários fornecedores', '', 'Envie a planilha de cada fornecedor separadamente, dentro do cadastro dele.'],
];

/** Gera o modelo em .xlsx */
export function buildModeloXlsx() {
  const rows = [];
  rows.push({ cells: [{ v: 'MODELO PARA ENVIO DE PRODUTOS — CENTRAL DE ORÇAMENTOS', s: 'title' }], h: 28.05 });
  rows.push({ cells: [] });
  rows.push({
    cells: CABECALHO.map((h) => ({ v: h, s: 'header' })),
    h: 30,
  });
  for (const linha of EXEMPLOS) {
    rows.push({
      cells: [
        { v: linha[0], s: 'center' },
        { v: linha[1], s: 'cell' },
        { v: linha[2], s: 'money' },
        { v: linha[3], s: 'cell' },
        { v: linha[4], s: 'qty' },
        { v: linha[5], s: 'center' },
        { v: linha[6], s: 'center' },
        { v: linha[7], s: 'center' },
        { v: linha[8], s: 'center' },
        { v: linha[9], s: 'center' },
      ],
      h: 16.05,
    });
  }
  rows.push({ cells: [] });
  rows.push({
    cells: [{
      v: 'Substitua as linhas de exemplo pelos seus produtos. A linha de cabeçalho deve permanecer.',
      s: 'note',
    }],
  });

  const produtos = {
    name: 'PRODUTOS',
    cols: [11, 40, 15, 16, 10, 18, 22, 14, 12, 10],
    rows,
    merges: ['A1:J1'],
    freeze: 'A4',
    page: { orientation: 'landscape', paperSize: 9, fitToWidth: 1 },
  };

  const instrRows = INSTRUCOES.map((r, i) => ({
    cells: [
      { v: r[0], s: i === 0 ? 'title' : (r[1] === 'SIM' ? 'boldText' : 'cell') },
      { v: r[1], s: 'center' },
      { v: r[2], s: 'cell' },
    ],
    h: i === 0 ? 28.05 : 18,
  }));

  const instrucoes = {
    name: 'INSTRUCOES',
    cols: [26, 14, 90],
    rows: instrRows,
    merges: ['A1:C1'],
    page: { orientation: 'portrait', paperSize: 9, fitToWidth: 1 },
  };

  return buildXlsx([produtos, instrucoes], { title: 'Modelo de importacao de produtos' });
}

/** Gera o modelo em .csv (separador ";" com BOM, para abrir no Excel em pt-BR) */
export function buildModeloCsv() {
  const linhas = [CABECALHO.join(';')];
  for (const l of EXEMPLOS) {
    linhas.push([
      l[0], l[1], Number(l[2]).toFixed(2).replace('.', ','), l[3], l[4], l[5], l[6], l[7], l[8], l[9],
    ].join(';'));
  }
  return Buffer.concat([Buffer.from('\ufeff', 'utf8'), Buffer.from(linhas.join('\r\n') + '\r\n', 'utf8')]);
}

export { CABECALHO, EXEMPLOS };
