# Central de Orçamentos — Z Materiais

Plataforma para montar orçamentos a partir das planilhas de vários fornecedores e
gerar a planilha editável no layout da Z Materiais, pronta para impressão.

Roda **no seu computador ou em um servidor**, com **SQLite** (um único arquivo de
banco) e **zero dependências externas** — não há `npm install`.

---

## Início rápido

### Com Docker (recomendado para servidor)

```bash
docker compose up -d --build
```

Abre em `http://localhost:3088`. Os dados ficam em `./data` no computador que roda
o container.

> A porta publicada é a **3088**; dentro do container a aplicação continua na 3000.
> Para trocar a porta externa, altere apenas o lado esquerdo em `ports`
> (`"3088:3000"`).

```bash
docker compose logs -f      # acompanhar
docker compose down         # parar
docker compose up -d        # subir de novo
```

### GitHub + instalação em 1 comando (recomendado)

A imagem é construída pelo **GitHub Actions** — você **não precisa de Docker na sua
máquina**. É o caminho mais limpo para CasaOS/ZimaOS.

**1. Envie o projeto para um repositório**

Repositório deste projeto: <https://github.com/SamuelNoia/orca3>

Pela interface web (sem instalar nada): **Add file → Upload files**, arraste o
**conteúdo** da pasta `orca3-para-github` (não a pasta em si) e confirme.

Ou por linha de comando:

```bash
git init
git add .
git commit -m "Central de Orcamentos"
git branch -M main
git remote add origin https://github.com/SamuelNoia/orca3.git
git push -u origin main
```

**2. Espere o build**

O workflow `.github/workflows/publish.yml` roda sozinho e publica a imagem em
`ghcr.io/samuelnoia/orca3:latest`, para **amd64 e arm64**. Acompanhe em
*Actions* no repositório (leva ~2 minutos).

**3. Torne o pacote público**

O GitHub cria o pacote como **privado**. O CasaOS não consegue baixar pacote
privado sem login, então:

> GitHub → seu perfil → **Packages** → `orca3` → **Package settings** →
> **Change visibility** → **Public**

**4. No servidor, um comando**

```bash
curl -fsSL https://raw.githubusercontent.com/SamuelNoia/orca3/main/instalar.sh | sh
```

Isso baixa a imagem, cria a pasta de dados, sobe o container na porta **3088** e
mostra as credenciais. Rodar de novo **atualiza** a imagem mantendo os dados.

Sem `curl`: copie o `instalar.sh` para o servidor e rode `sh instalar.sh`.

Personalizando:

```bash
PORT=4000 ADMIN_PASSWORD=MinhaSenha123 sh instalar.sh
```

Ou, no CasaOS: importe o `docker-compose.ghcr.yml`, que já aponta para
`ghcr.io/samuelnoia/orca3:latest`.

> **Pacote privado?** Faça login antes de subir:
> `echo TOKEN | docker login ghcr.io -u samuelnoia --password-stdin`

### CasaOS / ZimaOS sem GitHub (alternativa)

Use esta opção apenas se **não** quiser publicar a imagem no GitHub.

**Use o arquivo `docker-compose.casaos.yml`, não o `docker-compose.yml`.**

O motivo: o CasaOS **não executa `build:`** — ele só baixa imagens prontas de um
registry. O `docker-compose.yml` tem `image: zmateriais/orcamentos:1.0` + `build:`,
que funciona com `docker compose up --build` numa máquina com Docker, mas essa
imagem nunca foi publicada. Ao importar no CasaOS aparece:

> *Falha ao baixar a imagem: repositório não existe*

A variante `docker-compose.casaos.yml` resolve isso usando a imagem oficial
**`node:24-alpine`** (que existe no Docker Hub) e montando o código do projeto como
volume — sem construir imagem e sem publicar em registry.

**Passo a passo**

1. Copie `pacote-casaos.zip` para o servidor e descompacte em:

   ```
   /DATA/AppData/orcamentos/app
   ```

   Deve ficar assim: `/DATA/AppData/orcamentos/app/server.js`, `app/src/`,
   `app/public/`, `app/tools/`.

   Formas de copiar: app **Arquivos** do CasaOS (upload do .zip e extrair),
   compartilhamento SMB, ou `scp pacote-casaos.zip usuario@zima.local:/tmp/`.

2. No CasaOS: **Apps → + → Importar / Colar YAML** e cole o conteúdo de
   `docker-compose.casaos.yml`.

3. Acesse `http://zima.local:3088` (ou `http://IP-do-servidor:3088`).

Na primeira execução o container cria `/DATA/AppData/orcamentos/data/orcamentos.db`
com a base zerada e o produto de teste. Se a pasta `app` estiver vazia, o container
**não entra em loop de erro**: ele fica parado e escreve no log as instruções.

Para regerar o pacote depois de qualquer alteração:

```bash
node tools/gerar-pacote.js
```

