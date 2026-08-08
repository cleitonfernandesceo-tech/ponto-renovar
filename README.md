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

### Atalhos e lembretes

O `manifest.json` declara atalhos (segurar o icone do app): *Bater ponto*, *Espelho* e *Banco*.
Cada atalho abre `./?ir=<tela>`; as telas aceitas estao em `TELAS_ATALHO` no `.jsx`.

Os lembretes de batida aparecem como aviso do sistema. No iPhone o construtor
`new Notification()` nao funciona nem com o app instalado, entao o aviso e sempre
pedido ao service worker (`registration.showNotification`) e o construtor fica
apenas como reserva no desktop. Tocar no aviso foca a aba do app ou abre uma nova.
Os lembretes continuam dependendo do app aberto ou recem-usado - **nao ha push de servidor.**

## Agenda do RH (painel do gestor)

Cartao de leitura que calcula prazos a partir do que ja esta cadastrado:
exame admissional/periodico (CLT 168 e NR-7), ferias dentro do periodo
concessivo (CLT 134, com a dobra do 137), aviso de ferias de 30 dias (CLT 135)
e o limite de 90 dias do contrato de experiencia (CLT 445/451).

A funcao `agendaRH` e pura (recebe listas + data e devolve itens ordenados),
fica no bloco de motores do `.jsx` e tem teste unitario no `testes.mjs`.
Janela padrao: `AGENDA_JANELA_DIAS` = 120 dias. No maximo 2 periodos de ferias
atrasados por pessoa, pra lista nao virar rolagem infinita.
Gestor e inativos ficam fora. O cartao nao grava nada.

## RH: recrutamento, documentos e exames (painel do gestor)

Tres cartoes que fecham o ciclo da contratacao:

- **Recrutamento e curriculos**: cadastra o candidato, guarda o curriculo,
  move ele pelas etapas (`STATUS_CANDIDATO`) e, no botao Contratar, cria o
  CONVITE ja preenchido. O app nunca cria conta nem guarda senha: a pessoa
  usa o convite e escolhe a propria senha.
- **Documentos e pasta de admissao**: guarda documento por colaborador e
  mostra o checklist de `DOCS_ADMISSAO` (identidade, CPF, CTPS, residencia,
  contrato) mais o exame admissional. Diz o que falta, nao bloqueia nada.
- **Exames ocupacionais**: separa AGENDAR (data prevista, `status` agendado)
  de LANCAR RESULTADO (data real, resultado e ASO anexado). O agendado
  alimenta a Agenda do RH; o realizado zera o prazo do periodico.

Arquivo fica no bucket privado `anexos`. Pra abrir, o app pede uma URL
assinada de 120 segundos (`sbUrlAssinada`) — nada de link publico. Candidato
nao tem login, entao o arquivo dele fica na pasta do gestor que subiu.

## Contabilidade: custo real da equipe

`custoDaEquipe(folhas, regime)` e uma funcao pura no bloco de motores, com
teste unitario. Ela mostra o que o holerite esconde:

- encargos por fora do bruto: FGTS 8% e, fora do Simples, INSS patronal 20%,
  RAT e terceiros;
- provisao mensal de 13o (1/12), ferias (1/12) e o terco (1/36), com os
  encargos dessas provisoes;
- custo de caixa do mes e custo total.

O regime e escolhido na tela (`REGIMES_EMPRESA`) porque muda tudo: no Simples
Nacional a parte patronal do INSS ja esta dentro do DAS, e somar 20% ali
inventaria um custo que a empresa nao tem. Padrao: Simples.

As guias nascem quando a folha da competencia e fechada. O app NAO paga guia
e NAO emite codigo de barras: o pagamento acontece no banco ou com a
contabilidade, e aqui fica a prova (data, valor pago e comprovante anexado).
O resumo da competencia sai em CSV pro contador.

## Rede de seguranca (sem tela branca)

O `App` exportado e apenas uma casca: ele devolve `<RedeDeSeguranca><AppInterno /></RedeDeSeguranca>`.
`RedeDeSeguranca` e um error boundary de verdade (classe com `getDerivedStateFromError`
e `componentDidCatch`). Se qualquer tela quebrar na montagem, aparece um cartao com
*Recarregar o app* e *Copiar detalhes* em vez da tela branca.

O detalhe copiado leva data, versao do app e o `Nome - mensagem` do erro. Nada sai do
aparelho: a rede de seguranca nao faz `fetch` nem grava no banco.
Quem mexer no `.jsx` deve manter **um unico** `export default function App` - o
`build.mjs` conta essa ocorrencia e o `testes.mjs` reprova se mudar.

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
create table if not exists public.candidatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text,
  telefone text,
  cargo text,
  origem text,
  status text not null default 'recebido',
  curriculo_url text,
  observacao text,
  contratado_usuario_id uuid references public.usuarios (id) on delete set null,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.documentos_rh (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios (id) on delete cascade,
  candidato_id uuid references public.candidatos (id) on delete cascade,
  tipo text not null,
  arquivo_url text not null,
  nome_original text,
  observacao text,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint documentos_rh_tem_dono check (usuario_id is not null or candidato_id is not null)
);

