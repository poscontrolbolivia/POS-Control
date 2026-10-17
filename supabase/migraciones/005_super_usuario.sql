-- ============================================================================
-- 005_super_usuario.sql · Crear (o promover) el usuario super admin desde SQL
-- ----------------------------------------------------------------------------
-- Para qué: la app solo sabe dar de ALTA empresas y su admin (004). El super es
-- el dueño de la plataforma y no puede crearse desde la pantalla de login, así
-- que se crea acá. Requiere 001 (public.supers, public.es_super()) y, si ya se
-- aplicó, 004 (private.auditar y la auditoría de altos).
--
-- Idempotente y re-pegable: las funciones se reemplazan con create or replace,
-- los grant/revoke se sueltan antes y los insert van con on conflict do nothing.
-- Volver a pegarlo no rompe datos ni duplica nada.
--
-- Uso (una sola línea en el SQL Editor, una vez):
--   select public.crear_super('dueno@correo.com', 'SuClaveSegura', 'Alex');
-- Si la cuenta ya existe y solo falta marcarla como super:
--   select public.crear_super('dueno@correo.com', 'da igual', 'Alex');  -- no toca la clave
--   select public.crear_super('dueno@correo.com', 'ClaveNueva', 'Alex', true);  -- sí la cambia
--
-- Las dos funciones están REVOCADAS para anon/authenticated: solo se pueden
-- invocar desde el SQL Editor (rol postgres) o con la service key. Nadie con una
-- cuenta de negocio puede mintear supers.
--
-- Ojo con la clave: queda escrita en el historial de consultas del SQL Editor.
-- Si quieres evitar eso, ponla y luego borra la consulta del historial, o usa
-- public.super_resetear_clave (004) para cambiarla después.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CREAR SUPER · da de alta la cuenta en GoTrue y la marca como super.
--    Con la cuenta ya existente: promove y NO cambia la clave, salvo que se
--    pase p_reemplazar_clave = true (útil para "olvidé mi clave" del propio super).
-- ----------------------------------------------------------------------------
create or replace function public.crear_super(
  p_correo             text,
  p_clave              text,
  p_nombre             text   default 'Super',
  p_reemplazar_clave   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text;
  v_uid   uuid;
  v_nuevo boolean := false;
begin
  v_email := lower(trim(coalesce(p_correo, '')));
  if v_email = '' or position('@' in v_email) = 0 or position('.' in split_part(v_email, '@', 2)) = 0 then
    raise exception 'super_correo_invalido: escribe un correo completo (algo@dominio.com)';
  end if;
  if coalesce(p_clave, '') = '' or length(p_clave) < 8 then
    raise exception 'La clave del super debe tener al menos 8 caracteres';
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = v_email limit 1;

  if v_uid is null then
    v_uid := gen_random_uuid();
    v_nuevo := true;
    -- Columnas de verificación a '' (nunca NULL): GoTrue los usa para decidir si
    -- la cuenta está pendiente de confirmación. Igual que equipo_invitar (004).
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data,
                            confirmation_token, recovery_token,
                            email_change, email_change_token_new, email_change_token_current,
                            phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            v_email, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
            now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('display_name', coalesce(nullif(trim(p_nombre), ''), 'Super')),
            '', '', '', '', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, 'email',
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            now(), now(), now())
    on conflict (provider_id, provider) do nothing;

    -- handle_new_user (schema.sql) ya creó public.perfiles con el display_name.
    insert into public.perfiles (user_id, display_name)
    values (v_uid, coalesce(nullif(trim(p_nombre), ''), 'Super'))
    on conflict (user_id) do update set display_name = excluded.display_name;
  elsif p_reemplazar_clave then
    update auth.users
       set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           confirmation_token = '',
           recovery_token = '',
           email_change = '',
           email_change_token_new = '',
           email_change_token_current = '',
           phone_change = '',
           phone_change_token = '',
           reauthentication_token = '',
           updated_at = now()
     where id = v_uid;
    -- La identidad puede seguir diciendo email_verified=false si la cuenta se creó
    -- por otro proveedor; se alinea para que el login por clave no se queje.
    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email_verified}', 'true'),
           updated_at = now()
     where user_id = v_uid and provider = 'email';
  end if;

  -- El candado real de super: una fila en public.supers.
  insert into public.supers (user_id) values (v_uid) on conflict (user_id) do nothing;

  if to_regclass('public.auditoria') is not null then
    -- Sin empresa: es un evento de plataforma, no de negocio.
    perform private.auditar(null::uuid, 'super_alta',
      jsonb_build_object('correo', v_email,
                         'cuenta_nueva', v_nuevo,
                         'clave_fijada', (v_nuevo or coalesce(p_reemplazar_clave, false))));
  end if;

  return v_uid;
end $fn$;

-- Solo el rol postgres del editor (o la service key) puede mintear supers.
revoke all on function public.crear_super(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.crear_super(text, text, text, boolean) to service_role;


-- ----------------------------------------------------------------------------
-- 2) QUITAR SUPER · deja de ser super pero conserva su cuenta y sus empresas.
--    Es un borrado de la fila de public.supers, no del usuario.
-- ----------------------------------------------------------------------------
create or replace function public.quitar_super(p_correo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid;
begin
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(coalesce(p_correo, ''))) limit 1;
  if v_uid is null then
    raise exception 'No hay ninguna cuenta con ese correo';
  end if;
  delete from public.supers where user_id = v_uid;
  return true;
end $fn$;

revoke all on function public.quitar_super(text) from public, anon, authenticated;
grant execute on function public.quitar_super(text) to service_role;


-- ----------------------------------------------------------------------------
-- 3) SUPER SEMILLA · el correo de la cuenta que ya existe como super en 001.
--    No se toca: si public.supers tiene filas, no hay que crear nada.
-- ----------------------------------------------------------------------------
insert into public.supers (user_id)
values ('85201957-cdfb-4235-acfe-dd1a54e348d0')
on conflict (user_id) do nothing;


-- ============================================================================
-- VERIFICACIÓN (el SQL Editor muestra estos dos resultados al terminar)
-- ============================================================================
select 'funcion' as objeto, p.proname as nombre
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('crear_super', 'quitar_super')
 order by p.proname;

-- Cuántos supers hay y cuántos pueden mintearse desde la app (debe ser 0: las
-- funciones están revocadas a anon y authenticated).
select (select count(*)::int from public.supers)                                        as supers,
       (select count(*)::int from information_schema.routine_privileges rp
         where rp.routine_name in ('crear_super','quitar_super')
           and rp.grantee in ('anon','authenticated'))                                  as permisos_publicos;
