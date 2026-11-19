// Gera o PDF da proposta direto no servidor (sem navegador, sem dependencias).
// Segue o mesmo desenho da folha de impressao: faixa de titulo, fornecedor e
// cliente, tabela de itens, totais, observacoes e dados bancarios.
import { Pdf, larguraTexto, quebrarTexto } from './pdf.js';
import { themeFor } from './layouts.js';
import { linhasObservacoes } from './observacoes.js';
import { fmtMoney, fmtQty } from './calc.js';

const MARGEM = 40;
const LARGURA = 595.28 - MARGEM * 2; // 515,28

const COLUNAS = [
  { chave: 'codigo', titulo: 'Código', largura: 58, alinhamento: 'center' },
  { chave: 'descricao', titulo: 'Descrição', largura: 267, alinhamento: 'left' },
  { chave: 'qtd', titulo: 'Qtd', largura: 45, alinhamento: 'center' },
  { chave: 'unitario', titulo: 'V. Unit.', largura: 72, alinhamento: 'right' },
  { chave: 'total', titulo: 'Total', largura: 73, alinhamento: 'right' },
];

function normaliza(cor, padrao = '#000000') {
  return cor && /^#?[0-9a-fA-F]{3,6}$/.test(String(cor)) ? `#${String(cor).replace('#', '')}` : padrao;
}

function xDaColuna(indice) {
  let x = MARGEM;
  for (let i = 0; i < indice; i += 1) x += COLUNAS[i].largura;
  return x;
}

function desenharCabecalhoTabela(pdf, t) {
  const altura = 18;
  pdf.retangulo(MARGEM, pdf.y, LARGURA, altura, normaliza(t.headerFill, '#1F4E78'));
  COLUNAS.forEach((col, i) => {
    const x = xDaColuna(i);
    const alvo = col.alinhamento === 'right'
      ? x + col.largura - 5
      : col.alinhamento === 'center' ? x + col.largura / 2 : x + 5;
    pdf.texto(col.titulo, alvo, pdf.y + 12.5, {
      size: 8.5, bold: true, color: normaliza(t.headerText, '#FFFFFF'), align: col.alinhamento,
    });
  });
  pdf.y += altura;
}

function desenharLinha(pdf, t, valores, destaque = false) {
  const linhasDesc = quebrarTexto(valores.descricao || '', COLUNAS[1].largura - 10, 8.5, Boolean(destaque));
  const altura = Math.max(16, linhasDesc.length * 11 + 5);
  pdf.espaco(altura + 1);

  if (destaque) pdf.retangulo(MARGEM, pdf.y, LARGURA, altura, normaliza(t.soft, '#E8EEF5'));

  const textoBase = pdf.y + 11;
  COLUNAS.forEach((col, i) => {
    const x = xDaColuna(i);
    const alvo = col.alinhamento === 'right'
      ? x + col.largura - 5
      : col.alinhamento === 'center' ? x + col.largura / 2 : x + 5;

    if (col.chave === 'descricao') {
      linhasDesc.forEach((l, n) => {
        pdf.texto(l, alvo, textoBase + n * 11, { size: 8.5, bold: Boolean(destaque) });
      });
    } else {
      pdf.texto(valores[col.chave] ?? '', alvo, textoBase, {
        size: 8.5, bold: Boolean(destaque), align: col.alinhamento,
      });
    }
  });

  pdf.linha(MARGEM, pdf.y + altura, MARGEM + LARGURA, pdf.y + altura, {
    color: normaliza(t.borderColor, '#CCCCCC'), espessura: 0.5,
  });
  pdf.y += altura;
}