-- Exame agendado (data prevista) x exame realizado (data e resultado).
alter table public.exames_ocupacionais add column if not exists status text not null default 'realizado';
alter table public.exames_ocupacionais add column if not exists data_prevista date;

-- Pagamento da guia: data, valor pago e comprovante guardado.
alter table public.guias_fiscais add column if not exists pago_em date;
alter table public.guias_fiscais add column if not exists valor_pago numeric(12,2);
alter table public.guias_fiscais add column if not exists comprovante_url text;
alter table public.guias_fiscais add column if not exists observacao text;
alter table public.guias_fiscais add column if not exists linha_digitavel text;

alter table public.candidatos enable row level security;
alter table public.documentos_rh enable row level security;

-- Recrutamento e documentos sao do gestor; o colaborador le os proprios documentos.
drop policy if exists "candidatos: gestor cuida" on public.candidatos;
create policy "candidatos: gestor cuida" on public.candidatos
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

drop policy if exists "documentos: gestor cuida" on public.documentos_rh;
create policy "documentos: gestor cuida" on public.documentos_rh
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

drop policy if exists "documentos: dono le o proprio" on public.documentos_rh;
create policy "documentos: dono le o proprio" on public.documentos_rh
  for select to authenticated using (usuario_id = auth.uid());

-- Combinados das reunioes: o que ficou acordado, com dono e prazo.
-- Sem esta tabela o combinado fica so no aparelho de quem escreveu.
create table if not exists public.combinados (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  dono_id uuid references public.usuarios (id) on delete set null,
  dono_nome text,
  prazo date,
  origem text,
  feito boolean not null default false,
  feito_em timestamptz,
  criado_por uuid not null references public.usuarios (id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index if not exists combinados_abertos_idx on public.combinados (feito, prazo);
alter table public.combinados enable row level security;

-- Combinado de reuniao e assunto do time inteiro: todos leem, todos registram.
drop policy if exists "combinados: o time le" on public.combinados;
create policy "combinados: o time le" on public.combinados
  for select to authenticated using (true);

drop policy if exists "combinados: o time registra" on public.combinados;
create policy "combinados: o time registra" on public.combinados
  for insert to authenticated with check (criado_por = auth.uid());

-- Concluir e do dono, de quem registrou ou do gestor - nao de qualquer um.
drop policy if exists "combinados: dono conclui" on public.combinados;
create policy "combinados: dono conclui" on public.combinados
  for update to authenticated
  using (dono_id = auth.uid() or criado_por = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (dono_id = auth.uid() or criado_por = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Ajuste do time em chave/valor. Hoje guarda so 'sala_video', o link fixo da
-- videochamada: o gestor grava uma vez e o time inteiro passa a enxergar.
create table if not exists public.config_time (
  chave text primary key,
  valor text,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table public.config_time enable row level security;

drop policy if exists "config: o time le" on public.config_time;
create policy "config: o time le" on public.config_time
  for select to authenticated using (true);

drop policy if exists "config: gestor cuida" on public.config_time;
create policy "config: gestor cuida" on public.config_time
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));
```

## Push de servidor (lembrete com o app fechado)

O lembrete de batida chega como aviso do celular mesmo com o app fechado.
Quem dispara e uma Edge Function no Supabase - nao o navegador. As pecas:

| Peca | Onde | Papel |
| --- | --- | --- |
| `push` + `showNotification` | `sw.js` | exibe o aviso que vem do servidor (no iPhone so o service worker consegue) |
| `VAPID_PUBLICA` e `registrarPush()` | `ponto-renovar.jsx` | inscreve o aparelho e grava a inscricao em `push_inscricoes` |
| `lembretes-push` | Edge Function | decide quem esta devendo batida e assina o envio com a chave VAPID |
| `cron.schedule('lembretes-push')` | banco (pg_cron + pg_net) | chama a funcao as 8h, 9h, 12h e 13h de Brasilia |
| `push_lembretes_log` | banco | trava de 1 aviso por pessoa/dia/etapa (o cron pode repetir sem risco) |

Regras espelhadas do app: 8h e 9h sem nenhuma batida, 12h com 1 batida e 13h
com 2 batidas (almoco so de segunda a sexta). Domingo e feriado nacional nao
geram aviso. Aparelho que desinstalou o app devolve 404/410 e a inscricao e
apagada sozinha.

### Segredos (Edge Functions > Secrets)

- `VAPID_PUBLIC_KEY` - a mesma chave que esta em `VAPID_PUBLICA` no app (publica).
- `VAPID_PRIVATE_KEY` - **segredo**: nunca vai pro repositorio.
- `VAPID_SUBJECT` - opcional, um `mailto:` de contato.

Para trocar o par de chaves: gere um novo par (P-256), atualize o segredo e a
constante `VAPID_PUBLICA`. O app compara a chave da inscricao com a do codigo e
reinscreve o aparelho sozinho quando elas diferem.

### Tabelas e agendamento (SQL)

```sql
-- inscricoes dos aparelhos + trava de 1 aviso por etapa/dia
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  aparelho text,
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  falhas int not null default 0
);
create index if not exists push_inscricoes_usuario_idx on public.push_inscricoes (usuario_id);
alter table public.push_inscricoes enable row level security;
create policy push_inscricoes_select on public.push_inscricoes for select to authenticated using (auth.uid() = usuario_id);
create policy push_inscricoes_insert on public.push_inscricoes for insert to authenticated with check (auth.uid() = usuario_id);
create policy push_inscricoes_update on public.push_inscricoes for update to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
create policy push_inscricoes_delete on public.push_inscricoes for delete to authenticated using (auth.uid() = usuario_id);

create table if not exists public.push_lembretes_log (
  usuario_id uuid not null,
  dia date not null,
  etapa text not null,
  enviado_em timestamptz not null default now(),
  aparelhos int not null default 0,
  primary key (usuario_id, dia, etapa)
);
alter table public.push_lembretes_log enable row level security;
create policy push_lembretes_log_select on public.push_lembretes_log for select to authenticated using (auth.uid() = usuario_id);

-- 8h, 9h, 12h e 13h de Brasilia = 11, 12, 15 e 16 UTC (duas passadas por hora).
-- A chave usada aqui e a PUBLICAVEL, a mesma que o index.html leva pro navegador.
select cron.schedule(
  'lembretes-push',
  '5,35 11,12,15,16 * * 1-6',
  $job$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/lembretes-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<CHAVE_PUBLICAVEL>',
      'Authorization', 'Bearer <CHAVE_PUBLICAVEL>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);
```

Teste rapido: com o app aberto e o aviso autorizado, chame a funcao com
`{ "teste": true }` usando o token do usuario logado - ela manda um aviso so
para os aparelhos daquela pessoa.

## Rituais do time (reunioes, combinados e sala)

O calendario nao tem cadastro: ele e deterministico, calculado pelo `RITUAIS`
do `ponto-renovar.jsx` e espelhado na Edge Function.

| Ritual | Quando | Horario | Duracao |
| --- | --- | --- | --- |
| Planejamento da semana | toda segunda-feira | 09:15 | 45 min |
| Resolucao de problemas (3 Pilares) | segunda de semana ISO par | 14:00 | 60 min |
| Retrospectiva do mes | ultima sexta do mes | 15:00 | 60 min |

Cada reuniao avisa **duas vezes**: ao bater a saida no dia anterior e ao bater a
entrada no dia. Os dois avisos dizem o ritual, o horario, a duracao e a pauta
prevista. Com o app aberto o aviso e um cartao na tela; com o app fechado quem
manda e a Edge Function (secao abaixo).

Os **combinados** (o que ficou acordado, com dono e prazo) vao pra tabela
`combinados`: todo mundo do time le, e concluir e do dono, de quem registrou
ou do gestor. Enquanto a tabela nao existir o app guarda no proprio aparelho e
diz isso na tela, sem quebrar nada.

O **link da sala de videochamada** fica em `config_time`, na chave
`sala_video`: o gestor cola uma vez e o time inteiro passa a ver o mesmo link.
O app nao hospeda video, so abre o link (Meet, Jitsi, Zoom) em aba nova, porque
a CSP da pagina usa `frame-src 'none'`.

O **check-in de energia** (nota de 1 a 10 pro proprio animo) NAO vai pro banco,
de proposito: e dado sensivel, fica so no aparelho de quem escreveu e nunca
aparece pro gestor. O mesmo vale pras respostas das tres perguntas.

### Aviso de reuniao com o app fechado

O codigo da funcao mora em `supabase/functions/lembretes-push/index.ts` - e a
copia versionada do que roda no Supabase (o `build.mjs` nao mexe nesse arquivo).
Depois de editar, publique com:

    supabase functions deploy lembretes-push

O agendamento reaproveita a trava `push_lembretes_log` (chave usuario/dia/etapa),
entao ninguem recebe o mesmo aviso duas vezes nem que o cron repita:

```sql
-- Fim da tarde (16h-20h de Brasilia = 19-23 UTC): "antes de ir, tem reuniao..."
select cron.schedule(
  'reuniao-push-saida',
  '10 19,20,21,22,23 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/lembretes-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<CHAVE_PUBLICAVEL>',
      'Authorization', 'Bearer <CHAVE_PUBLICAVEL>'
    ),
    body := '{"etapa":"reuniao_saida"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);

-- Comeco do dia (6h-9h de Brasilia = 9-12 UTC): "hoje tem reuniao as..."
select cron.schedule(
  'reuniao-push-chegada',
  '10 9,10,11,12 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/lembretes-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<CHAVE_PUBLICAVEL>',
      'Authorization', 'Bearer <CHAVE_PUBLICAVEL>'
    ),
    body := '{"etapa":"reuniao_chegada"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);
```

Domingo e feriado nacional nao avisam. O aviso de saida procura quem ja bateu a
saida e, a partir das 19h, vai pra todo mundo; o de chegada faz o mesmo com a
entrada, liberando geral as 9h. Quem nao tem aparelho inscrito no push nao
entra na lista - o cartao na tela continua valendo.
