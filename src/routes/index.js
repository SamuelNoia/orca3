import { registerAuthRoutes } from './auth.js';
import { registerAdminRoutes } from './admin.js';
import { registerCatalogRoutes } from './catalog.js';
import { registerQuoteRoutes } from './quotes.js';

export function registerRoutes() {
  registerAuthRoutes();
  registerAdminRoutes();
  registerCatalogRoutes();
  registerQuoteRoutes();
}
