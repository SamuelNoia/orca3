import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'orcamentos.db');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || '127.0.0.1';
export const SESSION_SECRET = process.env.SESSION_SECRET || '';
