// Escritor de PDF minimo (sem dependencias).
//
// Usa as fontes padrao Helvetica/Helvetica-Bold (nao precisam ser embutidas) e
// trabalha em coordenadas "de cima para baixo": y = 0 e o topo da pagina, como
// no HTML. A conversao para o sistema do PDF (origem embaixo) acontece na hora
// de escrever o comando.

export const A4 = { w: 595.28, h: 841.89 };

// Larguras das fontes padrao (milesimos de em), para quebrar linha e alinhar.
const REG = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 278, '\\': 278, ']': 278,
  '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584,
};

const BOLD = {
  ...REG,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  ':': 333, ';': 333, '.': 278, ',': 278, '-': 333, ' ': 278,
};

// letra base de cada caractere acentuado (para medir a largura)
const BASE = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n', ý: 'y', ÿ: 'y',
  Á: 'A', À: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A', É: 'E', È: 'E', Ê: 'E', Ë: 'E',
  Í: 'I', Ì: 'I', Î: 'I', Ï: 'I', Ó: 'O', Ò: 'O', Ô: 'O', Õ: 'O', Ö: 'O',
  Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U', Ç: 'C', Ñ: 'N', Ý: 'Y',
};

function larguraChar(ch, bold) {
  const base = BASE[ch] || ch;
  const tabela = bold ? BOLD : REG;
  return tabela[base] ?? 500;
}

export function larguraTexto(texto, size = 9, bold = false) {
  let total = 0;
  for (const ch of String(texto)) total += larguraChar(ch, bold);
  return (total / 1000) * size;
}

/** Quebra o texto na largura disponivel (por palavras). */
export function quebrarTexto(texto, largura, size = 9, bold = false) {
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';

  for (const palavra of palavras) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (larguraTexto(teste, size, bold) <= largura) {
      atual = teste;
      continue;
    }
    if (atual) linhas.push(atual);
    // palavra sozinha maior que a largura: corta em pedacos
    if (larguraTexto(palavra, size, bold) > largura) {
      let pedaco = '';
      for (const ch of palavra) {
        if (larguraTexto(pedaco + ch, size, bold) > largura) {
          linhas.push(pedaco);
          pedaco = ch;
        } else {
          pedaco += ch;
        }
      }
      atual = pedaco;
    } else {
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

// ------------------------------------------------------------------ PDF
// Caracteres tipograficos que existem no WinAnsi (cp1252) mas nao no Latin-1.
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};

function bytes(str) {
  const saida = [];
  for (const ch of String(str)) {
    let code = CP1252[ch] ?? ch.codePointAt(0);
    if (code > 255) code = 63; // fora do WinAnsi vira "?"
    if (ch === '(' || ch === ')' || ch === '\\') saida.push(92);
    saida.push(code);
  }
  return Buffer.from(saida);
}

function cor(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.padEnd(6, '0').slice(0, 6);
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

export class Pdf {
  constructor({ largura = A4.w, altura = A4.h, margem = 40 } = {}) {
    this.w = largura;
    this.h = altura;
    this.margem = margem;
    this.paginas = [];
    this.novaPagina();
  }

  get y() {
    return this._y;
  }

  set y(v) {
    this._y = v;
  }

  novaPagina() {
    this.paginas.push([]);
    this._y = this.margem;
    this._paginaAtual = this.paginas.length - 1;
    return this;
  }

  get ops() {
    return this.paginas[this._paginaAtual];
  }

  /** Garante espaco; cria pagina nova se necessario. */
  espaco(altura) {
    if (this._y + altura > this.h - this.margem) {
      this.novaPagina();
      return true;
    }
    return false;
  }

  texto(t, x, y, { size = 9, bold = false, color = '#000000', align = 'left', width = 0 } = {}) {
    if (t === null || t === undefined || t === '') return this;
    let px = x;
    if (align === 'right') px = x - larguraTexto(t, size, bold);
    else if (align === 'center') px = x - larguraTexto(t, size, bold) / 2;
    else if (align === 'justify' && width) px = x;

    const py = this.h - y;
    // a cor e o comando de texto vao antes do BT; dentro do BT so operadores de texto
    this.ops.push(
      `${cor(color)} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf `
      + `1 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)} Tm (`,
    );
    this.ops.push(bytes(t));
    this.ops.push(') Tj ET\n');
    return this;
  }

  retangulo(x, y, w, h, preenchimento) {
    const py = this.h - y - h;
    this.ops.push(`${cor(preenchimento)} rg ${x.toFixed(2)} ${py.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`);
    return this;
  }

  linha(x1, y1, x2, y2, { color = '#cccccc', espessura = 0.5 } = {}) {
    this.ops.push(
      `${cor(color)} RG ${espessura} w ${x1.toFixed(2)} ${(this.h - y1).toFixed(2)} m `
      + `${x2.toFixed(2)} ${(this.h - y2).toFixed(2)} l S\n`,
    );
    return this;
  }

  /** Escreve texto quebrando em linhas; devolve quantas linhas usou. */
  paragrafo(t, x, largura, { size = 9, bold = false, color = '#000000', entrelinha = 1.35 } = {}) {
    const linhas = quebrarTexto(t, largura, size, bold);
    const passo = size * entrelinha;
    for (const l of linhas) {
      this.espaco(passo);
      this.texto(l, x, this._y + size, { size, bold, color });
      this._y += passo;
    }
    return linhas.length;
  }

  /** Constroi o buffer final. */
  toBuffer() {
    const lista = [];
    const push = (b) => {
      if (b === null || b === undefined) lista.push(Buffer.alloc(0));
      else lista.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'));
      return lista.length;
    };

    const catalogoNum = push(null);
    const paginasNum = push(null);
    const f1 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const paginasNums = [];
    for (const ops of this.paginas) {
      const conteudo = Buffer.concat(ops.map((o) => (Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'))));
      const conteudoNum = push(Buffer.concat([
        Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`, 'latin1'),
        conteudo,
        Buffer.from('\nendstream', 'latin1'),
      ]));
      const paginaNum = push(
        `<< /Type /Page /Parent ${paginasNum} 0 R /MediaBox [0 0 ${this.w.toFixed(2)} ${this.h.toFixed(2)}] `
        + `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${conteudoNum} 0 R >>`,
      );
      paginasNums.push(paginaNum);
    }

    lista[catalogoNum - 1] = Buffer.from(`<< /Type /Catalog /Pages ${paginasNum} 0 R >>`, 'latin1');
    lista[paginasNum - 1] = Buffer.from(
      `<< /Type /Pages /Kids [${paginasNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${paginasNums.length} >>`,
      'latin1',
    );

    const partes = [];
    let tamanho = 0;
    partes.push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'));
    tamanho = partes[0].length;

    const offsets = [];
    for (let i = 0; i < lista.length; i += 1) {
      const cabecalho = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const corpo = lista[i];
      const fim = Buffer.from('\nendobj\n', 'latin1');
      offsets.push(tamanho);
      partes.push(cabecalho, corpo, fim);
      tamanho += cabecalho.length + corpo.length + fim.length;
    }

    const inicioXref = tamanho;
    let xref = `xref\n0 ${lista.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${lista.length + 1} /Root ${catalogoNum} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    partes.push(Buffer.from(xref, 'latin1'));

    return Buffer.concat(partes);
  }
}
