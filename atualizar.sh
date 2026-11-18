#!/bin/sh
# =====================================================================
#  Central de Orcamentos - atualizacao em um comando (Docker / Linux)
#
#  Uso normal:
#     sh atualizar.sh
#
#  Direto do GitHub:
#     curl -fsSL https://raw.githubusercontent.com/SamuelNoia/orca3/main/atualizar.sh | sudo sh
#
#  Personalizando:
#     NOME=orcamentos sh atualizar.sh     nome do container
#     SEM_BACKUP=1 sh atualizar.sh        nao gerar backup antes
#
#  O que faz: baixa a imagem nova, guarda um backup do banco, recria o
#  container com as MESMAS opcoes (porta, volume, fuso) e confere a versao.
# =====================================================================
set -eu

NOME="${NOME:-orcamentos}"
SEM_BACKUP="${SEM_BACKUP:-}"
TENTATIVAS="${TENTATIVAS:-40}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
ok()    { printf '\033[1;32m  ok\033[0m  %s\n' "$1"; }
aviso() { printf '\033[1;33m  !\033[0m   %s\n' "$1"; }
erro()  { printf '\033[1;31mERRO:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- verificacoes
command -v docker >/dev/null 2>&1 || erro "Docker nao encontrado."

if ! docker info >/dev/null 2>&1; then
  erro "Sem permissao para falar com o Docker.
       Rode com sudo:  sudo sh atualizar.sh"
fi

if ! docker inspect "$NOME" >/dev/null 2>&1; then
  erro "Container '$NOME' nao encontrado.
       Se a instalacao usa outro nome:  NOME=seu-nome sh atualizar.sh
       Se ainda nao instalou:           curl -fsSL https://raw.githubusercontent.com/SamuelNoia/orca3/main/instalar.sh | sh"
fi

# ---------------------------------------------------------------- o que ja existe
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$NOME")
DATA_SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$NOME")
PORTA=$(docker port "$NOME" 3000/tcp 2>/dev/null | head -n 1 | awk -F: '{print $NF}' || true)
if [ -z "$PORTA" ]; then
  PORTA=$(docker inspect -f '{{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostPort}}{{end}}{{end}}' "$NOME")
fi

env_de() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$NOME" 2>/dev/null \
    | sed -n "s/^$1=//p" | head -n 1
}

TZ_ATUAL=$(env_de TZ || true)
EMAIL_ATUAL=$(env_de ADMIN_EMAIL || true)
SEED_ATUAL=$(env_de SEED || true)

[ -n "$TZ_ATUAL" ]    || TZ_ATUAL="America/Sao_Paulo"
[ -n "$EMAIL_ATUAL" ] || EMAIL_ATUAL="admin@empresa.local"
[ -n "$SEED_ATUAL" ]  || SEED_ATUAL=""

if [ -z "$DATA_SRC" ]; then
  erro "Nao encontrei o volume de dados (/app/data) do container '$NOME'.
       Sem isso eu nao consigo atualizar sem risco de perder os orcamentos.
       Nada foi alterado."
fi

if [ -z "$PORTA" ]; then
  erro "Nao consegui descobrir a porta publicada do container.
       Nada foi alterado."
fi

VERSAO_ANTES=$(docker exec "$NOME" node -p "require('/app/package.json').version" 2>/dev/null || echo "?")

info "Container: $NOME"
printf '      imagem:  %s\n' "$IMAGE"
printf '      porta:   %s\n' "$PORTA"
printf '      dados:   %s\n' "$DATA_SRC"
printf '      versao:  %s\n' "$VERSAO_ANTES"

# ---------------------------------------------------------------- 1. imagem nova
info "Baixando a versao nova da imagem..."
if ! docker pull "$IMAGE"; then
  erro "Falha ao baixar a imagem. Nada foi alterado.
       Se o pacote for privado:  echo SEU_TOKEN | docker login ghcr.io -u samuelnoia --password-stdin"
fi

VERSAO_NOVA=$(docker run --rm --entrypoint node "$IMAGE" -p "require('/app/package.json').version" 2>/dev/null || echo "?")
printf '      versao disponivel: %s\n' "$VERSAO_NOVA"

