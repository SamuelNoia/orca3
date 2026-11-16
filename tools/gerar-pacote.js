// Gera pacote-casaos.zip com os arquivos que precisam ir para o servidor.
// Uso: node tools/gerar-pacote.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipWrite } from '../src/xlsx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INCLUIR = [
  'server.js',
  'package.json',
  'README.md',
  'docker-compose.casaos.yml',
  'src',
  'public',
  'tools',
];

const IGNORAR = new Set(['data', 'backups', 'node_modules', '.git']);

function coletar(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (st.isFile()) return [{ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(abs) }];

  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    if (IGNORAR.has(entry)) continue;
    const childRel = path.join(rel, entry);
    const childAbs = path.join(ROOT, childRel);
    const childSt = fs.statSync(childAbs);
    if (childSt.isDirectory()) out.push(...coletar(childRel));
    else if (childSt.isFile()) {
      if (entry.startsWith('_')) continue;                      // scripts temporarios
      if (/\.(zip|db|db-shm|db-wal)$/i.test(entry)) continue;    // dados locais
      out.push({ name: childRel.replace(/\\/g, '/'), data: fs.readFileSync(childAbs) });
    }
  }
  return out;
}

const arquivos = INCLUIR.flatMap(coletar);
const destino = path.join(ROOT, 'pacote-casaos.zip');
fs.writeFileSync(destino, zipWrite(arquivos));

const kb = (fs.statSync(destino).size / 1024).toFixed(1);
console.log(`Pacote gerado: ${destino} (${kb} KB, ${arquivos.length} arquivos)`);
console.log('\nConteudo:');
for (const a of arquivos.slice(0, 40)) console.log(`  ${a.name}`);
if (arquivos.length > 40) console.log(`  ... e mais ${arquivos.length - 40} arquivo(s)`);
console.log('\nNo servidor: descompacte em /DATA/AppData/orcamentos/app');
