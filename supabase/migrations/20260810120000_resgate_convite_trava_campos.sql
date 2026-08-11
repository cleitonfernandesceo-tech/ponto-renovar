-- 2026-08-10 - Correcao: o resgate do convite era bloqueado pela trava de campos sensiveis
--
-- Sintoma
-- Ao abrir o link do convite e escolher a senha, a conta era criada no auth,
-- mas o resgate falhava com "Alteracao nao permitida: campos de remuneracao,
-- papel, admissao e status so podem ser alterados pelo gestor", e o convite
-- continuava com usado = false. Tentar de novo dava sempre o mesmo erro.
--
-- Causa
-- resgatar_convite() grava nome, cargo, tipo e data_admissao na linha do proprio
-- usuario recem-criado, que nasce como colaborador (handle_new_user). O gatilho
-- BEFORE UPDATE trg_trava_campos_sensiveis impede que quem nao e gestor altere
-- data_admissao, entre outros campos. Como o convite traz uma data de admissao e
-- a linha nova tem NULL, o gatilho disparava e a transacao inteira voltava atras.
--
-- Correcao
-- resgatar_convite() marca a transacao com a flag app.resgate_convite e o gatilho
-- passa a nao disparar enquanto ela estiver ativa. A flag e local a transacao
-- (set_config com is_local = true), nao vaza para outras sessoes e so e ligada
-- dentro da propria funcao, que valida o token antes. O corpo de
-- trava_campos_sensiveis_usuario() nao mudou: colaborador continua sem poder
-- mexer em remuneracao, papel, admissao e status por fora do convite.

create or replace function public.resgatar_convite(p_token uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
v_convite record;
begin
select * into v_convite from public.convites
where token = p_token and usado = false and expira_em > now()
for update;

if not found then
raise exception 'Convite invalido, ja usado ou expirado';
end if;

-- libera a trava apenas dentro desta transacao
perform set_config('app.resgate_convite', '1', true);

update public.usuarios
set nome = v_convite.nome,
cargo = v_convite.cargo,
tipo = v_convite.tipo,
data_admissao = coalesce(v_convite.data_admissao, data_admissao)
where id = auth.uid();

perform set_config('app.resgate_convite', '', true);

update public.convites set usado = true where id = v_convite.id;
end;
$function$;

create or replace trigger trg_trava_campos_sensiveis
before update on public.usuarios
for each row
when (coalesce(current_setting('app.resgate_convite', true), '') <> '1')
execute function public.trava_campos_sensiveis_usuario();
