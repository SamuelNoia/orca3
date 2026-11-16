// Gera os arquivos de modelo para enviar aos fornecedores.
// Uso: node tools/gerar-modelo.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModeloXlsx, buildModeloCsv } from '../src/modelo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsxPath = path.join(ROOT, 'modelo_importacao_produtos.xlsx');
const csvPath = path.join(ROOT, 'modelo_importacao_produtos.csv');

fs.writeFileSync(xlsxPath, buildModeloXlsx());
fs.writeFileSync(csvPath, buildModeloCsv());

console.log('Modelos gerados:');
console.log(`  ${xlsxPath} (${(fs.statSync(xlsxPath).size / 1024).toFixed(1)} KB)`);
console.log(`  ${csvPath} (${(fs.statSync(csvPath).size / 1024).toFixed(1)} KB)`);
