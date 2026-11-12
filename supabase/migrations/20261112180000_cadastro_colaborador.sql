-- 2026-11-12 - Cadastro completo do colaborador (ficha, salario com historico, vale-transporte,
-- dependentes, pendencias da carteira digital/eSocial, desligamento sem apagar nada)
--
-- NAO rode em producao sem o dono/Claude revisar. So cria tabelas NOVAS (nao mexe em usuarios,
-- folha_pagamento nem em nenhuma politica existente). Pode rodar de novo sem estragar nada.
--
-- Quem ve o que (RLS): colaborador ve so as linhas dele; gestor (is_gestor()) ve todas.
-- Nada e apagado: nao existe policy de DELETE em nenhuma tabela. Desligar = marcar data e motivo.
--
-- Tabelas:
--  1) colaborador_cadastro   ficha (1 linha por pessoa): dados pessoais, endereco, pagamento,
--                            contato de emergencia, jornada e desligamento
--  2) salario_historico      cada alteracao de salario (valor, vigencia, motivo, quem alterou)
--                            + trava contra REDUCAO (CF art. 7o VI / CLT art. 468)
--  3) vale_transporte_linhas linhas de onibus de ida e volta
--  4) dependentes            dependentes (IRRF / salario-familia)
--  5) esocial_registros      pendencias de S-2200 / S-2206 / S-2299 ate o gestor confirmar o envio
--
-- Como voltar atras: bloco "DESFAZER" no fim do arquivo.

-- ============================================================
-- 1) FICHA
-- ============================================================
create table if not exists public.colaborador_cadastro (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  -- dados pessoais (carteira/eSocial)
  data_nascimento date,
  sexo text check (sexo in ('F', 'M')),
  raca_cor text check (raca_cor in ('branca', 'preta', 'parda', 'amarela', 'indigena', 'nao_informada')),
  estado_civil text check (estado_civil in ('solteiro', 'casado', 'uniao_estavel', 'separado', 'divorciado', 'viuvo')),
  grau_instrucao text check (grau_instrucao in ('fundamental', 'medio', 'superior', 'pos', 'outro')),
  pis_nis text check (pis_nis is null or pis_nis ~ '^[0-9]{11}$'),
  cbo text check (cbo is null or cbo ~ '^[0-9]{6}$'),
  -- jornada
  jornada_horas_semana numeric(4, 1) check (jornada_horas_semana is null or (jornada_horas_semana > 0 and jornada_horas_semana <= 44)),
  jornada_descricao text check (char_length(jornada_descricao) <= 200),
  -- endereco
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  logradouro text check (char_length(logradouro) <= 120),
  numero text check (char_length(numero) <= 12),
  complemento text check (char_length(complemento) <= 60),
  bairro text check (char_length(bairro) <= 80),
  cidade text check (char_length(cidade) <= 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  codigo_ibge text check (codigo_ibge is null or codigo_ibge ~ '^[0-9]{7}$'),
  -- pagamento
  banco text check (char_length(banco) <= 60),
  agencia text check (char_length(agencia) <= 12),
  conta text check (char_length(conta) <= 20),
  pix_tipo text check (pix_tipo in ('cpf', 'celular', 'email', 'aleatoria')),
  pix_chave text check (char_length(pix_chave) <= 80),
  -- emergencia
  emergencia_nome text check (char_length(emergencia_nome) <= 80),
  emergencia_parentesco text check (char_length(emergencia_parentesco) <= 40),
  emergencia_telefone text check (char_length(emergencia_telefone) <= 20),
  -- vale-transporte: dias de uso por mes
  vt_dias_mes smallint check (vt_dias_mes is null or vt_dias_mes between 0 and 31),
  -- desligamento (nada e apagado: so marca)
  desligado_em date,
  motivo_desligamento text check (char_length(motivo_desligamento) <= 200),
  atualizado_em timestamptz not null default now(),
  check (desligado_em is null or motivo_desligamento is not null)
);
alter table public.colaborador_cadastro enable row level security;

drop policy if exists "cadastro: ver o proprio ou todos (gestor)" on public.colaborador_cadastro;
create policy "cadastro: ver o proprio ou todos (gestor)" on public.colaborador_cadastro
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());