if [ "$VERSAO_ANTES" = "$VERSAO_NOVA" ] && [ "$VERSAO_ANTES" != "?" ]; then
  info "Ja esta na versao $VERSAO_ANTES."
  printf '      Para reiniciar mesmo assim:  docker restart %s\n' "$NOME"
  exit 0
fi

# ---------------------------------------------------------------- 2. backup
if [ -z "$SEM_BACKUP" ] && [ -d "$DATA_SRC" ]; then
  info "Guardando backup do banco..."
  BK_DIR="$(dirname "$DATA_SRC")/backups"
  mkdir -p "$BK_DIR" 2>/dev/null || true
  STAMP=$(date +%Y%m%d-%H%M%S)
  BK="$BK_DIR/orcamentos-$STAMP.tar.gz"
  if tar -czf "$BK" -C "$DATA_SRC" . 2>/dev/null; then
    ok "Backup: $BK"
  else
    aviso "Nao consegui criar o backup em $BK"
    aviso "Atualizacao cancelada para nao arriscar os dados."
    aviso "Se quiser mesmo assim:  SEM_BACKUP=1 sh atualizar.sh"
    exit 1
  fi
else
  aviso "Backup ignorado"
fi

# ---------------------------------------------------------------- 3. recria
info "Recriando o container..."
docker stop "$NOME" >/dev/null 2>&1 || true
docker rm "$NOME" >/dev/null 2>&1 || true

# shellcheck disable=SC2086
if ! docker run -d \
  --name "$NOME" \
  --restart unless-stopped \
  -p "${PORTA}:3000" \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e DATA_DIR=/app/data \
  -e NODE_ENV=production \
  -e TZ="$TZ_ATUAL" \
  -e SEED="$SEED_ATUAL" \
  -e ADMIN_EMAIL="$EMAIL_ATUAL" \
  -v "${DATA_SRC}:/app/data" \
  "$IMAGE" >/dev/null; then
  erro "Nao consegui criar o container novo (o antigo ja foi removido).
       Seus dados continuam em $DATA_SRC.
       Para voltar atras:
         tar -xzf ${BK:-SEU-BACKUP.tar.gz} -C $DATA_SRC
         curl -fsSL https://raw.githubusercontent.com/SamuelNoia/orca3/main/instalar.sh | sh"
fi

# ---------------------------------------------------------------- 4. espera
info "Aguardando a aplicacao responder..."
tentativas=0
pronto=0
while [ "$tentativas" -lt "$TENTATIVAS" ]; do
  if docker inspect --format '{{.State.Running}}' "$NOME" 2>/dev/null | grep -q true; then
    if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${PORTA}/login" >/dev/null 2>&1; then
      pronto=1
      break
    fi
    if ! command -v curl >/dev/null 2>&1 && command -v wget >/dev/null 2>&1 \
       && wget -q -O /dev/null "http://127.0.0.1:${PORTA}/login" 2>/dev/null; then
      pronto=1
      break
    fi
    sleep 2
  else
    echo ""
    docker logs --tail 20 "$NOME" 2>&1 || true
    erro "O container parou depois da atualizacao.
       Volte para a versao anterior assim:
         docker rm -f $NOME
         tar -xzf ${BK:-SEU-BACKUP.tar.gz} -C $DATA_SRC
         depois rode:  curl -fsSL https://raw.githubusercontent.com/SamuelNoia/orca3/main/instalar.sh | sh"
  fi
  tentativas=$((tentativas + 1))
done

if [ "$pronto" -ne 1 ]; then
  aviso "O container esta rodando, mas ainda nao respondeu em http://127.0.0.1:${PORTA}"
  aviso "Veja o log com:  docker logs -f $NOME"
fi

VERSAO_DEPOIS=$(docker exec "$NOME" node -p "require('/app/package.json').version" 2>/dev/null || echo "?")

IP_LOCAL=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
[ -n "${IP_LOCAL:-}" ] || IP_LOCAL="localhost"

cat <<FIM

=====================================================================
  ATUALIZADO

  Versao:   ${VERSAO_ANTES}  ->  ${VERSAO_DEPOIS}
  Acesse:   http://${IP_LOCAL}:${PORTA}
  Dados:    ${DATA_SRC}
  Backup:   ${BK:-nenhum}

  Seus dados foram preservados. O banco e migrado sozinho na abertura.
=====================================================================
FIM
