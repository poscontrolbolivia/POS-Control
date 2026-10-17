-- ============================================================================
-- migraciones/004_altas.sql · Alta self-service de empresa + gestión de equipo
-- Idempotente. Ejecutar DESPUÉS de schema.sql, 001_super.sql y 002_seguridad.sql
-- (y, por convención, después de 003_comensales.sql).
--
-- Requiere 001 (public.supers / public.es_super() y el patrón de INSERT directo
-- a auth.users de super_importar_empresa) y 002 (private.auditar, private.es_super_compat,
-- private.exigir_rol/fijar_empresa/mi_rol y el trigger trg_nueva_cuota que ya siembra
-- public.limites por cada empresa nueva).
--
-- Qué añade
--   1) Registro self-service: quien se da de alta con signUp + options.data.alta_empresa
--      crea su propia empresa (una zona "Salón" con 8 mesas de muestra) y se asigna ADMIN.
--      Se implementa con un trigger AFTER INSERT en auth.users (el usuario aún no tiene
--      sesión dentro del trigger, por eso se lee NEW.raw_user_meta_data).
--   2) RPCs de equipo (solo rol admin de la empresa ACTIVA): listar / invitar (alta
--      directa en auth.users, espejo de super_importar_empresa) / restablecer clave /
--      revocar miembro.
--   3) RPC del dueño de la plataforma para resetear la clave de CUALQUIER usuario,
--      sin acotar a la empresa activa.
--
-- Convenciones de seguridad (CONTRATO §0.8 y §7): toda función pública nueva lleva
-- `set search_path = ''`, `security definer`, `revoke ... from public, anon` y
-- `grant execute ... to authenticated`. Los triggers solo se revocan (no necesitan
-- grants). Nunca se escribe una clave/anon/token en este archivo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) ALTA SELF-SERVICE DE EMPRESA (trigger sobre auth.users)
--    El cliente llama supabase.auth.signUp() con
--      options.data = { nombre, codigo_empresa, nombre_empresa, alta_empresa: true }
--    y la confirmación por email está DESHABILITADA (así auth.users se inserta ya
--    confirmado y este trigger dispara de inmediato).
--
--    El trigger NO debe crear empresa cuando la fila de auth.users viene de las
--    pantallas de equipo (equipo_invitar), por eso filtra por alta_empresa = 'true'.
--    El perfiles del usuario lo crea ya el trigger on_auth_user_created/handle_new_user
--    (schema.sql), así que acá NO se toca public.perfiles.
-- ----------------------------------------------------------------------------
create or replace function private.registrar_empresa_del_registrado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_codigo text;
  v_nombre_emp text;
  v_emp  uuid;
  v_zona uuid;