drop policy if exists "cadastro: criar" on public.colaborador_cadastro;
create policy "cadastro: criar" on public.colaborador_cadastro
  for insert to authenticated with check (usuario_id = auth.uid() or is_gestor());

drop policy if exists "cadastro: atualizar" on public.colaborador_cadastro;
create policy "cadastro: atualizar" on public.colaborador_cadastro
  for update to authenticated
  using (usuario_id = auth.uid() or is_gestor())
  with check (usuario_id = auth.uid() or is_gestor());
-- Sem policy de DELETE.

-- Colaborador so mexe nos dados pessoais de contato (endereco, pagamento, emergencia).
-- Data de nascimento, PIS, CBO, jornada, VT e desligamento: so o gestor.
create or replace function public.colaborador_cadastro_regras()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_gestor boolean := coalesce(is_gestor(), false);
  v_livres text[] := array['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'codigo_ibge',
    'banco', 'agencia', 'conta', 'pix_tipo', 'pix_chave',
    'emergencia_nome', 'emergencia_parentesco', 'emergencia_telefone', 'atualizado_em'];
begin
  new.atualizado_em := now();
  if v_gestor then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.usuario_id <> auth.uid() then
      raise exception 'so o gestor cria a ficha de outra pessoa';
    end if;
    if new.data_nascimento is not null or new.sexo is not null or new.raca_cor is not null
       or new.estado_civil is not null or new.grau_instrucao is not null or new.pis_nis is not null
       or new.cbo is not null or new.jornada_horas_semana is not null or new.jornada_descricao is not null
       or new.vt_dias_mes is not null or new.desligado_em is not null or new.motivo_desligamento is not null then
      raise exception 'colaborador so preenche endereco, pagamento e contato de emergencia';
    end if;
    return new;
  end if;
  if new.usuario_id <> old.usuario_id then
    raise exception 'a ficha nao muda de dono';
  end if;
  if (to_jsonb(new) - v_livres) <> (to_jsonb(old) - v_livres) then
    raise exception 'colaborador so altera endereco, pagamento e contato de emergencia';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cadastro_regras on public.colaborador_cadastro;
create trigger trg_cadastro_regras
  before insert or update on public.colaborador_cadastro
  for each row execute function public.colaborador_cadastro_regras();

-- ============================================================
-- 2) SALARIO COM HISTORICO
-- ============================================================
create table if not exists public.salario_historico (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  valor numeric(12, 2) not null check (valor > 0 and valor <= 1000000),
  vigencia date not null,
  motivo text not null check (char_length(btrim(motivo)) between 3 and 200),
  acordo_coletivo boolean not null default false,
  alterado_por uuid not null references public.usuarios (id),
  criado_em timestamptz not null default now()
);
create index if not exists salario_historico_usuario on public.salario_historico (usuario_id, vigencia desc, criado_em desc);
alter table public.salario_historico enable row level security;

drop policy if exists "salario: ver o proprio ou todos (gestor)" on public.salario_historico;
create policy "salario: ver o proprio ou todos (gestor)" on public.salario_historico
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());

drop policy if exists "salario: so o gestor lanca" on public.salario_historico;
create policy "salario: so o gestor lanca" on public.salario_historico
  for insert to authenticated with check (is_gestor() and alterado_por = auth.uid());
-- Sem UPDATE e sem DELETE: historico de salario nunca e reescrito (corrige-se lancando outra linha).

create or replace function public.salario_historico_regras()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_anterior numeric(12, 2);
begin
  new.alterado_por := auth.uid();
  new.criado_em := now();
  -- salario vigente na data da nova vigencia (ultima linha com vigencia <= nova)
  select valor into v_anterior
    from public.salario_historico
   where usuario_id = new.usuario_id and vigencia <= new.vigencia
   order by vigencia desc, criado_em desc
   limit 1;
  if v_anterior is not null and new.valor < v_anterior and not new.acordo_coletivo then
    raise exception 'reducao de salario nao e permitida (CF art. 7o VI, CLT art. 468) sem acordo ou convencao coletiva';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_salario_regras on public.salario_historico;
