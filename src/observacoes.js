// Texto das observações e condições comerciais que aparece no PDF e na planilha.
//
// Ordem de prioridade:
//   1. o que foi escrito no orçamento (quotes.observations)
//   2. o texto padrão das configurações (settings.observacoes_padrao)
//   3. o texto embutido no código
import { setting } from './db.js';

export const OBSERVACOES_PADRAO = [
  '1. Validade desta proposta: {dias} dias a contar da data de emissão.',
  '2. Fornecimento dos materiais e execução dos serviços de instalação técnica realizados pela {empresa}.',
  '3. Valores unitários sujeitos a reajuste conforme variação de mercado.',
  '4. Garantia dos materiais conforme fabricantes e 12 meses para os serviços.',
].join('\n');

/** Texto bruto (pode conter {dias} e {empresa}). */
export function textoObservacoes(quote = {}) {
  const proprio = String(quote.observations || '').trim();
  if (proprio) return proprio;
  try {
    const padrao = String(setting('observacoes_padrao') || '').trim();
    if (padrao) return padrao;
  } catch {
    /* banco ainda não abriu */
  }
  return OBSERVACOES_PADRAO;
}

/** Linhas já com {dias} e {empresa} substituídos, prontas para exibir. */
export function linhasObservacoes(quote = {}, empresa = '') {
  const dias = Number(quote.valid_days) || 15;
  return textoObservacoes(quote)
    .replace(/\{empresa\}/gi, empresa)
    .replace(/\{dias\}/gi, String(dias))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
