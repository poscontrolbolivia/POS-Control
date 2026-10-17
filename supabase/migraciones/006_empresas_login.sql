-- 006 · Lista de empresas para el selector del login (pantalla sin sesión).
-- Expone SOLO código y nombre (nada de datos del negocio). Pegar en SQL Editor de Supabase.
create or replace function public.empresas_para_login()
returns table (id uuid, codigo text, nombre text)
language sql stable security definer
set search_path = ''
as $$
  select e.id, e.codigo, e.nombre
  from public.empresas e
  where e.codigo is not null and e.codigo <> ''
  order by lower(e.nombre)
  limit 200;
$$;
revoke all on function public.empresas_para_login() from public;
grant execute on function public.empresas_para_login() to anon, authenticated;
