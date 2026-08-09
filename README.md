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

### Corrigir uma marcacao

Esquecer de bater o ponto acontece. Antes, quando acontecia, o espelho ficava
errado pra sempre: o app nao tinha nenhum caminho de correcao.

Agora, no **Espelho de ponto**, cada dia tem o botao **Pedir correcao**. O
colaborador escolhe o que houve - faltou uma marcacao, o horario esta errado ou
a batida nao deveria existir -, informa o horario certo e escreve o motivo
(minimo 10 caracteres). O pedido cai na fila **Correcoes de ponto** do painel do
gestor, que aprova ou recusa; pra recusar, a resposta ao colaborador e
obrigatoria. Cada pedido e cada decisao entram na trilha de auditoria.

O ponto importante: **a marcacao original nunca e alterada nem apagada.** Ela
continua no banco exatamente como o coletor gravou e e ela que sai no AFD
(Portaria MTP 671/2021). O que a aprovacao muda e a *jornada tratada* - espelho,
banco de horas, premio, folha e AEJ -, montada aplicando os ajustes aprovados por
cima dos registros brutos. No espelho, o horario corrigido aparece com `*` e o
horario original continua guardado em `tsOriginal`.

Precisa da tabela opcional `ajustes_ponto` (SQL em *Painel do gestor ->
Diagnostico do sistema -> Copiar SQL*). Sem ela o app roda igual, so que sem o
caminho de correcao.

## Base legal

Registro eletronico de ponto conforme CLT art. 74 e Portaria MTP 671/2021; jornada, banco de
horas e intervalos conforme CLT arts. 58, 59 e 71; ferias conforme CLT arts. 130, 134 e 135;
tratamento de dados pessoais conforme a LGPD (Lei 13.709/2018). O app e uma ferramenta de
apoio: nao substitui a conferencia do contador nem a homologacao/fiscalizacao trabalhista.

## Tabelas opcionais (SQL)

O app funciona sem estas tabelas, mas o **termo de imagem/CFTV** e os **aceites**
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

-- Ajuste do time em chave/valor. Guarda os enderecos das salas de videochamada
-- ('sala_video' e o geral, 'sala_semanal', 'sala_quinzenal' e 'sala_mensal' sao
-- por ritual) e 'sala_semente', usada so para sugerir um endereco dificil de
-- adivinhar. O gestor grava uma vez e o time inteiro passa a enxergar.
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

-- Mural de conquistas: vitoria e superacao contadas em voz alta pro time.
-- Nada daqui vira ponto de premio: reconhecimento com nota vira meta.
create table if not exists public.conquistas (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  tipo text not null default 'vitoria',
  autor_id uuid not null references public.usuarios (id) on delete cascade,
  autor_nome text,
  criado_em timestamptz not null default now(),
  constraint conquistas_tipo_valido check (tipo in ('vitoria', 'superacao'))
);
create index if not exists conquistas_recentes_idx on public.conquistas (criado_em desc);
alter table public.conquistas enable row level security;

drop policy if exists "conquistas: o time le" on public.conquistas;
create policy "conquistas: o time le" on public.conquistas
  for select to authenticated using (true);

drop policy if exists "conquistas: cada um conta a sua" on public.conquistas;
create policy "conquistas: cada um conta a sua" on public.conquistas
  for insert to authenticated with check (autor_id = auth.uid());

drop policy if exists "conquistas: autor corrige" on public.conquistas;
create policy "conquistas: autor corrige" on public.conquistas
  for update to authenticated using (autor_id = auth.uid()) with check (autor_id = auth.uid());

-- Circulo de elogios: quem agradece assina o que escreveu e ninguem elogia a
-- si mesmo - por isso o check compara de_id com para_id.
create table if not exists public.elogios (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  de_id uuid not null references public.usuarios (id) on delete cascade,
  de_nome text,
  para_id uuid not null references public.usuarios (id) on delete cascade,
  para_nome text,
  origem text,
  criado_em timestamptz not null default now(),
  constraint elogios_nao_e_pra_si check (de_id <> para_id)
);
create index if not exists elogios_recentes_idx on public.elogios (criado_em desc);
alter table public.elogios enable row level security;

