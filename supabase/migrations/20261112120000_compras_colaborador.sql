-- 2026-11-12 - Compras do colaborador na empresa, descontadas em ate 3 parcelas na folha
--
-- O que muda
--  1) Nova tabela public.compras_colaborador (descricao, valor, data, 1 a 3 parcelas).
--  2) Nova coluna public.folha_pagamento.desconto_compras (default 0). Folhas antigas ficam
--     com 0 e nada muda nelas.
--
-- Regra de seguranca (CLT art. 462 e Sumula 342 do TST: desconto em salario so com autorizacao
-- escrita do empregado):
--  - O desconto so vale quando status = 'aprovada' E aceite_colaborador_em preenchido.
--  - Colaborador que registra a propria compra ja deixa o aceite (marcou "autorizo o desconto").
--  - Quando o gestor lanca em nome do colaborador, o aceite fica vazio ate o colaborador confirmar.
--  - O gestor NUNCA consegue gravar o aceite de outra pessoa (gatilho abaixo).
--
-- Quem ve o que: colaborador ve so as dele; gestor (is_gestor()) ve todas.
-- Como voltar atras: ver o bloco "DESFAZER" no fim do arquivo.
--
-- ANTES de rodar em producao, copie as linhas da folha (nao ha escrita nelas, mas a tabela ganha coluna):
--   create table public.folha_pagamento_bkp_20261112 as select * from public.folha_pagamento;

create table if not exists public.compras_colaborador (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  lancado_por uuid not null references public.usuarios (id),
  descricao text not null check (char_length(btrim(descricao)) between 3 and 120),
  valor_total numeric(12, 2) not null check (valor_total > 0 and valor_total <= 100000),
  data_compra date not null,
  parcelas smallint not null default 1 check (parcelas between 1 and 3),
  primeira_competencia date not null check (extract(day from primeira_competencia) = 1),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  aceite_colaborador_em timestamptz,
  resposta text,
  decidido_por uuid references public.usuarios (id),
  decidido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists compras_colaborador_usuario on public.compras_colaborador (usuario_id, primeira_competencia);
alter table public.compras_colaborador enable row level security;

alter table public.folha_pagamento add column if not exists desconto_compras numeric(12, 2) not null default 0;

-- ---------- politicas ----------
drop policy if exists "compras: cada um ve as suas" on public.compras_colaborador;
create policy "compras: cada um ve as suas" on public.compras_colaborador
  for select to authenticated using (usuario_id = auth.uid() or is_gestor());

drop policy if exists "compras: registrar" on public.compras_colaborador;
create policy "compras: registrar" on public.compras_colaborador
  for insert to authenticated
  with check (lancado_por = auth.uid() and (usuario_id = auth.uid() or is_gestor()));

drop policy if exists "compras: atualizar" on public.compras_colaborador;
create policy "compras: atualizar" on public.compras_colaborador
  for update to authenticated
  using (usuario_id = auth.uid() or is_gestor())
  with check (usuario_id = auth.uid() or is_gestor());

-- Sem policy de DELETE: compra nunca e apagada, so cancelada (fica a prova).

-- ---------- gatilho: o que cada papel pode gravar ----------
create or replace function public.compras_colaborador_regras()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_gestor boolean := coalesce(is_gestor(), false);
begin
  if tg_op = 'INSERT' then
    new.lancado_por := auth.uid();
    new.criado_em := now();
    new.decidido_por := null;
    new.decidido_em := null;
    new.resposta := null;
    if v_gestor then
      if new.status not in ('pendente', 'aprovada') then
        raise exception 'compra nova so pode nascer pendente ou aprovada';
      end if;
      -- gestor nunca grava o aceite de outra pessoa
      if new.usuario_id <> auth.uid() then
        new.aceite_colaborador_em := null;
      elsif new.aceite_colaborador_em is null then
        new.aceite_colaborador_em := now();
      end if;
      if new.status = 'aprovada' then
        new.decidido_por := auth.uid();
        new.decidido_em := now();
      end if;
    else
      if new.usuario_id <> auth.uid() or new.status <> 'pendente' then
        raise exception 'colaborador so registra compra propria, esperando o gestor';
      end if;
      -- registrar a propria compra = autorizar o desconto
      new.aceite_colaborador_em := now();
    end if;
    return new;
  end if;

  -- UPDATE
  if v_gestor then
    if new.aceite_colaborador_em is distinct from old.aceite_colaborador_em then
      if new.usuario_id = auth.uid() and old.aceite_colaborador_em is null then
        new.aceite_colaborador_em := now();
      else
        raise exception 'so o proprio colaborador confirma o aceite do desconto';
      end if;
    end if;
    if new.status is distinct from old.status then
      if old.status in ('recusada', 'cancelada') then
        raise exception 'compra % nao pode mais mudar', old.status;
      end if;
      new.decidido_por := auth.uid();
      new.decidido_em := now();
    end if;
    -- identidade da compra nunca muda depois de lancada
    if new.usuario_id <> old.usuario_id or new.lancado_por <> old.lancado_por
       or new.valor_total <> old.valor_total or new.parcelas <> old.parcelas
       or new.data_compra <> old.data_compra or new.descricao <> old.descricao then
      raise exception 'valor, parcelas, data e descricao nao mudam; cancele e lance de novo';
    end if;
    -- mudar o mes do primeiro desconto so antes de aprovar
    if new.primeira_competencia <> old.primeira_competencia and old.status <> 'pendente' then
      raise exception 'o mes do primeiro desconto so muda enquanto a compra esta pendente';
    end if;
    return new;
  end if;

  -- colaborador: so confirma o proprio aceite OU cancela compra ainda pendente
  if old.usuario_id <> auth.uid() then
    raise exception 'compra de outra pessoa';
  end if;
  if (to_jsonb(new) - array['aceite_colaborador_em', 'status', 'decidido_por', 'decidido_em'])
     <> (to_jsonb(old) - array['aceite_colaborador_em', 'status', 'decidido_por', 'decidido_em']) then
    raise exception 'colaborador nao altera os dados da compra';
  end if;
  if new.aceite_colaborador_em is distinct from old.aceite_colaborador_em then
    if old.aceite_colaborador_em is null and old.status in ('pendente', 'aprovada') then
      new.aceite_colaborador_em := now();
    else
      raise exception 'o aceite ja foi dado ou a compra nao esta mais aberta';
    end if;
  end if;
  if new.status is distinct from old.status then
    if old.status = 'pendente' and new.status = 'cancelada' then
      new.decidido_por := auth.uid();
      new.decidido_em := now();
    else
      raise exception 'colaborador so cancela compra que ainda esta pendente';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_compras_regras on public.compras_colaborador;
create trigger trg_compras_regras
  before insert or update on public.compras_colaborador
  for each row execute function public.compras_colaborador_regras();

-- ---------- DESFAZER (so se precisar; nao rode junto) ----------
-- drop trigger if exists trg_compras_regras on public.compras_colaborador;
-- drop function if exists public.compras_colaborador_regras();
-- drop table if exists public.compras_colaborador;
-- alter table public.folha_pagamento drop column if exists desconto_compras;
