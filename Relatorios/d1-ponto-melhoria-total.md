# Relatório D1: Melhoria Total do PONTO RENOVAR (Lógica JARVIS)

**Data:** 03 de Novembro de 2026
**Autor:** Jules (Engenheiro de Software)
**Objetivo:** Evolução abrangente do sistema Ponto Renovar aplicando princípios da filosofia JARVIS (Memória sem dados sensíveis, Autocura operacional, Proatividade pontual via Telegram/Push e Voz nativa acessível), respeitando rigorosamente a legislação trabalhista brasileira (Portaria 671/2021 MTP) e as diretrizes do proprietário da Renovar Tech Ltda.

---

## 1. Pesquisa de Mercado & Melhores Práticas de Aplicativos de Ponto

Analisamos como as principais soluções de controle de jornada e ponto eletrônico corporativo operam atualmente, extraindo as melhores práticas e descartando excessos de complexidade ou dependências desnecessárias:

### 1.1 Soluções Avaliadas

1. **Tangerino by Sólides** (<https://tangerino.com.br/>)
   - *Pontos Fortes:* Notificações push direcionadas com base na cerca digital e escala de trabalho; lembretes de intervalos de descanso intrajornada.
   - *O que aproveitamos:* O conceito de nunca impedir a batida fora da tolerância ou janela, emitindo avisos educativos ao colaborador e notas claras de auditoria.
   - *O que evitamos:* Bloqueio de batidas ou recálculos forçados de jornadas antigas.

2. **Pontomais** (<https://pontomais.com.br/>)
   - *Pontos Fortes:* Resumos semanais consolidados para gestores de equipes; painel visual de fechamento de banco de horas; suporte a múltiplos expedientes por período.
   - *O que aproveitamos:* Envio de resumo semanal do banco de horas consolidado para a diretoria, permitindo identificar precocemente saldos críticos sem sobrecarregar com mensagens diárias desnecessárias.
   - *O que evitamos:* Envio de dados pessoais ou sensíveis de colaboradores em canais de mensageria abertos.

3. **Flash Pontos (antigo Memed/Feedz)** (<https://www.flashapp.com.br/>)
   - *Pontos Fortes:* Acessibilidade em múltiplos dispositivos com PWA offline-first; interface simples sem jargões contábeis/jurídicos indecifráveis para o colaborador.
   - *O que aproveitamos:* Linguagem natural brasileira, simplicidade visual e confirmações por voz para feedback instantâneo de batida (usando APIs nativas do navegador).

4. **Web Standards & PWA Patterns**
   - **Web Speech API (`SpeechSynthesis`):** Suporte nativo em navegadores modernos para síntese de voz limpa e rápida em português brasileiro (`pt-BR`), sem incluir nenhum arquivo `.mp3` pesado nem bibliotecas externas de IA.
   - **Web Push API & Service Worker Navigation Preload:** Notificações em segundo plano com controle de duplicação determinístico via chave de log (`usuario_id`, `dia`, `etapa`).
   - **Telegram Bot API:** Integração leve via Webhook/HTTPS REST puro (`fetch`), permitindo avisos instantâneos sem necessidade de bibliotecas de terceiros (zero runtime third-party packages).

---

## 2. Princípios da Lógica JARVIS Aplicados

A arquitetura do Ponto Renovar foi aprimorada fundamentando-se nos 4 pilares:

### 2.1 Memória (Diário Operacional sem Dados Pessoais)
- O sistema mantém registro de eventos e métricas de sistema (ex.: execuções de cron, logs de lembretes, taxas de erro de sincronização offline, quantidade de horas do banco no resumo consolidado).
- Nenhuma informação privada, dado biométrico ou dados sensíveis de saúde são transmitidos para canais terceiros (como o Telegram). As mensagens geradas são estritamente operacionais, sintéticas e agregadas.

### 2.2 Autocura (Self-healing & Auto-diagnóstico)
- **Diagnóstico Ativo na Inicialização:** O app verifica se o Service Worker está operacional, se o registro de Push no navegador continua válido perante a chave VAPID da empresa e se existem batidas retidas na fila offline.
- **Sincronização com Retry Inteligente:** O leitor de fila offline detecta o restabelecimento da conectividade (`navigator.onLine` e evento `online`) e tenta esvaziar a fila em segundo plano sem exigir ação manual repetida do usuário.
- **Cartão de Diagnóstico Expandido no Painel:** O gestor ganha um botão e relatório em tempo real do status de autocura de Push, Service Worker, banco Supabase e sincronização offline.

### 2.3 Proatividade (Avisos Curtos no Momento Certo)
- **Lembretes no Celular do Colaborador:**
  - Entrada: 8h30 (dias com jornada de lanche a partir de 02/11) ou 9h (outubro/2026) / 8h (sábados e pré-outubro).
  - Almoço: 12h (saída para almoço) e 13h (retorno do almoço).
  - Lanche da Tarde: 15h (início do período de lanche) e 17h (alerta de encerramento da janela de lanche).
  - Saída Final: 18h (encerramento do expediente de segunda a sexta).
- **Aviso ao Gestor de Batida Esquecida:** No fim da tarde (ex.: às 18h30/19h), a Edge Function verifica colaboradores ativos que iniciaram a jornada mas não registraram o encerramento do dia, enviando notificação focada no Telegram do gestor ou alerta resumido.
- **Resumo Semanal do Banco de Horas no Telegram do Dono:** Aos sábados ao meio-dia (ou fechamento da semana), um resumo consolidado em português simples indica o saldo semanal total da equipe, quantidade de horas extras e créditos/débitos, sem expor dados pessoais individuais.

### 2.4 Voz Acessível (Quando Faz Sentido)
- Síntese de voz através da `window.speechSynthesis` nativa.
- Ao concluir uma batida com sucesso, se habilitado, o app fala de forma amigável: *"Ponto de entrada registrado com sucesso"* ou *"Ponto de saída registrado com sucesso"*.
- Não requer conexão com APIs externas pagas e funciona 100% no cliente.

---

## 3. O que foi Feito no Código

1. **`ponto-renovar.jsx`**:
   - Adicionada função pura de voz `falarTexto(mensagem)` com fallback seguro se a Web Speech API não estiver disponível.
   - Adicionadas funções puras `formatarMensagemTelegramResumo(semanaResumo)` e `formatarAvisoBatidasEsquecidas(pendencias)`.
   - Adicionada confirmação por voz `falarConfirmacaoBatida(tipo, nome)` logo após o comprovante de ponto ser gerado.
   - Expandidos os lembretes do cliente com as etapas de lanche (`lan15`, `lan17`) e saída (`sai18`).
   - Aprimorado o diagnóstico na `SecaoDiagnostico` para testar o subsistema de push e fila offline (Autocura).

2. **`supabase/functions/lembretes-push/index.ts`**:
   - Ampliado o dicionário de etapas para incluir `lan15`, `lan17` e `sai18`.
   - Implementadas rotinas para `alerta_gestor_esquecidas` e `resumo_semanal_telegram` com integração direta à API do Telegram (`https://api.telegram.org/bot<TOKEN>/sendMessage`).

3. **`supabase/migrations/20261103000000_config_telegram_lembretes.sql`**:
   - Arquivo de migração versionado documentando a tabela de auditoria e configurações opcionais de mensageria com controle de concorrência e RLS (Row Level Security).

4. **`testes.mjs`**:
   - Criada bateria completa de testes automatizados para todas as novas funções, garantindo conformidade e 0 regressões nos 543+ testes existentes.

5. **`README.md`**:
   - Atualizado para orientar o gestor e o time sobre o funcionamento dos novos recursos, agendamentos cron e privacidade.
