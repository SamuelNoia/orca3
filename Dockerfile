# Central de Orcamentos - imagem de producao
# Aplicacao sem dependencias npm: nao ha "npm install", so o runtime do Node.
FROM node:24-alpine

# Se o node:sqlite nao estiver disponivel nesta variante, troque a linha acima por:
# FROM node:24-slim

LABEL org.opencontainers.image.title="Central de Orcamentos Z Materiais" \
      org.opencontainers.image.description="Orcamentos multi-fornecedor com SQLite e exportacao XLSX" \
      org.opencontainers.image.version="1.0"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    SEED=inicial

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY tools ./tools
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