create trigger trg_salario_regras
  before insert on public.salario_historico
  for each row execute function public.salario_historico_regras();

-- ============================================================
-- 3) VALE-TRANSPORTE
-- ============================================================
create table if not exists public.vale_transporte_linhas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  sentido text not null check (sentido in ('ida', 'volta')),
  linha text not null check (char_length(btrim(linha)) between 1 and 60),
  valor_passagem numeric(8, 2) not null check (valor_passagem > 0 and valor_passagem <= 200),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists vt_linhas_usuario on public.vale_transporte_linhas (usuario_id);
alter table public.vale_transporte_linhas enable row level security;

drop policy if exists "vt: ver o proprio ou todos (gestor)" on public.vale_transporte_linhas;
create policy "vt: ver o proprio ou todos (gestor)" on public.vale_transporte_linhas
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());
drop policy if exists "vt: so o gestor cria" on public.vale_transporte_linhas;
create policy "vt: so o gestor cria" on public.vale_transporte_linhas
  for insert to authenticated with check (is_gestor());
drop policy if exists "vt: so o gestor altera" on public.vale_transporte_linhas;
create policy "vt: so o gestor altera" on public.vale_transporte_linhas
  for update to authenticated using (is_gestor()) with check (is_gestor());
-- Sem DELETE: linha que saiu de uso fica com ativo = false.

-- ============================================================
-- 4) DEPENDENTES
-- ============================================================
create table if not exists public.dependentes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 100),
  parentesco text not null check (parentesco in ('filho', 'conjuge', 'outro')),
  data_nascimento date not null,
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  irrf boolean not null default true,
  salario_familia boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists dependentes_usuario on public.dependentes (usuario_id);
alter table public.dependentes enable row level security;

drop policy if exists "dependentes: ver o proprio ou todos (gestor)" on public.dependentes;
create policy "dependentes: ver o proprio ou todos (gestor)" on public.dependentes
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());
drop policy if exists "dependentes: so o gestor cria" on public.dependentes;
create policy "dependentes: so o gestor cria" on public.dependentes
  for insert to authenticated with check (is_gestor());
drop policy if exists "dependentes: so o gestor altera" on public.dependentes;
create policy "dependentes: so o gestor altera" on public.dependentes
  for update to authenticated using (is_gestor()) with check (is_gestor());

-- ============================================================
-- 5) CARTEIRA DIGITAL / eSOCIAL (pendencias)
-- ============================================================
create table if not exists public.esocial_registros (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  evento text not null check (evento in ('S-2200', 'S-2206', 'S-2299')),
  data_fato date not null,
  descricao text check (char_length(descricao) <= 200),
  status text not null default 'pendente' check (status in ('pendente', 'enviado')),
  recibo text check (char_length(recibo) <= 60),
  enviado_em timestamptz,
  enviado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now(),
  unique (usuario_id, evento, data_fato)
);
create index if not exists esocial_registros_status on public.esocial_registros (status, data_fato);
alter table public.esocial_registros enable row level security;

drop policy if exists "esocial: ver o proprio ou todos (gestor)" on public.esocial_registros;
create policy "esocial: ver o proprio ou todos (gestor)" on public.esocial_registros
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());
drop policy if exists "esocial: so o gestor cria" on public.esocial_registros;
create policy "esocial: so o gestor cria" on public.esocial_registros
  for insert to authenticated with check (is_gestor());
drop policy if exists "esocial: so o gestor confirma" on public.esocial_registros;
create policy "esocial: so o gestor confirma" on public.esocial_registros
  for update to authenticated using (is_gestor()) with check (is_gestor());

-- ---------- DESFAZER (so se precisar; nao rode junto) ----------
-- drop table if exists public.esocial_registros;
-- drop table if exists public.dependentes;
-- drop table if exists public.vale_transporte_linhas;
-- drop trigger if exists trg_salario_regras on public.salario_historico;
-- drop function if exists public.salario_historico_regras();
-- drop table if exists public.salario_historico;
-- drop trigger if exists trg_cadastro_regras on public.colaborador_cadastro;
-- drop function if exists public.colaborador_cadastro_regras();
-- drop table if exists public.colaborador_cadastro;
