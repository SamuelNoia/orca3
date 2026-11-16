#!/bin/sh
# Prepara o banco na primeira execucao e sobe a aplicacao.
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
DB_FILE="${DB_FILE:-$DATA_DIR/orcamentos.db}"
export DATA_DIR
export DB_FILE

mkdir -p "$DATA_DIR"

if [ ! -f "$DB_FILE" ]; then
  case "${SEED:-inicial}" in
    inicial)
      echo "[init] banco novo: criando fornecedor e produto de teste"
      node tools/seed-inicial.js
      ;;
    none)
      echo "[init] banco novo: iniciando totalmente vazio"
      ;;
    demo)
      DEMO_FILE="${DEMO_FILE:-$DATA_DIR/demo.xlsx}"
      if [ -f "$DEMO_FILE" ]; then
        echo "[init] banco novo: carregando base de demonstracao de $DEMO_FILE"
        node tools/seed-demo.js "$DEMO_FILE"
      else
        echo "[init] AVISO: SEED=demo precisa de $DEMO_FILE; iniciando vazio"
      fi
      ;;
    *)
      echo "[init] SEED='${SEED}' desconhecido; iniciando vazio"
      ;;
  esac
else
  echo "[init] banco existente em $DB_FILE (dados preservados)"
fi

echo "[init] iniciando servidor em ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node server.js