begin
  -- Actúa SOLO para altas self-service; para el resto (p.ej. equipo_invitar) no hace nada.
  if coalesce(NEW.raw_user_meta_data ->> 'alta_empresa', '') <> 'true' then
    return NEW;
  end if;

  -- Normalización y validación del código (trim + lower, 3..24, regex de proyecto).
  v_codigo := lower(trim(coalesce(NEW.raw_user_meta_data ->> 'codigo_empresa', '')));
  v_nombre_emp := trim(coalesce(NEW.raw_user_meta_data ->> 'nombre_empresa', ''));

  if char_length(v_codigo) < 3 or char_length(v_codigo) > 24
     or v_codigo !~ '^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'alta_codigo_invalido: el código debe tener entre 3 y 24 caracteres y empezar con letra o número (solo a-z, 0-9, ".", "_" y "-")'
      using errcode = '23514';
  end if;

  if char_length(v_nombre_emp) < 1 or char_length(v_nombre_emp) > 80 then
    raise exception 'alta_nombre_invalido: el nombre de la empresa debe tener entre 1 y 80 caracteres'
      using errcode = '23514';
  end if;

  -- Código repetido: al lanzar dentro del INSERT de auth.users, todo el signUp se
  -- revierte (es la intención) y el cliente ve un error específico (23505).
  if exists (select 1 from public.empresas where lower(codigo) = v_codigo) then
    raise exception 'alta_codigo_tomado: el código % ya está en uso por otra empresa', v_codigo
      using errcode = '23505';
  end if;

  -- Empresa nueva. empresas NO tiene columna "creado_by"/"creada_por" (ver schema.sql):
  -- moneda/iva_pct/propina_pct/config/creada_en toman sus DEFAULT de la tabla.
  -- El trigger trg_nueva_cuota (002) SIEMBRA public.limites automáticamente ⇒ NO lo creamos acá.
  insert into public.empresas (nombre, codigo)
  values (v_nombre_emp, v_codigo)
  returning id into v_emp;

  -- El registrante es ADMIN de su propia empresa.
  insert into public.membresias (empresa_id, user_id, rol)
  values (v_emp, NEW.id, 'admin')
  on conflict (empresa_id, user_id) do nothing;

  -- Semilla de salón: UNA zona "Salón" con 8 mesas "1".."8", capacidad 4, en una
  -- rejilla 4×2 dentro del lienzo normalizado 1000×600 (tamaños >= 60, igual que
  -- SalonPage.jsx: const W=1000, H=600, TAM_MIN=60). Celdas de 250×300, mesa de 110.
  insert into public.zonas (empresa_id, nombre, orden)
  values (v_emp, 'Salón', 1)
  returning id into v_zona;

  insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad)
  select v_emp, v_zona, gs.n::text,
         70 + ((gs.n - 1) % 4) * 250,   -- columnas: 70, 320, 570, 820 (x+w <= 930 <= 1000)
         95 + ((gs.n - 1) / 4) * 300,   -- filas:    95, 395          (y+h <= 505 <= 600)
         110, 110, 'cuadrada', 4
    from generate_series(1, 8) as gs(n);

  -- Auditoría del alta (si 002 está aplicada). private.auditar deja actor = auth.uid(),
  -- que acá es NULL (aún no hay sesión); guardamos el id del nuevo usuario en el detalle.
  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'alta_empresa',
      jsonb_build_object('usuario', NEW.id::text,
                         'correo',  coalesce(NEW.email, ''),
                         'codigo',  v_codigo));
  end if;

  return NEW;
end $fn$;

-- Los triggers no necesitan GRANT: se revoca todo para que nadie la invoque como RPC.
revoke all on function private.registrar_empresa_del_registrado() from public, anon, authenticated;

drop trigger if exists trg_alta_empresa_registrado on auth.users;
create trigger trg_alta_empresa_registrado
  after insert on auth.users
  for each row execute function private.registrar_empresa_del_registrado();


