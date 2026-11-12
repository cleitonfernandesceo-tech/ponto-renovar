-- 2026-11-12 - Pausa da tarde pre-assinalada (17h-17h30) e avisos de saida. Pedido do dono.
--
-- 1) Desliga a "saida automatica" das 18h (job auto-saida-diaria). A Portaria 671/2021 veda o
--    sistema de ponto marcar batida sozinho; so o intervalo pode ser pre-assinalado (CLT art. 74 §2).
--    A funcao aplicar_saidas_automaticas() fica no banco, mas nao e mais chamada. Saida esquecida:
--    o gestor ajusta com justificativa e o colaborador confirma no app.
-- 2) Agenda os avisos da tarde na Edge Function lembretes-push (seg-sex, horario de Brasilia):
--    16h50 pausa / 17h20 retorno / 17h50 saida / 18h06 saida ainda nao registrada.
--    Reaproveita o mesmo comando HTTP do job lembretes-push (sem gravar chave no repositorio).
--    UTC = Brasilia + 3h. 19:20 UTC (16h20) cai fora das faixas e e ignorado pela funcao.
--
-- DESFAZER: select cron.unschedule('lembretes-tarde'); select cron.unschedule('lembretes-saida-1806');
--           select cron.schedule('auto-saida-diaria', '0 2 * * *', 'select public.aplicar_saidas_automaticas();');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-saida-diaria') then
    perform cron.unschedule('auto-saida-diaria');
  end if;
  if exists (select 1 from cron.job where jobname = 'lembretes-tarde') then
    perform cron.unschedule('lembretes-tarde');
  end if;
  if exists (select 1 from cron.job where jobname = 'lembretes-saida-1806') then
    perform cron.unschedule('lembretes-saida-1806');
  end if;
  perform cron.schedule('lembretes-tarde', '20,50 19,20 * * 1-5',
    (select command from cron.job where jobname = 'lembretes-push'));
  perform cron.schedule('lembretes-saida-1806', '6 21 * * 1-5',
    (select command from cron.job where jobname = 'lembretes-push'));
end $$;
