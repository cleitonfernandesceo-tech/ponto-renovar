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
| `testes.mjs` | Testes dos motores de calculo (jornada, banco de horas, folha, rescisao) e dos arquivos do PWA. |
| `manifest.json` | Faz o app ser instalavel no celular (nome, cor, icones, abre em janela propria). |
| `sw.js` | Service worker: guarda o casco do app pra abrir com internet ruim. **Nao guarda dado nenhum do Supabase.** |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Icones do atalho na tela inicial. |

## Instalar no celular (PWA)

O app pode ficar como atalho na tela inicial e abrir sem barra de navegador.

- **Android/Chrome:** aparece a faixa *Instalar* no rodape.
- **iPhone/Safari:** botao Compartilhar -> *Adicionar a Tela de Inicio* (o app mostra o lembrete).

O `sw.js` guarda somente `index.html`, o React do unpkg, o `manifest.json` e os icones.
Chamadas ao Supabase (login, biometria, batidas, folha) **nunca** passam pelo cache.
O `index.html` usa *rede primeiro*: quem tem internet ve sempre a versao mais nova.

Ao mexer no `sw.js`, suba a `VERSAO` nele **e** o `window.__APP_VERSAO` no `index.html`
(os dois precisam bater; o `testes.mjs` reprova se ficarem diferentes).

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

## Tabelas opcionais (SQL)

O app funciona sem estas duas tabelas, mas o **termo de imagem/CFTV** e os **aceites**
(codigo de conduta e espelho mensal) so ficam gravados no banco depois de criar as duas.
O proprio app avisa: *Painel do gestor -> Diagnostico do sistema* mostra o que falta e
tem o botao **Copiar SQL**. O mesmo conteudo esta abaixo - rode uma vez no SQL Editor do Supabase.

```sql
-- Ponto Renovar · tabelas opcionais (rode uma vez no SQL Editor do Supabase)
-- Sem elas o app funciona, mas termo de imagem e aceites não ficam gravados.

create table if not exists public.consentimentos_imagem (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  cftv_ciente boolean not null default false,
  imagem_autorizada boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.aceites (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  tipo text not null,
  referencia text not null,
  status text not null,
  observacao text,
  criado_em timestamptz not null default now(),
  unique (usuario_id, tipo, referencia)
);

alter table public.consentimentos_imagem enable row level security;
alter table public.aceites enable row level security;

-- Cada colaborador cuida do que é dele; o gestor apenas lê.
drop policy if exists "imagem: dono cuida" on public.consentimentos_imagem;
create policy "imagem: dono cuida" on public.consentimentos_imagem
  for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "imagem: gestor le" on public.consentimentos_imagem;
create policy "imagem: gestor le" on public.consentimentos_imagem
  for select to authenticated using (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

drop policy if exists "aceites: dono cuida" on public.aceites;
create policy "aceites: dono cuida" on public.aceites
  for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "aceites: gestor le" on public.aceites;
create policy "aceites: gestor le" on public.aceites
  for select to authenticated using (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));
```
