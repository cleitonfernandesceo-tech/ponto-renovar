-- 2026-10-31 - Assinatura eletronica de contracheque pelo gov.br (assinador.iti.gov.br)
-- Guarda a data da assinatura, o resumo criptografico SHA-256 do PDF assinado
-- e o caminho no bucket privado "anexos" do Supabase Storage.

alter table public.folha_pagamento add column if not exists assinado_em timestamptz;
alter table public.folha_pagamento add column if not exists assinatura_sha256 text;
alter table public.folha_pagamento add column if not exists arquivo_assinado_url text;

-- Politica de RLS: o colaborador pode atualizar os campos de assinatura do seu proprio contracheque
drop policy if exists "colaborador assina a propria folha" on public.folha_pagamento;
create policy "colaborador assina a propria folha" on public.folha_pagamento
  for update to authenticated
  using (usuario_id = auth.uid() or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'))
  with check (usuario_id = auth.uid() or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.tipo = 'gestor'));