-- ----------------------------------------------------------------------------
-- 2) EQUIPO · LISTAR (solo admin de la empresa activa)
-- ----------------------------------------------------------------------------
create or replace function public.equipo_listar()
returns table (usuario_id uuid, nombre text, correo text, rol text, creado_en timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  perform private.exigir_rol(array['admin']::text[]);
  v_emp := private.empresa_activa();

  return query
    select m.user_id,
           coalesce(p.display_name, ''),
           -- auth.users.email es character varying: plpgsql rechaza varchar en una
           -- columna declarada text (ERROR 42804), así que se funde explícitamente.
           coalesce(u.email::text, ''),
           m.rol,
           m.creada_en
      from public.membresias m
      join auth.users u on u.id = m.user_id
      left join public.perfiles p on p.user_id = m.user_id
     where m.empresa_id = v_emp
     order by m.rol, coalesce(p.display_name, '');
end $fn$;

revoke all on function public.equipo_listar() from public, anon;
grant execute on function public.equipo_listar() to authenticated;


-- ----------------------------------------------------------------------------
-- 3) EQUIPO · INVITAR (alta directa en auth.users, espejo de super_importar_empresa)
--    Crea auth.users (confirmado, clave bcrypt coste 10, columnas de token en '' y
--    NUNCA NULL — ver nota 002 l.515), su identity, perfiles y la membresía.
--    NO pone alta_empresa en la metadata ⇒ el trigger de arriba no crea empresa.
-- ----------------------------------------------------------------------------
create or replace function public.equipo_invitar(
  p_nombre text,
  p_correo text,
  p_rol    text,
  p_clave  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_email text;
  v_new   uuid;
begin
  perform private.exigir_rol(array['admin']::text[]);
  v_emp := private.empresa_activa();

  if coalesce(p_rol, '') not in ('admin','cajero','mesero') then
    raise exception 'El rol debe ser admin, cajero o mesero';
  end if;

  v_email := lower(trim(coalesce(p_correo, '')));
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'El correo no es válido';
  end if;

  if coalesce(p_clave, '') = '' or length(p_clave) < 4 then
    raise exception 'La clave debe tener al menos 4 caracteres';
  end if;

  -- Duplicado dentro de la empresa activa (mismo miembro dos veces).
  if exists (select 1 from public.membresias m
                join auth.users u on u.id = m.user_id
               where m.empresa_id = v_emp and lower(u.email) = v_email) then
    raise exception 'equipo_correo_tomado: ese correo ya es miembro de esta empresa'
      using errcode = '23505';
  end if;

  -- Correo ya registrado en la plataforma (auth.users es global).
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'equipo_correo_tomado: ese correo ya tiene una cuenta'
      using errcode = '23505';
  end if;

  v_new := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token,
                          email_change, email_change_token_new, email_change_token_current,
                          phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_new, 'authenticated', 'authenticated',
          v_email, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
          now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', coalesce(p_nombre, '')),   -- sin alta_empresa
          '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_new, v_new::text, 'email',
          jsonb_build_object('sub', v_new::text, 'email', v_email, 'email_verified', true),
          now(), now(), now());

  -- handle_new_user ya creó el perfiles; esto asegura el nombre y es idempotente.
  insert into public.perfiles (user_id, display_name)
  values (v_new, coalesce(p_nombre, ''))
  on conflict (user_id) do update set display_name = excluded.display_name;

  insert into public.membresias (empresa_id, user_id, rol)
  values (v_emp, v_new, p_rol)
  on conflict (empresa_id, user_id) do nothing;

  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'equipo_invito',
      jsonb_build_object('usuario', v_new::text, 'correo', v_email, 'rol', p_rol));
  end if;

  return v_new;
end $fn$;

revoke all on function public.equipo_invitar(text, text, text, text) from public, anon;
grant execute on function public.equipo_invitar(text, text, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 4) EQUIPO · RESTABLECER CLAVE (solo miembros de la empresa activa; no se fía del uuid)
--    Limpia las columnas de verificación/confirmación de GoTrue (a '' y no NULL) y
--    confirma el email para que el usuario pueda iniciar sesión de inmediato.
-- ----------------------------------------------------------------------------
create or replace function public.equipo_restablecer(
  p_usuario_id uuid,
  p_clave      text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  perform private.exigir_rol(array['admin']::text[]);
  v_emp := private.empresa_activa();

  if coalesce(p_clave, '') = '' or length(p_clave) < 4 then
    raise exception 'La clave debe tener al menos 4 caracteres';
  end if;

  if p_usuario_id is null or not exists (select 1 from public.membresias m
                                          where m.empresa_id = v_emp and m.user_id = p_usuario_id) then
    raise exception 'El usuario no es miembro de la empresa activa';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
         email_confirmed_at = now(),
         confirmation_token = '',
         recovery_token = '',
         email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         phone_change = '',
         phone_change_token = '',
         reauthentication_token = '',
         updated_at = now()
   where id = p_usuario_id;

  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'equipo_restablecio_clave',
      jsonb_build_object('usuario', p_usuario_id::text));
  end if;

  return true;
end $fn$;