function desenharTotais(pdf, t, calc, quote, despesas) {
  const linha = (rotulo, valor, { forte = false, corFundo = null, corTexto = '#000000', altura = 16 } = {}) => {
    pdf.espaco(altura);
    if (corFundo) pdf.retangulo(MARGEM, pdf.y, LARGURA, altura, corFundo);
    pdf.texto(rotulo, MARGEM + 6, pdf.y + 11.5, { size: forte ? 10 : 8.5, bold: forte, color: corTexto });
    pdf.texto(valor, MARGEM + LARGURA - 6, pdf.y + 11.5, {
      size: forte ? 10 : 8.5, bold: forte, color: corTexto, align: 'right',
    });
    pdf.y += altura;
  };

  linha(`Produtos — ${quote.title || ''}`, fmtMoney(calc.productsTotal), {
    forte: true, corFundo: normaliza(t.soft, '#E8EEF5'),
  });
  if (calc.servicesTotal > 0) {
    linha('Serviços', fmtMoney(calc.servicesTotal), { corFundo: normaliza(t.soft, '#E8EEF5') });
  }
  if (calc.servicePct > 0) {
    linha('Serviço de instalação', fmtMoney(calc.serviceValue), { corFundo: normaliza(t.soft, '#E8EEF5') });
  }
  for (const e of despesas) {
    linha(e.description || 'Despesa', fmtMoney(e.amount), { corFundo: normaliza(t.soft, '#E8EEF5') });
  }
  linha('VALOR TOTAL', fmtMoney(calc.total), {
    forte: true, corFundo: normaliza(t.primary, '#1F4E78'), corTexto: normaliza(t.titleText, '#FFFFFF'), altura: 22,
  });
}

function desenharSecao(pdf, t, titulo) {
  pdf.espaco(30);
  pdf.y += 12;
  pdf.texto(titulo, MARGEM, pdf.y + 9, { size: 9, bold: true, color: normaliza(t.sectionText, '#1F4E78') });
  pdf.y += 14;
}

