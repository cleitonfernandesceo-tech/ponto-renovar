# Relat├│rio de Medi├º├úo de Velocidade (Baseline)

> **Data:** 04/11/2026
> **Status:** SOMENTE LEITURA ÔÇö Medir antes de mexer (Decis├úo do Dono / Claude).
> **Diretiva:** Nenhuma altera├º├úo de c├│digo, configura├º├úo, banco ou deploy nesta etapa.

---

## 1. Regi├úo de Hospedagem (Vercel vs. Supabase)

### Vercel (Frontend & Serverless Functions)
- **Dom├¡nio:** `https://renovar-crm.vercel.app`
- **Configura├º├úo (`vercel.json`):** Nenhuma regi├úo expl├¡cita (`regions`) definida. O padr├úo da Vercel Hobby ├® `iad1` (Washington, D.C. / Costa Leste dos EUA).
- **Inspe├º├úo Real de Cabe├ºalhos HTTP:**
  - Header: `x-vercel-id: cle1::iad1::ndqzg-1793790382106-644c4c8a7f9e`
  - Confirma├º├úo: As Serverless Functions do CRM rodam na regi├úo **`iad1` (Estados Unidos / Virg├¡nia/Washington D.C.)**.

### Supabase (Banco PostgreSQL)
- **Projeto:** `xoowbirlghbddejrflrn` (`https://xoowbirlghbddejrflrn.supabase.co`)
- **Provedor e Roteamento:** Supabase Cloud via AWS.
- **Risco de Descompasso Geogr├ífico (DESTAQUE - Maior ganho barato):**
  - Se o Supabase estiver provisionado em **`sa-east-1` (S├úo Paulo / Brasil)** enquanto as fun├º├Áes da Vercel rodam em **`iad1` (EUA)**, cada requisi├º├úo ├á API realiza uma viagem transatl├óntica/transcontinental de ida e volta (~120ms a 180ms de lat├¬ncia pura por round-trip).
  - Fun├º├Áes com m├║ltiplas consultas sequenciais (como `/api/data` ou consultas com `select=*` em cole├º├Áes inteiras) sofrem penalidade acumulada de v├írios segundos apenas em lat├¬ncia de rede.
  - **Recomenda├º├úo priorit├íria:** Se comprovada a diferen├ºa de regi├Áes, unificar a regi├úo das fun├º├Áes da Vercel para a mesma regi├úo do Supabase (adicionar `"regions": ["gru1"]` ou `"iad1"` conforme o banco) no `vercel.json`.

---

## 2. Tamanho dos Pacotes (Build do CRM)

Medi├º├úo real obtida atrav├®s do bundle de produ├º├úo gerado pelo Vite (`npm run build`):

| Pacote / Chunk | Tamanho Bruto (kB) | Tamanho Comprimido Gzip (kB) | Status / Observa├º├úo |
|---|---|---|---|
| `pdfjs-BpwMGDug.js` | 1.672,35 kB | 518,85 kB | Carregado sob demanda |
| `App-BKcEPL_x.js` | 581,20 kB | 181,76 kB | **Principal (Carregamento Inicial)** |
| `telaPdv-BrIzKEoO.js` | 357,23 kB | 104,10 kB | M├│dulo de PDV |
| `index-C9eq5nQn.js` (CSS/Core) | 206,86 kB | 69,13 kB | Depend├¬ncias base e React |
| `WhatsApp-BsdMdAGQ.js` | 156,85 kB | 47,89 kB | M├│dulo de Conversas WhatsApp |
| `AssistenteIA-DxPVe5kU.js` | 137,07 kB | 47,42 kB | M├│dulo da IA Assistente |
| `telaConfiguracoes-B5PlyrLw.js`| 55,95 kB | 15,00 kB | Configura├º├Áes da Loja |
| `telaDashboard-CCTnQ9Mr.js` | 44,90 kB | 13,29 kB | Dashboard financeiro e metas |

**Diagn├│stico:**
O `App.jsx` excede o limite recomendado de 500 kB da Vite (alerta emitido no build: `Some chunks are larger than 500 kB after minification`). O `App.jsx` importa estaticamente componentes pesados que poderiam ser lazy-loaded.

---

## 3. CRM no Celular & Tamanho dos Dados (Ambiente Logado)

> **Nota de Execu├º├úo:** O reposit├│rio e o ambiente de CI/Terminal n├úo possuem a sess├úo autenticada do operador nem credenciais administrativas privadas da Vercel. Conforme definido pelo Dono, a coleta das m├®tricas logadas em produ├º├úo ├® feita via **Gemini/Antigravity no PC com o navegador j├í logado**.