drop policy if exists "elogios: o time le" on public.elogios;
create policy "elogios: o time le" on public.elogios
  for select to authenticated using (true);

drop policy if exists "elogios: quem elogia assina" on public.elogios;
create policy "elogios: quem elogia assina" on public.elogios
  for insert to authenticated with check (de_id = auth.uid() and de_id <> para_id);

-- O que me motiva: tres fatores escritos pela propria pessoa pra conversar com
-- a lideranca. So existe linha aqui se ela apertou compartilhar.
create table if not exists public.motivadores (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  nome text,
  fator_1 text,
  fator_2 text,
  fator_3 text,
  atualizado_em timestamptz not null default now()
);
alter table public.motivadores enable row level security;

drop policy if exists "motivadores: dono cuida" on public.motivadores;
create policy "motivadores: dono cuida" on public.motivadores
  for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "motivadores: gestor le" on public.motivadores;
create policy "motivadores: gestor le" on public.motivadores
  for select to authenticated using (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Dinamica do anjo: o gestor abre a rodada e o app sorteia os pares.
create table if not exists public.anjo_rodada (
  id uuid primary key default gen_random_uuid(),
  inicio date not null,
  fim date not null,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint anjo_rodada_periodo check (fim >= inicio)
);
alter table public.anjo_rodada enable row level security;

drop policy if exists "anjo rodada: o time le" on public.anjo_rodada;
create policy "anjo rodada: o time le" on public.anjo_rodada
  for select to authenticated using (true);

drop policy if exists "anjo rodada: gestor abre" on public.anjo_rodada;
create policy "anjo rodada: gestor abre" on public.anjo_rodada
  for insert to authenticated with check (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- O par so pode ser lido pelo proprio anjo: e o banco que guarda o segredo, e
-- nao a tela. Depois do sorteio nem o gestor consulta o par dos outros.
create table if not exists public.anjo_par (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null references public.anjo_rodada (id) on delete cascade,
  anjo_id uuid not null references public.usuarios (id) on delete cascade,
  protegido_id uuid not null references public.usuarios (id) on delete cascade,
  protegido_nome text,
  criado_em timestamptz not null default now(),
  unique (rodada_id, anjo_id),
  constraint anjo_par_nao_e_de_si check (anjo_id <> protegido_id)
);
alter table public.anjo_par enable row level security;

drop policy if exists "anjo par: so o proprio anjo le" on public.anjo_par;
create policy "anjo par: so o proprio anjo le" on public.anjo_par
  for select to authenticated using (anjo_id = auth.uid());

drop policy if exists "anjo par: gestor sorteia" on public.anjo_par;
create policy "anjo par: gestor sorteia" on public.anjo_par
  for insert to authenticated with check (exists (
    select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));

-- Ata automatica da reuniao. O app monta sozinho ao encerrar o roteiro:
-- dia, ritual, quem estava trabalhando e os combinados que nasceram ali.
-- Nao e controle de presenca e nao existe "falta de reuniao" em lugar nenhum.
create table if not exists public.atas (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  ritual_id text not null,
  ritual_nome text,
  participantes jsonb not null default '[]'::jsonb,
  combinados jsonb not null default '[]'::jsonb,
  numeros jsonb,
  autor_id uuid not null references public.usuarios (id) on delete cascade,
  autor_nome text,
  criado_em timestamptz not null default now(),
  unique (data, ritual_id)
);
create index if not exists atas_data_idx on public.atas (data desc);
alter table public.atas enable row level security;

-- Ata e memoria do time inteiro: todos leem.
drop policy if exists "atas: o time le" on public.atas;
create policy "atas: o time le" on public.atas
  for select to authenticated using (true);

-- Quem esta na reuniao encerra e gera a ata.
drop policy if exists "atas: o time registra" on public.atas;
create policy "atas: o time registra" on public.atas
  for insert to authenticated with check (autor_id = auth.uid());

-- Corrigir a ata do dia e de quem gerou ou do gestor.
drop policy if exists "atas: autor ou gestor corrige" on public.atas;
create policy "atas: autor ou gestor corrige" on public.atas
  for update to authenticated
  using (autor_id = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (autor_id = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));
-- A ata tambem guarda o que cada um respondeu naquela reuniao. Separado do
-- create acima de proposito: quem ja rodou o bloco antes so precisa desta linha.
alter table public.atas add column if not exists respostas jsonb not null default '[]'::jsonb;

-- As tres perguntas do planejamento: o que entreguei, no que vou focar, onde
-- travei. Uma linha por pessoa por reuniao. Sem isto cada um so ve a propria
-- resposta no proprio aparelho e a reuniao volta a ser "conta o que voce fez".
-- A nota de energia NAO tem tabela e nao vai ter: animo e assunto do circulo.
create table if not exists public.respostas (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references public.usuarios (id) on delete cascade,
  autor_nome text,
  data date not null,
  ritual_id text not null,
  entreguei text,
  foco text,
  impedimento text,
  atualizado_em timestamptz not null default now(),
  unique (autor_id, data, ritual_id)
);
create index if not exists respostas_data_idx on public.respostas (data desc);
alter table public.respostas enable row level security;

-- O time le as respostas: e exatamente para isso que a reuniao existe.
drop policy if exists "respostas: o time le" on public.respostas;
create policy "respostas: o time le" on public.respostas
  for select to authenticated using (true);

-- Cada um responde por si. Ninguem responde no lugar do colega, nem o gestor.
drop policy if exists "respostas: cada um escreve a sua" on public.respostas;
create policy "respostas: cada um escreve a sua" on public.respostas
  for insert to authenticated with check (autor_id = auth.uid());

drop policy if exists "respostas: cada um corrige a sua" on public.respostas;
create policy "respostas: cada um corrige a sua" on public.respostas
  for update to authenticated
  using (autor_id = auth.uid()) with check (autor_id = auth.uid());

-- Quem esta na sala da chamada agora. Uma linha por pessoa por reuniao por dia,
-- reescrita a cada batida enquanto a aba do app fica aberta. Isto NAO e controle
-- de frequencia: linha sem batida recente some da tela sozinha e o app nunca
-- pergunta quem faltou na chamada. Serve so para ninguem cair em sala vazia.
create table if not exists public.presenca_chamada (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  nome text,
  dia date not null,
  ritual_id text not null,
  visto_em timestamptz not null default now(),
  unique (usuario_id, dia, ritual_id)
);
create index if not exists presenca_chamada_dia_idx on public.presenca_chamada (dia desc);
alter table public.presenca_chamada enable row level security;

-- O time inteiro le: a lista so tem utilidade se todo mundo enxergar quem entrou.
drop policy if exists "presenca: o time le" on public.presenca_chamada;
create policy "presenca: o time le" on public.presenca_chamada
  for select to authenticated using (true);

drop policy if exists "presenca: cada um bate a sua" on public.presenca_chamada;
create policy "presenca: cada um bate a sua" on public.presenca_chamada
  for insert to authenticated with check (usuario_id = auth.uid());

drop policy if exists "presenca: cada um atualiza a sua" on public.presenca_chamada;
create policy "presenca: cada um atualiza a sua" on public.presenca_chamada
  for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "presenca: cada um apaga a sua" on public.presenca_chamada;
create policy "presenca: cada um apaga a sua" on public.presenca_chamada
  for delete to authenticated using (usuario_id = auth.uid());

-- Correcao de marcacao (Portaria 671/2021): guarda o PEDIDO de ajuste.
-- A marcacao original em public.marcacoes nunca e alterada nem apagada;
-- o espelho e o banco de horas aplicam por cima so o que o gestor aprovou.
create table if not exists public.ajustes_ponto (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  solicitante_id uuid not null references public.usuarios (id) on delete cascade,
  dia date not null,
  acao text not null check (acao in ('incluir', 'alterar', 'excluir')),
  tipo text check (tipo in ('entrada', 'saida')),
  marcacao_ts timestamptz,
  hora_nova timestamptz,
  motivo text not null,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  resposta text,
  decidido_por uuid references public.usuarios (id),
  decidido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists ajustes_ponto_usuario_dia on public.ajustes_ponto (usuario_id, dia);
alter table public.ajustes_ponto enable row level security;

drop policy if exists "ajustes: cada um ve os seus" on public.ajustes_ponto;
create policy "ajustes: cada um ve os seus" on public.ajustes_ponto
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());

drop policy if exists "ajustes: cada um pede o seu" on public.ajustes_ponto;
create policy "ajustes: cada um pede o seu" on public.ajustes_ponto
  for insert to authenticated
  with check (solicitante_id = auth.uid() and status = 'pendente' and (usuario_id = auth.uid() or is_gestor()));

drop policy if exists "ajustes: so o gestor decide" on public.ajustes_ponto;
create policy "ajustes: so o gestor decide" on public.ajustes_ponto
  for update to authenticated using (is_gestor()) with check (is_gestor());```

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

### WhatsApp do convite

O app nao envia e-mail: quem manda o convite pra pessoa e o gestor. O botao
**WhatsApp** existia desde a versao anterior, mas abria o WhatsApp *sem
destinatario* - o gestor ainda tinha de achar o contato na mao, e num time em
que varias pessoas se chamam parecido isso e pedido pra mandar o link pra
pessoa errada. Um convite e de uso unico: se cair na conversa errada, quem
recebeu cria a conta no lugar do colega.

Por isso o formulario de convite agora tem o campo **WhatsApp**. Com o numero
salvo, o botao abre direto a conversa daquela pessoa com a mensagem pronta. O
campo e opcional: sem numero o botao volta a se comportar como antes, abrindo
o WhatsApp pra voce escolher o contato - e a lista de convites mostra `sem
WhatsApp cadastrado` pra voce saber de quais convites esperar esse trabalho a
mais.

O numero e normalizado por `telefoneWhats`: numero brasileiro pode ser digitado
como a gente escreve no dia a dia (`(31) 99999-8888`) que o `55` entra sozinho;
numero de fora precisa vir com o DDI. O que nao der pra confiar vira string
vazia, e o botao prefere abrir sem destinatario a abrir na conversa errada.

A coluna e opcional no banco - sem ela o convite continua sendo criado, so
nunca guarda numero nenhum:

```sql
-- WhatsApp do convite
alter table public.convites add column if not exists telefone text;
```

### Chamada de video pelo WhatsApp

O campo de sala aceita qualquer endereco `https`, entao a chamada do WhatsApp
funciona sem nenhuma mudanca de codigo: no WhatsApp, aba **Ligacoes**, toque em
**Criar link de chamada**, copie e cole em **Nosso time > Salas de
videochamada**. Esse link e o unico que o botao **Sugerir enderecos** nao
consegue sortear, porque so o WhatsApp pode cria-lo.

### Manter conectado

O token de acesso do Supabase vale 1 hora e ate agora o app nao guardava nada
no aparelho: fechar a aba, recarregar a pagina ou so voltar pro app depois do
almoco significava digitar e-mail e senha de novo. Num registro de ponto, que e
aberto quatro vezes por dia no celular, esse era o maior atrito do sistema.

A tela de login agora tem a caixa **Manter conectado neste aparelho**, marcada
por padrao. Marcada, o app guarda no proprio aparelho o `refresh_token` do
Supabase (`localStorage`, chave `pontorenovar.sessao.v1`) e, ao abrir de novo,
troca esse token por um acesso novo antes de mostrar qualquer tela - a pessoa
ve *Retomando sua sessao* e cai direto no ponto.

O que nunca acontece:

- a senha nao e guardada em lugar nenhum, nem o token de acesso (esse vive so
  na memoria da aba);
- caixa desmarcada nao grava nada e ainda apaga o que houvesse gravado;
- `Sair` apaga a lembranca do aparelho;
- a lembranca vence sozinha em 30 dias (`LEMBRANCA_DIAS`);
- link de convite tem prioridade sobre a lembranca, pra ninguem criar conta
  dentro da sessao de outra pessoa que usou o mesmo celular;
- se o servidor recusar a renovacao (senha trocada, sessao revogada no painel,
  conta desativada, ou seja, uma resposta 4xx) a lembranca e apagada. Queda de
  rede e erro de servidor (5xx) *nao* apagam: ficam guardados pra proxima
  tentativa.

De quebra, quem esta com o app aberto tambem parou de ser expulso: o token e
renovado sozinho dois minutos antes de vencer. O aviso **Sessao expirada** so
aparece agora quando a renovacao e recusada de verdade.

Em computador compartilhado (um tablet de recepcao, por exemplo) e so
desmarcar a caixa - o comportamento volta a ser exatamente o de antes.

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

Os **enderecos das salas de videochamada** ficam em `config_time`: `sala_video`
e o link geral e `sala_semanal`, `sala_quinzenal` e `sala_mensal` sao por
ritual. O gestor grava uma vez e o time inteiro passa a ver os mesmos
enderecos. O app nao hospeda video, so abre o link (Meet, Jitsi, Zoom) em aba
nova, porque a CSP da pagina usa `frame-src 'none'`.

O **check-in de energia** (nota de 1 a 10 pro proprio animo) NAO vai pro banco,
de proposito: e dado sensivel, fica so no aparelho de quem escreveu e nunca
aparece pro gestor. As respostas das tres perguntas, essas sim, vao pra tabela
`respostas` desde a fase anterior, porque a reuniao inteira depende delas.

### Mural, elogios, o que me motiva e a dinamica do anjo

Quatro rituais que falam de pessoa e nao de tarefa. Todos seguem a mesma regra
dos combinados: com a tabela no banco valem pro time inteiro, sem ela caem pro
aparelho de quem escreveu e a tela avisa isso com todas as letras.

| Ritual | Tabela | Quem le |
| --- | --- | --- |
| Mural de conquistas | `conquistas` | o time inteiro |
| Gratidao e elogios | `elogios` | o time inteiro, com assinatura de quem elogiou |
| O que me motiva | `motivadores` | o dono e o gestor, e so se a pessoa compartilhar |
| Dinamica do anjo | `anjo_rodada` e `anjo_par` | cada pessoa ve so de quem ela e anjo |

O **mural** aceita dois tipos, `vitoria` e `superacao`, com `check` no banco.
Nos **elogios** o banco impede elogiar a si mesmo (`check (de_id <> para_id)`),
entao a regra nao depende da tela.

O **que me motiva** nasce so no aparelho. So sobe pro banco quando a pessoa
aperta *Compartilhar com a lideranca* - e a tela diz antes quem vai ler. Pra
desfazer, basta apagar os tres campos e compartilhar de novo.

Na **dinamica do anjo** o gestor abre a rodada (padrao de 14 dias) e o app
sorteia: a lista e embaralhada e girada uma casa, entao ninguem tira a si mesmo
e todo mundo e cuidado por alguem. Os pares sobem com `Prefer: return=minimal`,
ou seja, nem quem sorteia recebe a lista de volta, e a policy de leitura do
`anjo_par` so devolve a linha de quem esta perguntando. Isso e privacidade de
aplicacao, nao segredo absoluto: quem administra o Supabase sempre consegue
consultar a tabela, e a tela fala isso na cara do usuario.

Nada disso vira ponto: conquista e elogio **nao entram** na gamificacao nem no
premio de assiduidade. Reconhecimento que vale nota deixa de ser reconhecimento
e vira meta - e ai as pessoas escrevem pra pontuar, nao pra agradecer.

### Numeros da retrospectiva e ata automatica

O roteiro da reuniao mensal tinha dois blocos que eram so texto ~  a *analise fria
dos numeros* e a *troca de elogios*. Agora os dois tem tela de verdade.

No bloco de numeros o app monta o painel do mes com o que ele ja tem ~  horas
trabalhadas, saldo do banco, pontualidade e quantos combinados fecharam. Da pra
escolher qualquer um dos ultimos doze meses, e por padrao ele abre no mes
anterior, que e o assunto da retrospectiva.

Uma decisao que vale explicar ~  **sai time, nao sai pessoa**. O painel nunca
mostra quem atrasou nem quem faltou, so o numero somado do grupo. Retrospectiva
com nome de atrasado no telao vira tribunal, e no mes seguinte ninguem fala a
verdade na reuniao. Caso individual continua sendo conversa reservada, e o
gestor tem o painel dele pra isso. A funcao `numerosDoMes` devolve so numero ~ 
nao existe campo de lista la dentro, e o teste garante que continue assim.

A media do proprio check-in de energia aparece numa linha separada, visivel so
pra quem escreveu - ela nao entra na conta coletiva.

No ultimo bloco de qualquer ritual aparece **Encerrar e gerar ata**. O app monta
a ata sozinho ~  dia, ritual, quem estava trabalhando (pela marcacao de ponto do
dia) e a lista de combinados que nasceram naquela reuniao. Ninguem digita resumo,
porque resumo digitado a mao e a primeira coisa que o time abandona.

A lista de participantes **nao e controle de presenca**. Nao existe falta de
reuniao no app e nada disso encosta em premio, avaliacao ou desligamento - a tela
diz isso embaixo do botao. Sem a tabela `atas` no banco, a ata cai pro aparelho
de quem encerrou e a tela avisa, igual aos outros rituais.

### As tres perguntas do time e a pauta real

As tres perguntas do planejamento (o que entreguei, no que vou focar, tenho
impedimento) ficavam so no aparelho de quem escreveu. Com a tabela opcional
`respostas` elas passam a aparecer lado a lado no bloco "Metas da semana":
cada pessoa escreve a sua, o time inteiro le, e quem ainda nao escreveu aparece
como nao escreveu, sem cobranca - a reuniao e as 09:15, dificilmente todo mundo
escreveu antes.

Quem marcou impedimento sobe para o topo do bloco "Dependencias", junto dos
combinados que vencem naquele dia ou que ja venceram. E dali que sai o combinado
com dono e prazo.

Os dois avisos de reuniao (ao sair do trabalho e ao chegar no dia seguinte)
passam a citar quantos pedidos de ajuda e quantos combinados vencendo estao na
mesa. Apenas a contagem, nunca o texto e nunca o nome: aviso de celular aparece
na tela de bloqueio, e pedido de ajuda de colega nao e assunto de tela de
bloqueio. Nome e texto aparecem dentro do app, para quem entrou com a propria
conta.

A ata da reuniao passa a guardar tambem o que cada um respondeu naquele dia, num
"O que cada um respondeu" que abre e fecha.

A nota de energia do check-in continua fora do banco, de proposito, e nao vai ter
tabela. Ela fica no aparelho de quem deu a nota, e a media mensal so aparece para
a propria pessoa. Animo virando historico consultavel pela lideranca muda a nota
que a pessoa da, nao o animo dela.

### Pedido de ajuda que se repete

Perguntar "tem impedimento?" toda semana e facil. O que corroi um time e o
impedimento que a pessoa repete na reuniao seguinte e ninguem move. O app compara
a resposta de hoje com a da ocorrencia anterior do MESMO ritual (a segunda
passada, no semanal; a de 15 dias atras, no quinzenal) e, quando a mesma pessoa
pede ajuda duas vezes seguidas, marca o assunto como travado.

A comparacao e por pessoa, e nao por texto, de proposito ~  quem esta travado
raramente descreve o problema com as mesmas palavras duas vezes.

O que aparece na tela:

- No bloco "Dependencias", uma faixa vermelha antes da lista, dizendo que o
  pedido voltou sem sair do lugar e que isso quase nunca e falta de esforco de
  quem pediu ~  costuma ser decisao que ninguem tomou, prioridade que ninguem
  trocou ou acesso que ninguem liberou.
- Em cada pedido repetido, a data em que ele apareceu pela primeira vez e o texto
  da reuniao passada, quando foi escrito diferente.
- Um botao **Virar combinado** que joga o texto do pedido dentro do formulario de
  combinado. O DONO nao vem preenchido de proposito ~  quem pediu ajuda quase nunca
  e quem consegue destravar.
- Na ata automatica, o pedido repetido sai marcado. Sem isso a ata de cada mes
  faz o mesmo travamento parecer novidade. Isso NAO exigiu coluna nova no banco ~ 
  a marca vai dentro do campo `respostas` da ata, que ja e `jsonb`.
- Nos dois avisos de reuniao, o repetido entra como assunto separado ("1 pedido de
  ajuda, 1 repetido da reuniao passada e 2 combinados vencendo"). Continua sendo
  so contagem, sem nome e sem texto.

### Acompanhamento dos combinados (painel do gestor)

O painel do gestor ganhou um bloco com os numeros do time ~  combinados em aberto,
quantos vencem hoje, quantos ja venceram, ha quantos dias o prazo mais antigo
estourou, quantos estao sem dono ou sem prazo e quantos pedidos de ajuda se
repetiram.

Tudo ali e numero do time inteiro. Nao tem nome, nao tem ranking e nao tem
contagem por pessoa, e isso e uma decisao de projeto, nao uma limitacao ~  placar
de tarefa atrasada por pessoa e o caminho mais curto para o time parar de pedir
ajuda em voz alta. Quem ficou com o que continua visivel apenas no roteiro, onde
o proprio time olha junto.

O bloco tambem manda ler o numero de repetidos antes dos outros, porque e o unico
numero da tela que aponta para uma decisao do gestor e nao para o esforco de quem
executa.

### Sala de videochamada por ritual

Cada ritual pode ter a sua sala. `salaDoRitual` procura primeiro o endereco do
proprio ritual e so depois cai no link geral; endereco que nao comeca com
`https://` e descartado, pra caixa de texto do gestor nao virar porta de entrada
pra qualquer coisa colada ali.

Quem nao tem sala nenhuma pode apertar **Sugerir enderecos**. O app sorteia uma
semente de 24 caracteres uma unica vez, guarda em `config_time.sala_semente` e
monta um endereco por ritual a partir dela (`enderecoSalaSugerido`). E so uma
sugestao: o app nao cria nem administra a sala, entao quem aperta o botao
precisa abrir o endereco uma vez pra conferir se funciona antes de contar com
ele. Sala com nome obvio e sala onde estranho entra, por isso o nome sorteado.

**Quem ja esta na sala** vem da tabela `presenca_chamada`. Depois de clicar em
entrar, e enquanto a aba do app continuar aberta, o aparelho regrava a propria
linha a cada quatro minutos, no maximo por duas horas. Quem para de bater some
da lista sozinho em `PRESENCA_MIN` minutos (8). Serve pra ninguem entrar numa
sala vazia achando que se atrasou, e pra quem chegou primeiro saber que nao
esta falando sozinho.

Isto **nao e controle de frequencia** e nao deve virar um. O app nunca pergunta
quem faltou na chamada, nao guarda contagem por pessoa e nao mostra essa lista
pro gestor de um jeito diferente do resto do time. Se alguem pedir um relatorio
de presenca em reuniao a partir dessa tabela, a resposta honesta e que o dado
nao foi feito pra isso: ele se apaga em minutos e nao registra ausencia.

Sem a tabela `presenca_chamada` o botao de entrar continua funcionando; o que
some e so a linha dizendo quem ja chegou.

### Resumo da semana do gestor

O painel do gestor abre com um bloco que junta os ultimos sete dias num lugar
so: quais rituais cairam na agenda, quantas pessoas escreveram as tres
perguntas em cada um, qual reuniao ficou sem ata e o que os combinados estao
dizendo. Antes dos numeros vem **uma frase so**, o "comece por aqui"
(`prioridadeDaSemana`). A ordem e proposital: pedido de ajuda que se repetiu
ganha de prazo estourado, e prazo estourado ganha de combinado sem dono. Quem
levantou a mao duas vezes esta esperando ha mais tempo do que qualquer data.

Painel que acende cinco alarmes de uma vez vira papel de parede, e o gestor
para de olhar. Por isso sai no maximo um aviso por vez, e quando nao ha nada a
apontar o bloco diz isso com todas as letras em vez de inventar urgencia.

**A nota do check-in de energia nao entra aqui, de proposito.** A tela de quem
responde promete que o gestor nao le a nota de animo, e essa promessa vale mais
do que o grafico bonito que sairia dela. Num time de tres pessoas nao existe
media anonima: qualquer numero exibido entregaria quem escreveu. Se um dia
alguem quiser esse dado, o caminho honesto e pedir para o time, e nao ligar no
painel sem avisar.

O bloco tambem nao mostra nome, ranking nem contagem por pessoa. "Ninguem
escreveu" e um recado sobre a reuniao, nao sobre um colaborador.

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
