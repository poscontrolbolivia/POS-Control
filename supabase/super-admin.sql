-- ============================================================================
-- POS Control · super-admin.sql  —  convertir UNA cuenta en SUPER ADMIN
-- Requisito: haber corrido antes setup.sql, y que la cuenta YA exista (créala con
-- "Crear mi negocio" en la app, o en Supabase → Authentication → Users).
-- Uso: cambia el correo de abajo, pega en SQL Editor y Run. Sirve las veces que haga falta.
-- (Para quitarlo: delete from public.supers where user_id = (select id from auth.users where lower(email) = 'correo@dominio.com');)
-- ============================================================================
do $$
declare
  v_correo text := 'CAMBIA_ESTO@correo.com';
  v_uid    uuid;
begin
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(v_correo));
  if v_uid is null then
    raise exception 'No existe ninguna cuenta con el correo %. Créala primero.', v_correo;
  end if;
  insert into public.supers (user_id) values (v_uid) on conflict (user_id) do nothing;
end $$;

-- Comprobación: debe aparecer el correo en la lista.
select u.email, s.creado_en
from public.supers s join auth.users u on u.id = s.user_id
order by s.creado_en;