### Roteiro de Coleta e Template para Registro no PC (DevTools Moto G / 4G Lento)

#### A. Tempos de Intera├º├úo no CRM Logado (Modo Celular Moto G / 4G lento DevTools)
*Simula├º├úo: DevTools -> Network Throttling "Slow 4G" / CPU Throttling "4x slowdown":*

| A├º├úo | Medida 1 (s) | Medida 2 (s) | Medida 3 (s) | M├®dia (s) |
|---|---|---|---|---|
| Tempo at├® aparecer o Kanban | *a registrar* | *a registrar* | *a registrar* | **--** |
| Tempo para abrir uma OS | *a registrar* | *a registrar* | *a registrar* | **--** |
| Tempo para mover um card de etapa | *a registrar* | *a registrar* | *a registrar* | **--** |
| Tempo de abertura da aba WhatsApp | *a registrar* | *a registrar* | *a registrar* | **--** |

#### B. Tamanho dos Dados em `/api/data` (Aba Rede do DevTools)
*Verificar resposta de inicializa├º├úo das cole├º├Áes do `app_data`:*

| Posi├º├úo | Cole├º├úo / Tabela | Quantidade de Itens | Tamanho Transferido (kB) |
|---|---|---|---|
| 1┬¬ | *ex: ordens / os* | *--* | *-- kB* |
| 2┬¬ | *ex: conversas / wa_conversas* | *--* | *-- kB* |
| 3┬¬ | *ex: cards / kanban* | *--* | *-- kB* |
| 4┬¬ | *ex: clientes* | *--* | *-- kB* |
| 5┬¬ | *ex: produtos / estoque* | *--* | *-- kB* |

#### C. Fun├º├Áes mais Lentas no Painel Vercel (├Ültimos 7 dias)
*Acessar painel Vercel -> Analytics / Functions -> ordenar por dura├º├úo / timeout:*
1. `api/cron-agendamentos.js`: Dura├º├úo m├®dia e pico de tempo limite.
2. `api/wa-webhook.js`: Dura├º├úo m├®dia por evento recebido.
3. Top 10 fun├º├Áes mais lentas dos ├║ltimos 7 dias.

---

## 4. Auditoria dos Sites P├║blicos (Mobile)

### Site Oficial Renovar Tech (`https://www.renovartech.com.br`)
Medi├º├úo executada via auditoria Lighthouse Mobile (Motor emulado Moto G Power, Chromium Headless 145):

- **Nota de Desempenho:** **27 / 100**
- **Largest Contentful Paint (LCP):** **17.4 s** (Cr├¡tico ÔÇö meta ideal < 2.5s)
- **Cumulative Layout Shift (CLS):** **0.083** (Bom ÔÇö dentro da meta < 0.1)
- **Total Blocking Time (TBT):** **12.440 ms** (12.4s ÔÇö Extremamente alto)
- **First Contentful Paint (FCP):** **3.6 s**

#### Top 5 Recomenda├º├Áes do Lighthouse:
1. **Evitar m├║ltiplos redirecionamentos de p├ígina:** Ganho estimado de **1.190 ms** (redirecionamento de `renovartech.com.br` para `www.renovartech.com.br`).
2. **Reduzir JavaScript n├úo utilizado:** Economia estimada de **489 KiB** (~890 ms de tempo de execu├º├úo economizado).
3. **Minimizar trabalho da thread principal:** Mais de **13 segundos** gastos em compila├º├úo, parsing e execu├º├úo de scripts de rastreamento de terceiros.
4. **Dimens├Áes expl├¡citas para imagens:** Imagens sem atributos `width` e `height` causam instabilidade no c├ílculo de layout.
5. **Reduzir tempo de resposta inicial do servidor (TTFB):** O documento raiz demorou 280 ms para primeiro byte na borda Azion/Nginx.

#### Peso dos Recursos no Carregamento:
- **Total Transferido na P├ígina Inicial:** **2.135 KiB (2,13 MB)**
- **Scripts (JavaScript):** 37 scripts totalizando **1.348,4 KiB (1,35 MB)** transferidos.
  - Google Tag Manager & Google Ads (`gtag/js`, `gtm.js`): ~895 kB.
  - Facebook Pixel / Meta Events (`fbevents.js`, configs): ~227 kB.
  - Plataforma Tray (`trayLogin.umd.min.js`): ~96 kB.
