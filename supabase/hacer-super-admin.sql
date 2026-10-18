-- Convierte un usuario YA EXISTENTE en super admin (no toca su clave).
-- 1) Cambia el correo de abajo por el del administrador.
-- 2) Pégalo en Supabase → SQL Editor → Run.
-- Para quitarle la marca: delete from public.supers where user_id = (select id from auth.users where lower(email) = lower('admin@tucorreo.com'));

insert into public.supers (user_id)
select id from auth.users where lower(email) = lower('admin@tucorreo.com')
on conflict (user_id) do nothing;

-- Comprobación: debe salir 1 fila con ese correo. Si sale vacío, el correo no existe.
select u.email, s.creado_en
from public.supers s join auth.users u on u.id = s.user_id
where lower(u.email) = lower('admin@tucorreo.com');