revoke all on function public.equipo_restablecer(uuid, text) from public, anon;
grant execute on function public.equipo_restablecer(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 5) EQUIPO · REVOCAR miembro de la empresa activa.
--    Quita su membresía y, si se queda sin empresa, borra su auth.users (cascade).
--    Guardas: no a uno mismo; no dejar la empresa sin admins; no tocar a quien no
--    es miembro de la empresa activa; nunca borrar a un super de la plataforma.
-- ----------------------------------------------------------------------------
create or replace function public.equipo_revocar(
  p_usuario_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_rol   text;
  v_admins integer;
begin
  perform private.exigir_rol(array['admin']::text[]);
  v_emp := private.empresa_activa();

  if p_usuario_id is null then
    raise exception 'Falta el usuario a revocar';
  end if;

  if p_usuario_id = auth.uid() then
    raise exception 'No puedes revocar tu propio acceso';
  end if;

  -- Nunca borrar a un administrador de la plataforma (su fila en supers).
  if to_regclass('public.supers') is not null
     and exists (select 1 from public.supers s where s.user_id = p_usuario_id) then
    raise exception 'No se puede revocar a un administrador de la plataforma';
  end if;

  -- Solo miembros de la empresa activa (no se fía del uuid: evita tocar otras empresas).
  if not exists (select 1 from public.membresias m
                  where m.empresa_id = v_emp and m.user_id = p_usuario_id) then
    raise exception 'El usuario no es miembro de la empresa activa';
  end if;

  select m.rol into v_rol from public.membresias m
   where m.empresa_id = v_emp and m.user_id = p_usuario_id;

  -- No dejar la empresa con cero admins.
  if v_rol = 'admin' then
    select count(*) into v_admins from public.membresias
     where empresa_id = v_emp and rol = 'admin';
    if v_admins <= 1 then
      raise exception 'Debe quedar al menos un administrador en la empresa';
    end if;
  end if;

  delete from public.membresias
   where empresa_id = v_emp and user_id = p_usuario_id;

  -- Si ya no pertenece a NINGUNA empresa, eliminar su cuenta (cascade borra perfiles e
  -- identidades). Las FK de negocio (cuentas.abierta_por, pagos.creada_por, ...) son
  -- ON DELETE NO ACTION: si el miembro tiene histórico, el delete falla ⇒ se captura y
  -- se le deja SIN membresías (queda desacoplado, ya no puede acceder a nada).
  if not exists (select 1 from public.membresias m where m.user_id = p_usuario_id) then
    begin
      delete from auth.users where id = p_usuario_id;
    exception when foreign_key_violation then
      null;   -- tiene histórico de negocio: se mantiene la cuenta, sin accesos
    end;
  end if;

  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'equipo_revoco',
      jsonb_build_object('usuario', p_usuario_id::text));
  end if;

  return true;
end $fn$;

revoke all on function public.equipo_revocar(uuid) from public, anon;
grant execute on function public.equipo_revocar(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 6) SUPER · RESETEAR CLAVE de cualquier usuario (dueño de la plataforma).
--    Requiere public.es_super() y NO se acota a la empresa activa (actúa cross-tenant).
--    Mismo tratamiento de columnas que equipo_restablecer, y deja rastro en auditoría.
-- ----------------------------------------------------------------------------
create or replace function public.super_resetear_clave(
  p_usuario_id uuid,
  p_clave      text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_super() then
    raise exception 'requiere super';
  end if;

  if coalesce(p_clave, '') = '' or length(p_clave) < 4 then
    raise exception 'La clave debe tener al menos 4 caracteres';
  end if;

  if p_usuario_id is null or not exists (select 1 from auth.users u where u.id = p_usuario_id) then
    raise exception 'El usuario no existe';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
         email_confirmed_at = now(),
         confirmation_token = '',
         recovery_token = '',
         email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         phone_change = '',
         phone_change_token = '',
         reauthentication_token = '',
         updated_at = now()
   where id = p_usuario_id;

  if to_regclass('public.auditoria') is not null then
    perform private.auditar(null, 'super_reset_clave',
      jsonb_build_object('usuario', p_usuario_id::text));
  end if;

  return true;
end $fn$;

revoke all on function public.super_resetear_clave(uuid, text) from public, anon;
grant execute on function public.super_resetear_clave(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7) Verificación (en el SQL Editor auth.uid() es NULL ⇒ solo contados/.existencias).
-- ----------------------------------------------------------------------------
select 'funcion' as objeto, p.proname as nombre
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','private')
   and p.proname in ('registrar_empresa_del_registrado','equipo_listar','equipo_invitar',
                     'equipo_restablecer','equipo_revocar','super_resetear_clave')
 order by p.proname;

select 'trigger' as objeto, tgname as nombre
  from pg_trigger
 where tgname = 'trg_alta_empresa_registrado' and not tgisinternal;