> **Alternativa:** se preferir uma imagem própria, construa no servidor via SSH
> (`docker build -t zmateriais/orcamentos:1.0 .`) ou publique no Docker Hub/GHCR e
> aí sim use o `docker-compose.yml` original.

### No Windows, sem Docker

Dê duplo clique em **`iniciar.cmd`**. O navegador abre em `http://127.0.0.1:3000`.

> **Requisito:** Node.js 22.5 ou superior. O `iniciar.cmd` procura o Node instalado,
> um `runtime\node.exe` na pasta do projeto, ou o runtime já presente na máquina.
> Se não achar, instale a versão LTS em <https://nodejs.org>.

Manualmente:

```bat
node server.js
set PORT=3001 && node server.js     :: outra porta
```

### Primeiro acesso

| Campo | Valor padrão |
|---|---|
| E-mail | `admin@zmateriais.com.br` |
| Senha  | `admin123` |

Essas credenciais vêm das variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD` (no
`docker-compose.yml` ou no ambiente). **Troque a senha** em *Usuários →
Administrador* no primeiro uso. Se o arquivo `data/PRIMEIRO_ACESSO.txt` existir,
ele tem as credenciais criadas.

---

## A base começa zerada

Por padrão a instalação nova vem **limpa**, só com:

- fornecedor **Fornecedor Exemplo** (marcado como emitente);
- **1 produto de teste** — `PRODUTO TESTE - CABO FLEXÍVEL 2,5 MM`.

Nenhum cliente, projeto ou orçamento. A ideia é você validar o fluxo com esse
produto e depois cadastrar os seus dados reais.

Para recarregar esse estado:

```bash
npm run seed:reset          # ou: node tools/seed-inicial.js --force
```

Para carregar a base de demonstração completa (as 3 escolas da ISACI, a partir da
planilha original):

```bash
node tools/seed-demo.js "C:\caminho\ORCAMENTO_CONSOLIDADO_ZMATERIAIS_ISACI_FINAL.xlsx"
```

No Docker, defina `SEED` no `docker-compose.yml`:

| `SEED` | Resultado |
|---|---|
| `inicial` (padrão) | base zerada + 1 produto de teste |
| `none` | base totalmente vazia |
| `demo` | carrega de `/app/data/demo.xlsx` (precisa do arquivo no volume) |

O `SEED` só age **quando o banco ainda não existe**. Depois disso, os dados são
sempre preservados.

---

## Planilha modelo para os fornecedores

Para não explicar o formato a cada fornecedor, entregue o modelo pronto.

**Pelo sistema:** em *Fornecedores → Enviar planilha*, botão **“Baixar planilha
modelo”** — ou direto em `/modelo-importacao.xlsx`.

**Como arquivo:** `modelo_importacao_produtos.xlsx` (e `.csv`) já estão prontos na
raiz do projeto. Para regerar:

```bash
npm run modelo              # node tools/gerar-modelo.js
```

O modelo tem duas abas:

- **PRODUTOS** — cabeçalho com as 10 colunas e 6 linhas de exemplo;
- **INSTRUCOES** — explica campo por campo o que preencher e as regras.

Colunas: `Código`, `Descrição`, `Valor Unitário`, `Marca`, `Estoque`,
`Código Fabricante`, `Código de Barras (EAN)`, `Referência`, `NCM`, `Unidade`.

A ordem das colunas não importa — o sistema procura pelo nome do cabeçalho.

---

## O fluxo de trabalho

```
Fornecedores → enviar planilha → catálogo de produtos
                                        ↓
