-- Seguranca (advisors 19/10/2026).
-- Remuneracao: view so devolve linhas ao gestor (is_gestor()) e agora respeita RLS de quem consulta.
alter view public.usuarios_remuneracao set (security_invoker = on);
revoke all on public.usuarios_remuneracao from anon, authenticated;
grant select on public.usuarios_remuneracao to authenticated;

-- Ranking: o funcionario precisa ver nome/pontos dos colegas (sem salario), entao segue como
-- SECURITY DEFINER de proposito; so fica restrita a quem esta logado e somente leitura.
revoke all on public.ranking_pontos_publico from anon, authenticated;
grant select on public.ranking_pontos_publico to authenticated;

-- Funcoes: PUBLIC tem EXECUTE por padrao, entao revoga dele tambem.
revoke execute on function public.is_gestor() from public, anon;
grant execute on function public.is_gestor() to authenticated, service_role;
revoke execute on function public.resgatar_convite(uuid) from public, anon;
grant execute on function public.resgatar_convite(uuid) to authenticated, service_role;
-- convite_por_token continua publica: a tela de convite consulta antes do login (token e um uuid).
