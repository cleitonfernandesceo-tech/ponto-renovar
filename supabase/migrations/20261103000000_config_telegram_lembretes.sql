-- =========================================================================
-- MIGRAÇÃO: Suporte a Alertas e Lembretes Proativos JARVIS
-- Versão: 20261103000000_config_telegram_lembretes.sql
-- Objetivo: Estrutura para alertas proativos operacionais (Telegram)
-- e registro de auto-diagnóstico sem exposição de dados pessoais.
-- =========================================================================

-- Tabela de configuração de integração do Telegram (apenas gestor acessa)
create table if not exists public.telegram_config (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  tipo text not null check (tipo in ('gestor_alertas', 'dono_resumo')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.telegram_config enable row level security;

-- Políticas de segurança: apenas gestor autenticado pode visualizar e gerenciar
drop policy if exists "telegram_config_gestor_select" on public.telegram_config;
create policy "telegram_config_gestor_select" on public.telegram_config
  for select to authenticated using (is_gestor());

drop policy if exists "telegram_config_gestor_all" on public.telegram_config;
create policy "telegram_config_gestor_all" on public.telegram_config
  for all to authenticated using (is_gestor()) with check (is_gestor());

-- Tabela de log operacional de envio do Telegram (trava de envio único por dia/etapa)
create table if not exists public.telegram_envios_log (
  dia date not null,
  etapa text not null,
  enviado_em timestamptz not null default now(),
  sucesso boolean not null default true,
  detalhe text,
  primary key (dia, etapa)
);

alter table public.telegram_envios_log enable row level security;

drop policy if exists "telegram_envios_log_select" on public.telegram_envios_log;
create policy "telegram_envios_log_select" on public.telegram_envios_log
  for select to authenticated using (is_gestor());