Clientes → Projeto → Orçamento → itens + margem + despesas → planilha XLSX
```

### 1. Fornecedores e catálogo

Em **Fornecedores → Novo fornecedor** cadastre cada empresa que manda preço.
Marque como **“empresa emitente”** aquela que assina a proposta (a Z Materiais).

Em **Enviar planilha** você anexa o arquivo do fornecedor. O sistema:

- lê `.xlsx` e `.csv`;
- **descobre sozinho a linha de cabeçalho** e qual coluna é qual;
- mostra uma tela de conferência com o mapeamento e uma amostra dos dados;
- deixa você corrigir o mapeamento se o layout for diferente;
- grava o mapeamento para reaproveitar no próximo envio.

Cada fornecedor tem o **seu próprio catálogo** — sistemas e layouts diferentes não
são problema.

Dois modos: **atualizar** (mantém o que existe e atualiza preços) ou
**substituir** todo o catálogo.

### 2. Comparação entre fornecedores

Ao adicionar um produto ao orçamento, o sistema procura o **mesmo item nos outros
fornecedores** (por EAN, código do fabricante ou referência) e monta as ofertas.

- Na coluna **Fornecedor** aparece um seletor com o preço de cada um;
- o mais barato é marcado como **“melhor”** e a diferença aparece em reais;
- trocar o fornecedor **troca o custo do item** automaticamente;
- o botão **Comparativo** gera uma planilha com todos lado a lado, menor preço por
  item, economia e total por fornecedor.

### 3. Orçamento

| Parâmetro | O que faz |
|---|---|
| **Margem (%)** | acréscimo sobre o custo |
| **Forma de cálculo** | *markup* (custo × (1+m)) ou *margem sobre a venda* (custo ÷ (1−m)) |
| **Serviço de instalação (%)** | percentual sobre o total de produtos (0 = sem serviço) |
| **Arredondar preço** | sobe o preço para o próximo múltiplo (ex.: R$ 0,10) |
| **Validade** | dias, usado no texto da proposta |

**Outras despesas** entram como percentual ou valor fixo, e podem incidir sobre
*produtos*, *serviços* ou o *total acumulado*. Valor negativo funciona como desconto.

O painel lateral mostra em tempo real: custo, produtos, serviços, despesas, total,
**lucro bruto**, **margem efetiva** e **markup real**.

Há também **Duplicar**, para criar o orçamento da próxima escola a partir de um
já pronto.

### 4. Planilha gerada

**Gerar planilha** produz um `.xlsx` com **fórmulas reais**, editável:

- aba **CUSTOS** — preços base (interna), com fornecedor e marca;
- uma aba por orçamento — cabeçalho do fornecedor e do cliente, campo de reajuste
  em `D7`, itens com `=CUSTOS!E4*(1+$D$7)`, serviço, despesas e total;
- aba **RESUMO CONSOLIDADO** quando há mais de um orçamento.

As cores, fontes, larguras, mesclagens e formatos seguem o arquivo
`ORCAMENTO_CONSOLIDADO_ZMATERIAIS_ISACI_FINAL.xlsx`. Há um exemplo do resultado em
`exemplo_gerado.xlsx`.

**Consolidado do projeto:** em *Projetos → Planilha consolidada*, todas as unidades
saem em um único arquivo, como no modelo.

**Imprimir** abre uma versão limpa para papel.

---

## Backup

Tudo está na pasta `data/` (ou no volume Docker). Copie `orcamentos.db` com o
sistema parado — é o backup completo: clientes, fornecedores, catálogos e
orçamentos.

```bash
docker compose stop
cp data/orcamentos.db data/backup-$(date +%F).db
docker compose start
```

---

## Segurança

- Senhas com **scrypt** e salt individual.
- Sessão em cookie `HttpOnly` + `SameSite=Lax`, validade de 7 dias.
- **Proteção CSRF** em todos os formulários.
- Perfis: usuário comum não vê *Usuários* nem *Configurações*.
- Bloqueio após 8 tentativas de login erradas.
- Localmente o servidor escuta só em `127.0.0.1`; no Docker escuta em `0.0.0.0`.

Ao expor na rede, use **HTTPS** (proxy reverso) e **troque a senha padrão**. A
senha do `docker-compose.yml` é texto puro — trate como segredo.

---

## Estrutura

```
orcamentos/
├── iniciar.cmd                     inicia no Windows
├── instalar.sh                     instala em 1 comando a partir do GHCR
├── Dockerfile                      imagem de produção
├── docker-compose.yml              build local + volume de dados
├── docker-compose.ghcr.yml         usa a imagem pronta do GitHub
├── docker-compose.casaos.yml       variante sem registry (monta o código)
├── pacote-casaos.zip               código pronto para copiar ao servidor
├── .github/workflows/publish.yml   build e push automático para o GHCR
├── docker/entrypoint.sh            prepara o banco na 1ª execução
├── server.js                       servidor HTTP
├── modelo_importacao_produtos.xlsx planilha modelo (e .csv)
├── exemplo_gerado.xlsx             exemplo da planilha produzida
├── data/orcamentos.db              banco SQLite
├── public/                         CSS e JS da interface
├── src/
│   ├── db.js                       schema e acesso ao SQLite
│   ├── auth.js                     senhas, sessões, CSRF
│   ├── web.js                      rotas, cookies, formulários, upload
│   ├── xlsx.js                     leitor/gerador de XLSX próprio (ZIP + XML)
│   ├── modelo.js                   planilha modelo para fornecedores
│   ├── importer.js                 detecção de colunas e importação
│   ├── calc.js                     motor de margem, despesas e serviço
│   ├── exporter.js                 planilha no layout Z Materiais
│   ├── repo.js                     consultas de dados
│   ├── ui.js                       componentes de tela
│   └── routes/                     telas: auth, admin, catalog, quotes
└── tools/
    ├── seed-inicial.js             base zerada + 1 produto de teste
    ├── seed-demo.js                carrega as 3 escolas da ISACI
    ├── gerar-modelo.js             gera a planilha modelo
    ├── gerar-pacote.js             gera o pacote-casaos.zip
    └── selftest.js                 teste de ponta a ponta (86 verificações)
```

## Testes

```bash
node tools/selftest.js
```

Sobe uma instância isolada com banco temporário e cobre login, cadastros, dois
layouts de planilha diferentes, planilha modelo (ida e volta), orçamento,
comparativo, exportação, consolidado, permissões e estrutura das páginas.
