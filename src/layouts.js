// Layouts visuais do orcamento. Cada fornecedor escolhe o seu no cadastro e
// a planilha gerada usa esse layout.
//
// Um layout controla fonte, tamanhos, cores, bordas, alturas de linha e
// largura das colunas. A estrutura do documento (secoes e formulas) e a mesma.

export const LAYOUT_PADRAO = 'classico';

const BASE = {
  font: 'Segoe UI',
  szBody: 9,
  szTitle: 13,
  szSection: 10,
  szHeader: 10,
  szTotal: 11,
  primary: '1F4E78',
  headerFill: '2F5597',
  soft: 'D9E1F2',
  text: '000000',
  titleText: 'FFFFFF',
  sectionText: '1F4E78',
  headerText: 'FFFFFF',
  totalText: 'FFFFFF',
  note: '444444',
  borderColor: 'B4C6E7',
  borderStyle: 'thin',
  borders: 'all',          // all | bottom | none
  headerAlign: 'center',   // center | left
  titleAlign: 'center',
  rowH: 16.05,
  titleH: 28.05,
  headerH: 22.05,
  cols: [11, 26, 8, 13, 20, 20],
};

export const LAYOUTS = [
  {
    id: 'classico',
    name: 'Clássico',
    description: 'Azul institucional, fonte Segoe UI 9, cabeçalho preenchido. É o modelo atual.',
    theme: { ...BASE },
  },
  {
    id: 'moderno',
    name: 'Moderno',
    description: 'Calibri 11, título grande, cabeçalho claro com texto escuro e linhas só na base.',
    theme: {
      ...BASE,
      font: 'Calibri',
      szBody: 11,
      szTitle: 16,
      szSection: 12,
      szHeader: 11,
      szTotal: 13,
      primary: 'F2F2F2',
      headerFill: 'EDEDED',
      soft: 'F7F7F7',
      titleText: '1A1A1A',
      sectionText: '1A1A1A',
      headerText: '1A1A1A',
      totalText: '1A1A1A',
      note: '555555',
      borderColor: 'D0D0D0',
      borders: 'bottom',
      headerAlign: 'left',
      titleAlign: 'left',
      rowH: 20,
      titleH: 34,
      headerH: 24,
      cols: [12, 34, 8, 12, 18, 20],
    },
  },
  {
    id: 'compacto',
    name: 'Compacto',
    description: 'Arial Narrow 8, sem preenchimento, cabeçalho sublinhado. Cabe muito mais item por página.',
    theme: {
      ...BASE,
      font: 'Arial Narrow',
      szBody: 8,
      szTitle: 11,
      szSection: 9,
      szHeader: 8,
      szTotal: 10,
      primary: 'FFFFFF',
      headerFill: 'FFFFFF',
      soft: 'FFFFFF',
      titleText: '000000',
      sectionText: '000000',
      headerText: '000000',
      totalText: '000000',
      note: '333333',
      borderColor: '000000',
      borders: 'bottom',
      headerAlign: 'left',
      titleAlign: 'left',
      rowH: 12.5,
      titleH: 20,
      headerH: 16,
      cols: [9, 46, 6, 10, 15, 16],
    },
  },
  {
    id: 'formal',
    name: 'Formal',
    description: 'Times New Roman 10, caixa cinza escuro, aparência de documento jurídico.',
    theme: {
      ...BASE,
      font: 'Times New Roman',
      szBody: 10,
      szTitle: 14,
      szSection: 11,
      szHeader: 10,
      szTotal: 12,
      primary: '404040',
      headerFill: '404040',
      soft: 'E7E6E6',
      titleText: 'FFFFFF',
      sectionText: '404040',
      headerText: 'FFFFFF',
      totalText: 'FFFFFF',
      note: '333333',
      borderColor: '808080',
      borders: 'all',
      headerAlign: 'center',
      rowH: 17,
      titleH: 30,
      headerH: 23,
      cols: [11, 30, 8, 13, 19, 19],
    },
  },
  {
    id: 'executivo',
    name: 'Executivo',
    description: 'Verdana 9, verde-petróleo, título maior e linhas espaçadas. Visual de proposta premium.',
    theme: {
      ...BASE,
      font: 'Verdana',
      szBody: 9,
      szTitle: 15,
      szSection: 10,
      szHeader: 9,
      szTotal: 12,
      primary: '1F6F5C',
      headerFill: '2E8B70',
      soft: 'E3F1EC',
      titleText: 'FFFFFF',
      sectionText: '1F6F5C',
      headerText: 'FFFFFF',
      totalText: 'FFFFFF',
      note: '3F5B52',
      borderColor: 'B7D9CD',
      borders: 'all',
      headerAlign: 'center',
      rowH: 17.5,
      titleH: 32,
      headerH: 24,
      cols: [12, 30, 8, 12, 19, 19],
    },
  },
];

const PORID = new Map(LAYOUTS.map((l) => [l.id, l]));

export function layoutInfo(id) {
  return PORID.get(String(id || '')) || PORID.get(LAYOUT_PADRAO);
}

export function themeFor(id) {
  return { ...layoutInfo(id).theme };
}

export function layoutOptions() {
  return LAYOUTS.map((l) => ({ value: l.id, label: l.name }));
}

/** Links para baixar um exemplo de cada layout. */
export function layoutExampleLinks() {
  return LAYOUTS.map((l) => `<a href="/layout-exemplo/${l.id}.xlsx">${l.name}</a>`).join(' · ');
}

/** CSS que faz a tela de impressao/PDF seguir o mesmo layout da planilha. */
export function printThemeCss(theme) {
  const t = theme || themeFor(LAYOUT_PADRAO);
  const px = (pt) => Math.round(Number(pt) * 1.33);
  const align = t.headerAlign === 'center' ? 'center' : 'left';
  const pad = Math.max(3, Math.round(px(t.rowH) / 3.2));

  return `<style>
  .print-sheet { font-family: "${t.font}", Arial, sans-serif; font-size: ${px(t.szBody)}px; }
  .print-sheet h1 {
    background: #${t.primary}; color: #${t.titleText};
    font-size: ${px(t.szTitle)}px; text-align: ${t.titleAlign === 'left' ? 'left' : 'center'};
    padding: ${Math.round(px(t.titleH) / 4)}px 10px; margin-bottom: 16px;
  }
  .print-sheet thead th {
    background: #${t.headerFill}; color: #${t.headerText};
    font-size: ${px(t.szHeader)}px; text-align: ${align};
    border: 0; border-bottom: 1px solid #${t.borderColor};
  }
  .print-sheet td, .print-sheet th {
    border-bottom: 1px solid #${t.borderColor}; padding: ${pad}px 8px;
  }
  .print-sheet tfoot td { background: #${t.soft}; color: #${t.text}; }
  .print-sheet tfoot tr.total td { font-size: ${px(t.szTotal)}px; font-weight: 700; }
  .print-sheet h3 { color: #${t.sectionText}; }
  </style>`;
}
