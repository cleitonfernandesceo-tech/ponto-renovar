-- 2026-10-31 - Assinatura eletronica de contracheque pelo gov.br (assinador.iti.gov.br)
-- Guarda a data da assinatura, o resumo SHA-256 do PDF assinado e o caminho no bucket privado "anexos".
-- O colaborador NAO ganha permissao de UPDATE na tabela (poderia mudar salario/liquido):
-- ele so chama a funcao assinar_contracheque, que grava apenas os 3 campos da propria folha fechada.

alter table public.folha_pagamento add column if not exists assinado_em timestamptz;
alter table public.folha_pagamento add column if not exists assinatura_sha256 text;
alter table public.folha_pagamento add column if not exists arquivo_assinado_url text;

drop policy if exists "colaborador assina a propria folha" on public.folha_pagamento;

create or replace function public.assinar_contracheque(p_folha_id uuid, p_sha256 text, p_arquivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'resumo do arquivo invalido';
  end if;
  if p_arquivo is null or split_part(p_arquivo, '/', 1) <> auth.uid()::text then
    raise exception 'arquivo fora da pasta do colaborador';
  end if;
  update public.folha_pagamento
     set assinado_em = now(), assinatura_sha256 = p_sha256, arquivo_assinado_url = p_arquivo
   where id = p_folha_id and usuario_id = auth.uid() and status = 'fechada';
  if not found then
    raise exception 'contracheque nao encontrado ou ainda nao fechado';
  end if;
end;
$$;

revoke all on function public.assinar_contracheque(uuid, text, text) from public, anon;
grant execute on function public.assinar_contracheque(uuid, text, text) to authenticated;
