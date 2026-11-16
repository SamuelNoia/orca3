#!/bin/sh
# =====================================================================
#  Central de Orcamentos - instalacao em um comando (Docker)
#
#  Uso normal:
#     sh instalar.sh
#
#  Direto do GitHub (sem baixar o repositorio):
#     curl -fsSL https://raw.githubusercontent.com/SamuelNoia/orca3/main/instalar.sh | sh
#
#  Personalizando:
#     PORT=4000 ADMIN_PASSWORD=MinhaSenha123 sh instalar.sh
#     IMAGE=ghcr.io/outro/repo:tag sh instalar.sh
#
#  Rodar de novo atualiza a imagem mantendo os dados.
# =====================================================================
set -eu

IMAGE="${IMAGE:-ghcr.io/samuelnoia/orca3:latest}"
NOME="${NOME:-orcamentos}"
PORT="${PORT:-3088}"
TZ="${TZ:-America/Sao_Paulo}"
SEED="${SEED:-inicial}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@empresa.local}"
# senha vazia = o sistema gera uma aleatoria na primeira execucao
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

# pasta de dados: usa o padrao do CasaOS/ZimaOS quando existir
if [ -z "${DATA_DIR:-}" ]; then
  if [ -d "/DATA" ]; then
    DATA_DIR="/DATA/AppData/${NOME}/data"
  else
    DATA_DIR="/opt/${NOME}/data"
  fi
fi

info()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
erro()  { printf '\033[1;31mERRO:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- verificacoes
command -v docker >/dev/null 2>&1 || erro "Docker nao encontrado. Instale o Docker primeiro."

if ! docker info >/dev/null 2>&1; then
  erro "Sem permissao para falar com o Docker. Rode com sudo ou adicione seu usuario ao grupo docker."
fi

info "Imagem:  $IMAGE"
info "Porta:   $PORT"
info "Dados:   $DATA_DIR"

# ---------------------------------------------------------------- preparacao
mkdir -p "$DATA_DIR" || erro "Nao foi possivel criar $DATA_DIR"

if docker ps -a --format '{{.Names}}' | grep -qx "$NOME"; then
  info "Removendo container anterior (os dados em $DATA_DIR sao preservados)"
  docker rm -f "$NOME" >/dev/null
fi

info "Baixando a imagem..."
if ! docker pull "$IMAGE"; then
  erro "Falha ao baixar a imagem.
       Se o pacote estiver privado no GitHub, faca login antes:
         echo SEU_TOKEN | docker login ghcr.io -u samuelnoia --password-stdin
       Ou torne o pacote publico: GitHub > seu perfil > Packages > orca3 > Package settings > Change visibility > Public"
fi

# ---------------------------------------------------------------- execucao
info "Subindo o container..."
docker run -d \
  --name "$NOME" \
  --restart unless-stopped \
  -p "${PORT}:3000" \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e DATA_DIR=/app/data \
  -e NODE_ENV=production \
  -e TZ="$TZ" \
  -e SEED="$SEED" \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -v "${DATA_DIR}:/app/data" \
  "$IMAGE" >/dev/null

# ---------------------------------------------------------------- espera
info "Aguardando a aplicacao responder..."
tentativas=0
while [ "$tentativas" -lt 40 ]; do
  if docker inspect --format '{{.State.Running}}' "$NOME" 2>/dev/null | grep -q true; then
    if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${PORT}/login" >/dev/null 2>&1; then
      break
    fi
    if ! command -v curl >/dev/null 2>&1 && command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "http://127.0.0.1:${PORT}/login" 2>/dev/null; then
      break
    fi
  fi
  tentativas=$((tentativas + 1))
  sleep 2
done

if ! docker inspect --format '{{.State.Running}}' "$NOME" 2>/dev/null | grep -q true; then
  echo ""
  erro "O container parou. Veja o log com:
       docker logs $NOME"
fi

IP_LOCAL=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "${IP_LOCAL:-}" ] || IP_LOCAL="IP-DO-SERVIDOR"

# se nao foi definida senha, pega a que o sistema gerou na primeira execucao
if [ -z "$ADMIN_PASSWORD" ] && [ -f "$DATA_DIR/PRIMEIRO_ACESSO.txt" ]; then
  ADMIN_PASSWORD=$(sed -n 's/^Senha:[[:space:]]*//p' "$DATA_DIR/PRIMEIRO_ACESSO.txt" | head -n 1)
fi
[ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD="(veja: docker logs $NOME)"

cat <<FIM

=====================================================================
  INSTALADO COM SUCESSO

  Acesse:   http://${IP_LOCAL}:${PORT}
  ou:       http://localhost:${PORT}

  E-mail:   ${ADMIN_EMAIL}
  Senha:    ${ADMIN_PASSWORD}

  Dados:    ${DATA_DIR}
  Backup:   copie essa pasta com o container parado.

  Comandos uteis:
    docker logs -f ${NOME}       acompanhar
    docker restart ${NOME}       reiniciar
    docker stop ${NOME}          parar

  TROQUE A SENHA no primeiro acesso (Usuarios > Administrador).
  Depois apague ${DATA_DIR}/PRIMEIRO_ACESSO.txt
=====================================================================
FIM