function desenharBlocoQuote(pdf, t, { quote, items, calc, destaque = '' }, client, emitter) {
  const empresa = (emitter?.legal_name || emitter?.name || '').toUpperCase();

  if (destaque) {
    pdf.texto(destaque, MARGEM, pdf.y + 9, { size: 10.5, bold: true, color: normaliza(t.sectionText, '#1F4E78') });
    pdf.y += 16;
  }

  // faixa do titulo
  const alturaTitulo = 30;
  pdf.retangulo(MARGEM, pdf.y, LARGURA, alturaTitulo, normaliza(t.primary, '#1F4E78'));
  const titulo = empresa
    ? `${empresa} — ORÇAMENTO DE MATERIAIS E SERVIÇOS`
    : 'ORÇAMENTO DE MATERIAIS E SERVIÇOS';
  let tamanhoTitulo = 13;
  while (tamanhoTitulo > 8 && larguraTexto(titulo, tamanhoTitulo, true) > LARGURA - 24) {
    tamanhoTitulo -= 0.5;
  }
  pdf.texto(titulo, MARGEM + LARGURA / 2, pdf.y + alturaTitulo / 2 + 4.5, {
    size: tamanhoTitulo, bold: true, color: normaliza(t.titleText, '#FFFFFF'), align: 'center',
  });
  pdf.y += alturaTitulo + 14;

  // fornecedor e cliente, lado a lado
  const coluna = LARGURA / 2 - 10;
  const topo = pdf.y;
  const escrever = (x, rotulo, nome, doc) => {
    pdf.texto(rotulo.toUpperCase(), x, topo + 8, { size: 7.5, color: '#6B7A90' });
    const linhas = quebrarTexto(nome || '', coluna, 9);
    linhas.slice(0, 2).forEach((l, i) => pdf.texto(l, x, topo + 20 + i * 11, { size: 9 }));
    if (doc) pdf.texto(doc, x, topo + 20 + Math.min(linhas.length, 2) * 11, { size: 9 });
  };
  escrever(MARGEM, 'Fornecedor', emitter?.legal_name || emitter?.name || '', emitter?.cnpj || '');
  escrever(MARGEM + LARGURA / 2 + 10, 'Cliente', client?.name || '', client?.cnpj || '');
  pdf.y = topo + 20 + 2 * 11 + 14;

  pdf.texto(`Projeto / Local: ${quote.location || quote.title || ''}`, MARGEM, pdf.y, { size: 9, bold: true });
  pdf.y += 18;

  desenharCabecalhoTabela(pdf, t);

  const html = items.map((it, i) => ({ it, i }));
  const produtos = html.filter(({ it }) => Number(it.is_service) !== 1);
  const servicos = html.filter(({ it }) => Number(it.is_service) === 1);

  const valoresDe = ({ it, i }) => ({
    codigo: it.internal_code || '',
    descricao: it.description || '',
    qtd: fmtQty(it.qty),
    unitario: fmtMoney(calc.lines[i]?.unit_price ?? 0),
    total: fmtMoney(calc.lines[i]?.line_total ?? 0),
  });

  if (!produtos.length && !servicos.length) {
    desenharLinha(pdf, t, { codigo: '', descricao: '(sem itens)', qtd: '', unitario: '', total: '' });
  }

  for (const entrada of produtos) {
    const antes = pdf.y;
    pdf.espaco(40);
    if (pdf.y < antes) desenharCabecalhoTabela(pdf, t); // pagina nova: repete o cabecalho
    desenharLinha(pdf, t, valoresDe(entrada));
  }

  if (servicos.length) {
    pdf.espaco(30);
    pdf.retangulo(MARGEM, pdf.y, LARGURA, 17, normaliza(t.soft, '#E8EEF5'));
    pdf.texto('Serviços', MARGEM + 6, pdf.y + 12, { size: 8.5, bold: true });
    pdf.y += 17;
    for (const entrada of servicos) {
      const antes = pdf.y;
      pdf.espaco(40);
      if (pdf.y < antes) desenharCabecalhoTabela(pdf, t);
      desenharLinha(pdf, t, valoresDe(entrada));
    }
  }

  desenharTotais(pdf, t, calc, quote, calc.expenseLines || []);

  desenharSecao(pdf, t, 'OBSERVAÇÕES E CONDIÇÕES COMERCIAIS');
  for (const linha of linhasObservacoes(quote, emitter?.legal_name || emitter?.name || '')) {
    pdf.espaco(14);
    const pedacos = quebrarTexto(linha, LARGURA, 8.5);
    pedacos.forEach((p) => {
      pdf.espaco(12);
      pdf.texto(p, MARGEM, pdf.y + 9, { size: 8.5 });
      pdf.y += 12;
    });
  }

  desenharSecao(pdf, t, 'DADOS BANCÁRIOS');
  const banco = String(emitter?.bank_info || '').trim();
  const linhasBanco = banco
    ? banco.split(/\r?\n/).filter((l) => l.trim())
    : [
      `Razão Social: ${emitter?.legal_name || emitter?.name || ''}`,
      `CNPJ / PIX: ${emitter?.cnpj || ''}`,
      `Contato: ${emitter?.contact || ''}`,
    ];
  for (const linha of linhasBanco) {
    pdf.espaco(12);
    pdf.texto(linha, MARGEM, pdf.y + 9, { size: 8.5 });
    pdf.y += 12;
  }
}

function desenharRodape(pdf) {
  const total = pdf.paginas.length;
  pdf.paginas.forEach((_, i) => {
    const anterior = pdf._paginaAtual;
    pdf._paginaAtual = i;
    pdf.texto(`${i + 1} / ${total}`, 595.28 / 2, pdf.h - 22, { size: 7.5, color: '#8A98A8', align: 'center' });
    pdf._paginaAtual = anterior;
  });
}

/**
 * @param {object} p
 * @param {Array}  p.quotes [{ quote, items, calc }]
 * @param {object} p.client
 * @param {object} p.emitter
 * @returns {Buffer}
 */
export function buildQuotePdf({ quotes, client, emitter }) {
  const pdf = new Pdf({ margem: MARGEM });
  pdf.y = MARGEM;

  quotes.forEach((bloco, i) => {
    if (i > 0) pdf.novaPagina();
    // cada proposta pode ter a sua empresa emitente (projeto com varios participantes)
    const emissor = bloco.emitter || emitter || {};
    const t = themeFor(bloco.quote?.layout || emissor.layout);
    desenharBlocoQuote(pdf, t, bloco, client, emissor);
  });

  desenharRodape(pdf);
  return pdf.toBuffer();
}
