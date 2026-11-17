import { registerAuthRoutes } from './auth.js';
import { registerAdminRoutes } from './admin.js';
import { registerCatalogRoutes } from './catalog.js';
import { registerProjectRoutes } from './project.js';
import { registerArquivoRoutes } from './arquivos.js';
import { registerQuoteRoutes } from './quotes.js';

export function registerRoutes() {
  registerAuthRoutes();
  registerAdminRoutes();
  registerCatalogRoutes();
  registerProjectRoutes();
  registerArquivoRoutes();
  registerQuoteRoutes();
}
