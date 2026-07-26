# Ponto Renovar

Controle de jornada (ponto eletronico) da **Renovar Tech Ltda** - CNPJ 41.206.506/0001-39, Belo Horizonte/MG.
App web em React publicado pelo GitHub Pages, com Supabase (Postgres, Auth e Edge Function) no back-end.

App publicado: <https://cleitonfernandesceo-tech.github.io/ponto-renovar/>

O que ele faz, em resumo:

- Registro de ponto com confirmacao de identidade no proprio aparelho (Face ID / digital via WebAuthn), conferencia de geolocalizacao e assinatura validada no servidor antes de gravar a marcacao. A empresa nao recebe nem armazena face ou digital.
- Espelho de ponto mensal com aceite - ou apontamento de divergencia - do colaborador, e exportacao em PDF.
- Painel do gestor: banco de horas, folha de pagamento em PDF/CSV, rescisao, exames admissional e demissional, guias, LGPD, codigo de conduta (com aceite versionado) e termo de direito de imagem.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `ponto-renovar.jsx` | Fonte do app em JSX. **Toda alteracao comeca aqui.** |
| `index.html` | Arquivo que o GitHub Pages serve. O JS do app dentro dele e *gerado*, nao escrito a mao. |
| `build.mjs` | Compila o `.jsx` e reescreve o trecho gerado do `index.html`. |
| `testes.mjs` | Testes dos motores de calculo (jornada, banco de horas, folha, rescisao). |

## Como publicar uma alteracao

```bash
npm install --no-save esbuild @babel/core@7.24.7 @babel/preset-react@7.24.7

node testes.mjs                       # 1. os calculos continuam certos?
node build.mjs                        # 2. regenera o index.html a partir do .jsx
git commit -am "descreva a mudanca"   # 3. os dois arquivos vao no mesmo commit
```

Dentro do `index.html`, o `build.mjs` troca **apenas** o que esta entre os marcadores
`__APP_INICIO__` e `__APP_FIM__`. Cabecalho, CSS, `<noscript>`, o `<script>` do Supabase
e o bootstrap do final ficam fora dos marcadores e podem ser editados a mao.

## Verificacao automatica

O workflow `.github/workflows/verificar.yml` roda a cada push e pull request: executa
`testes.mjs` e depois `node build.mjs --check`, que falha se o `index.html` publicado
nao corresponder ao que o `ponto-renovar.jsx` gera. Quando falha, o `index.html` correto
fica anexado ao run como artefato (`index-html-gerado`).

## Banco de dados

As tabelas `consentimentos_imagem` (termo de imagem/CFTV) e `aceites` (espelho de ponto e
codigo de conduta) sao opcionais: se ainda nao existirem no Supabase, o app continua
funcionando normalmente e apenas nao persiste esses registros - o carregamento de cada uma
fica isolado em seu proprio tratamento de erro.

## Base legal

Registro eletronico de ponto conforme CLT art. 74 e Portaria MTP 671/2021; jornada, banco de
horas e intervalos conforme CLT arts. 58, 59 e 71; ferias conforme CLT arts. 130, 134 e 135;
tratamento de dados pessoais conforme a LGPD (Lei 13.709/2018). O app e uma ferramenta de
apoio: nao substitui a conferencia do contador nem a homologacao/fiscalizacao trabalhista.