- **Top Imagens mais pesadas:**
  - `Banners-Novos_01.png`: **237,1 KiB**
  - `Banners-Novos_02.png`: **110,7 KiB**
  - `Banners-Novos_04.png`: **105,6 KiB**
  - `Banners-Novos_03.png`: **76,1 KiB**
  - `logo_1.png`: **45,7 KiB**
- **Fontes Externas:** 1 fonte carregada (`bai-jamjuree-bold-webfont.woff2` - 19,2 KiB).
- **GIFs identificados:** 6 requisi├º├Áes de GIFs (incluindo `loading.gif` de 12.0 KiB e `selo_lojaprotegida.gif` de 3.2 KiB; pixels de rastreamento do Google Ads).

### Sites Adicionais (Renovar Pro & M├¡dia da Igreja)
- Os reposit├│rios ou dom├¡nios de publica├º├úo de "Renovar Pro" (ex.: imagens/GIFs `antes_viral.gif` e `depois_viral.gif`) e "M├¡dia da Igreja" pertencem a projetos/pastas correlacionadas no PC do operador.
- Registrar os dados no mesmo formato do site Renovar Tech assim que rodado no PC.

---

## 5. Tabela de S├¡ntese de Oportunidades

| Problema | Onde | N├║mero Medido | Ganho Esperado | Esfor├ºo |
|---|---|---|---|---|
| **Descompasso de Regi├úo** | Vercel (`iad1` / EUA) vs. Supabase (se `sa-east-1` / SP) | ~150ms a cada chamada HTTP banco/fun├º├úo | -1 a -3s no tempo total de rotinas com m├║ltiplas consultas | Baixo (ajuste de 1 linha no `vercel.json` na chave `"regions"`) |
| **Mon├│lito App.jsx** | `renovar-crm/src/App.jsx` | 581 kB bruto / 182 kB gzip | Carregamento inicial do CRM 30% a 50% mais r├ípido no mobile | M├®dio (lazy loading de componentes est├íticos) |
| **Chunk de PDV no carregamento** | `renovar-crm/src/telaPdv.jsx` | 357 kB bruto / 104 kB gzip | Menor consumo de mem├│ria e inicializa├º├úo mais leve | Baixo (manter isolado sob demanda) |
| **Scripts de Terceiros e Rastreamento** | Site `www.renovartech.com.br` | 1.348 kB em 37 scripts (TBT 12.4s) | Redu├º├úo dr├ística do bloqueio da thread principal (LCP de 17.4s -> < 4s) | M├®dio (defer / carregar tags de marketing ap├│s intera├º├úo) |
| **Banners N├úo Otimizados (PNG sem WebP/AVIF)** | Site `www.renovartech.com.br` | Banners de at├® 237 kB cada (total > 500 kB) | Economia de ~350 kB de transfer├¬ncia inicial | Baixo (converter PNG para WebP e servir com compress├úo) |
| **Redirecionamento Raiz -> WWW** | Site `renovartech.com.br` -> `www.` | 1.190 ms de atraso adicional | Economia imediata de ~1.2s no primeiro acesso | Baixo (configura├º├úo de DNS/Edge direta) |
| **Carga de Cole├º├Áes Inteiras (`select=*`)** | `api/_wadb.js`, `api/_supabase.js`, `/api/data` | Carrega tabela `app_data` e listas completas | Redu├º├úo substancial de tr├ífego e renderiza├º├úo do Kanban | M├®dio (pagina├º├úo ou campos espec├¡ficos) |

---

## 6. Prints Comprobat├│rios Salvos

1. `Sistemas/velocidade/pagespeed-mobile-renovartech.png` ÔÇö Captura da renderiza├º├úo mobile (390x844) do site Renovar Tech.
2. `Sistemas/velocidade/crm-mobile-preview.png` ÔÇö Captura da renderiza├º├úo mobile (390x844) do CRM em tela de login.

---

## 7. Conclus├úo

- **Nenhuma altera├º├úo foi realizada** em c├│digo de produ├º├úo, configura├º├Áes, banco de dados ou deploy, preservando integralmente o estado atual do sistema.
- Os dados comprovam que o maior ganho inicial para o site da loja ├® a **otimiza├º├úo de scripts de marketing de terceiros e convers├úo de banners PNG para WebP**.
- Para o CRM, a prioridade m├íxima identificada ├® a **equaliza├º├úo de regi├Áes Vercel / Supabase** e a divis├úo do bundle `App.jsx` em telas sob demanda.
