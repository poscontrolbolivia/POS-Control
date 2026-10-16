-- ============================================================================
-- migraciones/002_seguridad.sql · Paridad de seguridad con Catering Control
-- Idempotente. Orden de aplicación en una base nueva:
--   schema.sql  →  001_super.sql  →  002_seguridad.sql  (pegar en SQL Editor)
-- Requiere 001 (usa public.es_super() y public.supers).
--
-- Qué añade
--   1) Que un super pueda ENTRAR de verdad en otra empresa (fijar_empresa + mi_rol).
--   2) CUOTA OCULTA de artículos por empresa (default 30) exigida en el servidor,
--      en la base, vía trigger: el cliente no puede saltarla editando la app.
--   3) Miniaturas de artículos: columna imagen_path + bucket + políticas de Storage.
--   4) Auditoría de accesos privilegiados (tabla sin GRANT: invisible por API).
--   5) Throttle anti-fuerza-bruta de códigos de empresa (empresa_por_codigo).
--   6) Hardening de permisos en las funciones nuevas (revoke public + grant exacto).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) AUDITORÍA (antes que todo: las funciones de abajo la escriben)
--    Tabla SIN políticas y SIN grants: PostgREST no la expone, nadie la lee por
--    API. Solo se consulta con super_listar_auditoria() (security definer).
-- ----------------------------------------------------------------------------
create table if not exists public.auditoria (
  id         bigint generated always as identity primary key,
  empresa_id uuid,
  actor      uuid,
  accion     text not null,
  detalle    jsonb not null default '{}'::jsonb,
  en         timestamptz not null default now()
);
alter table public.auditoria enable row level security;
alter table public.auditoria force row level security;   -- ni el dueño accidental
revoke all on table public.auditoria from public, anon, authenticated;

create index if not exists idx_auditoria_empresa_en on public.auditoria (empresa_id, en desc);

-- private.auditar(): único punto de escritura. SECURITY DEFINER (dueño postgres) ⇒ bypassea
-- el deny-all de la tabla, que es justo lo que queremos: escribir sí, leer por API no.
create or replace function private.auditar(
  p_empresa uuid,
  p_accion  text,
  p_detalle jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.auditoria (empresa_id, actor, accion, detalle)
  values (p_empresa, auth.uid(), p_accion, coalesce(p_detalle, '{}'::jsonb));
end $fn$;
revoke all on function private.auditar(uuid, text, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1) SUPER: ENTRAR en cualquier empresa
--    - private.fijar_empresa(): hoy exige membresía ⇒ todo RPC de negocio fallaba
--      para un super que pulsaba "Entrar" (error: «no tiene membresía en la empresa»).
--    - private.mi_rol(): devolvía NULL para un super ⇒ las políticas de escritura
--      (es_admin()/exigir_rol) lo rechazaban aunque viera los datos.
--    - public.fijar_empresa(): fija el GUC de SESIÓN (necesita el header
--      X-Session-Id en el cliente, ver src/services/supabase.js) y ahora audita.
-- ----------------------------------------------------------------------------
create or replace function private.fijar_empresa(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v uuid;
begin
  v := coalesce(p_empresa_id, private.empresa_activa());
  if v is null then
    raise exception 'empresa no seleccionada: pase p_empresa_id o defina app.empresa_id';
  end if;
  if not exists (select 1 from public.empresas e where e.id = v) then
    raise exception 'empresa inexistente';
  end if;
  -- miembro normal, o dueño de la plataforma (001_super) operando otra empresa.
  if not (exists (select 1 from public.membresias m
                  where m.empresa_id = v and m.user_id = auth.uid())
          or private.es_super_compat()) then
    raise exception 'el usuario actual no tiene membresía en la empresa %', v;
  end if;
  perform set_config('app.empresa_id', v::text, true);
  return v;
end $fn$;

create or replace function private.mi_rol()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  -- empresa_activa() ya validó que el que pide es miembro o super; si es super sin
  -- membresía, su rol efectivo en esa empresa es admin (solo puede serlo por RLS).
  select coalesce(
    (select m.rol
       from public.membresias m
      where m.empresa_id = private.empresa_activa()
        and m.user_id = auth.uid()
      limit 1),
    case when private.es_super_compat()
          and private.empresa_activa() is not null
         then 'admin' end
  );
$fn$;

drop function if exists public.fijar_empresa(uuid);
create or replace function public.fijar_empresa(p_empresa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then raise exception 'sin sesion'; end if;
  if p_empresa is null or not exists (select 1 from public.empresas e where e.id = p_empresa) then
    raise exception 'empresa inexistente';
  end if;
  if not (exists (select 1 from public.membresias m
                  where m.empresa_id = p_empresa and m.user_id = auth.uid())
          or public.es_super()) then
    raise exception 'no pertenece a esa empresa';
  end if;
  -- false ⇒ GUC de SESIÓN (no de transacción): lo aguanta la conexión pinzada por
  -- X-Session-Id, y así los SELECT directos de mesas/cuentas/turnos ven la empresa.
  perform set_config('app.empresa_id', p_empresa::text, false);
  if public.es_super() then
    perform private.auditar(p_empresa, 'super_entro',
                            jsonb_build_object('empresa', p_empresa::text));
  end if;
end $fn$;
revoke all on function public.fijar_empresa(uuid) from public, anon;
grant execute on function public.fijar_empresa(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) CUOTA OCULTA DE ARTÍCULOS (plan gratuito = 30 artículos por defecto)
--    El número vive en public.limites, tabla SIN grants ni políticas: el comercio
--    NO puede leer su cuota ni cambiarla; solo choca con el límite al crear el
--    artículo 31 y recibe el mensaje de suscripción. Se exige en el servidor con
--    un trigger porque el catálogo se escribe por INSERT directo (políticas
--    productos_insert), no por RPC.
-- ----------------------------------------------------------------------------
create table if not exists public.limites (
  empresa_id      uuid primary key references public.empresas(id) on delete cascade,
  max_productos   integer,                              -- NULL = sin límite
  plan            text not null default 'gratis' check (plan in ('gratis','pago')),
  notas           text,                                 -- nota interna del super
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);
alter table public.limites enable row level security;
alter table public.limites force row level security;
revoke all on table public.limites from public, anon, authenticated;

-- toda empresa existente (y las futuras) nace con 30 artículos del plan gratis.
insert into public.limites (empresa_id, max_productos, plan)
select e.id, 30, 'gratis' from public.empresas e
on conflict (empresa_id) do nothing;

-- Y las que se creen después (registro desde la app, importación de un respaldo):
-- trigger en empresas ⇒ SIEMPRE hay fila de cuota, aunque el alta venga de un
-- super_importar_empresa (security definer, role postgres ⇒ pasa el deny-all de limites).
create or replace function private.nueva_cuota_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.limites (empresa_id, max_productos, plan)
  values (new.id, 30, 'gratis')
  on conflict (empresa_id) do nothing;
  return new;
end $fn$;
revoke all on function private.nueva_cuota_empresa() from public, anon, authenticated;

drop trigger if exists trg_nueva_cuota on public.empresas;
create trigger trg_nueva_cuota
  after insert on public.empresas
  for each row execute function private.nueva_cuota_empresa();

create or replace function private.productos_permitidos(p_empresa uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.max_productos from public.limites l where l.empresa_id = p_empresa;
$fn$;
revoke all on function private.productos_permitidos(uuid) from public, anon, authenticated;

create or replace function private.controlar_cuota_productos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_max integer;
  v_hay integer;
begin
  -- el dueño de la plataforma importa/exporta datos de prueba sin tope.
  if private.es_super_compat() then
    return new;
  end if;
  v_max := private.productos_permitidos(new.empresa_id);
  if v_max is null then
    return new;                                   -- sin límite (plan de pago)
  end if;
  if not coalesce(new.activo, true) then
    return new;                                   -- dar de baja nunca se bloquea
  end if;
  if tg_op = 'UPDATE' and coalesce(old.activo, true) = coalesce(new.activo, true) then
    return new;                                   -- cambiar precio/nombre/foto no cuenta
  end if;
  select count(*) into v_hay
    from public.productos
   where empresa_id = new.empresa_id and activo;
  if v_hay >= v_max then
    raise exception 'El plan gratuito permite % artículos como máximo. Para tener más artículos, solicite el plan de pagos.', v_max
      using errcode = '22000';
  end if;
  return new;
end $fn$;
revoke all on function private.controlar_cuota_productos() from public, anon, authenticated;

drop trigger if exists trg_controlar_cuota on public.productos;
create trigger trg_controlar_cuota
  before insert or update on public.productos
  for each row execute function private.controlar_cuota_productos();

-- RPC del super para ajustar la cuota (oculta para los comercios).
create or replace function public.super_ajustar_empresa(
  p_empresa       uuid,
  p_max_productos integer default null,
  p_plan          text default null,
  p_notas         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_plan text := coalesce(p_plan,
                          (select l.plan from public.limites l where l.empresa_id = p_empresa),
                          'gratis');
  v_max  integer := case
    when p_max_productos is not null then p_max_productos
    when coalesce(p_plan, v_plan) = 'pago' then null
    else coalesce((select l.max_productos from public.limites l where l.empresa_id = p_empresa), 30)
  end;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_empresa is null or not exists (select 1 from public.empresas e where e.id = p_empresa) then
    raise exception 'empresa inexistente';
  end if;
  if v_plan not in ('gratis','pago') then raise exception 'plan inválido'; end if;
  if p_max_productos is not null and p_max_productos < 1 then
    raise exception 'el máximo de artículos debe ser 1 o más (NULL = sin límite)';
  end if;

  insert into public.limites (empresa_id, max_productos, plan, notas, actualizado_en, actualizado_por)
  values (p_empresa, v_max, v_plan, p_notas, now(), auth.uid())
  on conflict (empresa_id) do update
    set max_productos  = excluded.max_productos,
        plan           = excluded.plan,
        notas          = coalesce(excluded.notas, limites.notas),
        actualizado_en = now(),
        actualizado_por = excluded.actualizado_por;
  perform private.auditar(p_empresa, 'super_ajustar_cuota',
    jsonb_build_object('max_productos', v_max, 'plan', v_plan));
  return jsonb_build_object('max_productos', v_max, 'plan', v_plan);
end $fn$;
revoke all on function public.super_ajustar_empresa(uuid, integer, text, text) from public, anon;
grant execute on function public.super_ajustar_empresa(uuid, integer, text, text) to authenticated;

-- Lectura de cuota para el panel del super (nunca para el comercio).
create or replace function public.super_ver_cuota(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  return jsonb_build_object(
    'max_productos', (select l.max_productos from public.limites l where l.empresa_id = p_empresa),
    'plan',          (select l.plan from public.limites l where l.empresa_id = p_empresa),
    'notas',         (select l.notas from public.limites l where l.empresa_id = p_empresa),
    'productos_actuales', (select count(*) from public.productos p
                          where p.empresa_id = p_empresa and p.activo)
  );
end $fn$;
revoke all on function public.super_ver_cuota(uuid) from public, anon;
grant execute on function public.super_ver_cuota(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) MINIATURAS DE ARTÍCULOS (se muestran a 45×45; el límite de peso está en el
--    bucket, el formato en la política y la forma de la ruta en un CHECK).
-- ----------------------------------------------------------------------------
alter table public.productos add column if not exists imagen_path text;
alter table public.productos drop constraint if exists productos_imagen_path_fmt;
alter table public.productos add constraint productos_imagen_path_fmt check (
  imagen_path is null
  or imagen_path ~ '^productos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
);

-- Bucket público de miniaturas. Se crea por SQL (idempotente) para que una
-- instalación nueva no dependa de clicks en el dashboard.
insert into storage.buckets (id, name, public)
values ('pos-imagenes', 'pos-imagenes', true)
on conflict (id) do update set public = true;

-- Límites del bucket: columnas que no existen en todas las versiones de Storage
-- ⇒ bloque de excepción (un DDL desconocido no puede tumbar la migración).
do $do$ begin
  update storage.buckets
     set file_size_limit = 209715,                       -- 200 KB por archivo
         allowed_mime_types = array['image/webp','image/jpeg']
   where id = 'pos-imagenes';
exception when others then
  raise notice 'pos-imagenes: file_size_limit/allowed_mime_types no aplicables (%); el límite queda solo en las políticas', sqlerrm;
end $do$;

drop policy if exists "pos_imagenes_insert" on storage.objects;
create policy "pos_imagenes_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pos-imagenes'
  and name ~ '^productos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
  -- el 2º segmento de la ruta debe ser UNA EMPRESA DEL USUARIO (o del super).
  -- se comparó por id::text para no castear basura de un header/path manipulable.
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);

drop policy if exists "pos_imagenes_select" on storage.objects;
-- ★ SIN esta política el alta SIEMPRE falla (42501 «new row violates row-level security
--   policy for table "objects"»), incluso con `with check (true)`: el servicio de Storage
--   hace INSERT … ON CONFLICT DO UPDATE … RETURNING, y una fila insertada bajo una
--   política FOR INSERT que no es visible por ninguna política SELECT no puede
--   devolverse. Comprobado en vivo en este proyecto (FOR INSERT solo = falla;
--   FOR INSERT + FOR SELECT = OK; FOR ALL = OK).
create policy "pos_imagenes_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'pos-imagenes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);

drop policy if exists "pos_imagenes_update" on storage.objects;
create policy "pos_imagenes_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'pos-imagenes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
)
with check (
  bucket_id = 'pos-imagenes'
  and name ~ '^productos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);

drop policy if exists "pos_imagenes_delete" on storage.objects;
create policy "pos_imagenes_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'pos-imagenes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);
--LECTURA: bucket público ⇒ se sirve por /storage/v1/object/public/... sin política.
-- Son miniaturas de 45x45 de un menú: no hay dato personal, y si lo hubiera basta
-- con quitar `public` y añadir una política de select por empresa.

-- ----------------------------------------------------------------------------
-- 4) THROTTLE ANTI-FUERZA-BRUTA de códigos de empresa
--    empresa_por_codigo es el único endpoint pre-login que revela si un código
--    existe. Regla: 30 consultas por IP en 10 minutos; al pasarse devuelve 0 filas
--    (INDISTINGUIBLE de un código equivocado ⇒ no ayuda a enumerar empresas) en vez de
--    lanzar error, porque el error abortaría la transacción y el contador nunca
--    se guardaría.
-- ----------------------------------------------------------------------------
create table if not exists public.throttle (
  clave    text primary key,
  intentos integer not null default 0,
  hasta    timestamptz not null default now()
);
alter table public.throttle enable row level security;
alter table public.throttle force row level security;
revoke all on table public.throttle from public, anon, authenticated;

create or replace function private.throttle_ok(
  p_prefijo text,
  p_max     integer,
  p_ventana interval default interval '10 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ip    text;
  v_clave text;
  v_n     integer;
  v_hasta timestamptz;
begin
  begin
    v_ip := split_part(nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then
    v_ip := null;
  end;
  v_ip := nullif(trim(coalesce(v_ip, '')), '');
  if v_ip is null then v_ip := 'sin-ip'; end if;      -- todos comparten bolsa: degradativo, no peligroso
  v_clave := p_prefijo || ':' || v_ip;

  select intentos, hasta into v_n, v_hasta
    from public.throttle where clave = v_clave for update;
  if not found then
    insert into public.throttle (clave, intentos, hasta) values (v_clave, 1, now() + p_ventana);
    return true;
  end if;
  if v_hasta < now() then
    update public.throttle set intentos = 1, hasta = now() + p_ventana where clave = v_clave;
    return true;
  end if;
  if v_n >= p_max then
    perform private.auditar(null, 'throttle_agotado', jsonb_build_object('clave', v_clave));
    return false;
  end if;
  update public.throttle set intentos = v_n + 1 where clave = v_clave;
  return true;
end $fn$;
revoke all on function private.throttle_ok(text, integer, interval) from public, anon, authenticated;

create or replace function public.empresa_por_codigo(p_codigo text)
returns table (id uuid, nombre text, moneda text)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_codigo is null or length(trim(p_codigo)) < 3 then
    return;                                          -- sin filas y sin ruido
  end if;
  if not private.throttle_ok('cod', 30) then
    return;                                          -- codeado por throttle: mismo vacío
  end if;
  return query
    select e.id, e.nombre, e.moneda
      from public.empresas e
     where e.codigo is not null and lower(e.codigo) = lower(trim(p_codigo));
end $fn$;
revoke all on function public.empresa_por_codigo(text) from public;
grant execute on function public.empresa_por_codigo(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) AUDITORÍA legible solo por el super
-- ----------------------------------------------------------------------------
create or replace function public.super_listar_auditoria(
  p_empresa uuid default null,
  p_limite  integer default 200
)
returns table (en timestamptz, actor uuid, accion text, detalle jsonb, empresa_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  return query
    select a.en, a.actor, a.accion, a.detalle, a.empresa_id
      from public.auditoria a
     where (p_empresa is null or a.empresa_id = p_empresa)
     order by a.en desc
     limit greatest(1, least(coalesce(p_limite, 200), 1000));
end $fn$;
revoke all on function public.super_listar_auditoria(uuid, integer) from public, anon;
grant execute on function public.super_listar_auditoria(uuid, integer) to authenticated;

-- Registro de exportaciones (el panel lo llama tras descargar el .json): deja
-- prueba de QUÉ empresa salió de la plataforma y cuándo.
create or replace function public.super_registrar_exporte(p_empresa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  perform private.auditar(p_empresa, 'super_exporto',
                          jsonb_build_object('empresa', p_empresa::text));
end $fn$;
revoke all on function public.super_registrar_exporte(uuid) from public, anon;
grant execute on function public.super_registrar_exporte(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) SUPER IMPORTAR: redefinido sobre el de 001_super.sql, con 3 arreglos.
--    a) auth.users con las columnas de token en '' y NO NULL: con NULL, GoTrue
--       falla al iniciar sesión ('Database error querying schema') y el usuario
--       importado nunca puede entrar.
--    b) bcrypt con coste 10 vía extensions.gen_salt('bf', 10): GoTrue solo acepta
--       hashes de ese formato en este proyecto.
--    c) auditoría de la importación + validación de roles.
-- ----------------------------------------------------------------------------
create or replace function public.super_importar_empresa(
  p_datos        jsonb,
  p_codigo       text,
  p_clave_inicial text default 'pos12345'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_empresa   uuid := gen_random_uuid();
  v_empresa_o uuid;
  v_codigo    text := lower(btrim(coalesce(p_codigo, '')));
  v_ingeniero uuid := auth.uid();
  e           jsonb;
  s           jsonb;
  z           jsonb;
  p           jsonb;
  u           jsonb;
  r           jsonb;
  v_seccion   uuid;
  v_zona      uuid;
  v_usuario   uuid;
  v_rol       text;
  v_nuevos    int := 0;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'snapshot inválido: falta la información de la empresa';
  end if;
  if v_codigo = '' then raise exception 'Falta el código de la empresa'; end if;

  -- La empresa del snapshot ya existe en esta base → se reusa (importar encima).
  v_empresa_o := nullif(p_datos#>>'{empresa,id}', '')::uuid;
  if v_empresa_o is not null then
    select id into v_empresa from public.empresas where id = v_empresa_o;
    if v_empresa is null then
      select id into v_empresa from public.empresas where codigo = v_codigo;
    end if;
  else
    select id into v_empresa from public.empresas where codigo = v_codigo;
  end if;

  if v_empresa is null then
    insert into public.empresas (id, nombre, codigo, moneda, iva_pct, propina_pct, config)
    values (v_empresa,
            coalesce(p_datos#>>'{empresa,nombre}', 'Importada'),
            v_codigo,
            coalesce(p_datos#>>'{empresa,moneda}', 'BOB'),
            coalesce((p_datos#>>'{empresa,ivaPct}')::numeric, 3),
            coalesce((p_datos#>>'{empresa,propinaPct}')::numeric, 0),
            coalesce(p_datos#'{"empresa","config"}', '{}'::jsonb));
  else
    update public.empresas
       set nombre       = coalesce(p_datos#>>'{empresa,nombre}', nombre),
           moneda       = coalesce(p_datos#>>'{empresa,moneda}', moneda),
           iva_pct      = coalesce((p_datos#>>'{empresa,ivaPct}')::numeric, iva_pct),
           propina_pct  = coalesce((p_datos#>>'{empresa,propinaPct}')::numeric, propina_pct),
           config       = coalesce(p_datos#'{"empresa","config"}', config)
     where id = v_empresa;
  end if;

  private.fijar_empresa(v_empresa, v_ingeniero);

  -- Secciones
  for s in select * from jsonb_array_elements(coalesce(p_datos->'secciones', '[]'::jsonb))
  loop
    select id into v_seccion from public.secciones_menu
     where empresa_id = v_empresa and coalesce(nombre, '') = coalesce(s->>'nombre', '___sin_nombre___');
    if v_seccion is null then
      v_seccion := gen_random_uuid();
      insert into public.secciones_menu (id, empresa_id, nombre, orden, activo)
      values (v_seccion, v_empresa, coalesce(s->>'nombre', 'Sección'),
              coalesce((s->>'orden')::int, 0), coalesce((s->>'activo')::bool, true));
    end if;
    s := jsonb_set(s, '{_id}', to_jsonb(v_seccion));
  end loop;

  -- Zonas del salón
  for z in select * from jsonb_array_elements(coalesce(p_datos->'zonas', '[]'::jsonb))
  loop
    select id into v_zona from public.zonas
     where empresa_id = v_empresa and coalesce(nombre, '') = coalesce(z->>'nombre', '___sin_nombre___');
    if v_zona is null then
      v_zona := gen_random_uuid();
      insert into public.zonas (id, empresa_id, nombre, orden)
      values (v_zona, v_empresa, coalesce(z->>'nombre', 'Zona'), coalesce((z->>'orden')::int, 0));
    end if;
    z := jsonb_set(z, '{_id}', to_jsonb(v_zona));
  end loop;

  -- Artículos (el super está exento del control de cuota del trigger)
  for p in select * from jsonb_array_elements(coalesce(p_datos->'productos', '[]'::jsonb))
  loop
    if not exists (select 1 from public.productos
                    where empresa_id = v_empresa and coalesce(nombre, '') = coalesce(p->>'nombre', '___sin_nombre___')) then
      insert into public.productos (id, empresa_id, seccion_id, nombre, precio, activo, imagen_path)
      values (gen_random_uuid(), v_empresa, (p->>'_seccion_id')::uuid,
              coalesce(p->>'nombre', 'Artículo'), coalesce((p->>'precio')::numeric, 0),
              coalesce((p->>'activo')::bool, true), null);
      v_nuevos := v_nuevos + 1;
    end if;
  end loop;

  -- Mesas
  for r in select * from jsonb_array_elements(coalesce(p_datos->'mesas', '[]'::jsonb))
  loop
    if not exists (select 1 from public.mesas
                    where empresa_id = v_empresa
                      and coalesce(numero::text, '') = coalesce(r->>'numero', '___sin_numero___')) then
      insert into public.mesas (id, empresa_id, zona_id, numero, capacidad, x, y, estado)
      values (gen_random_uuid(), v_empresa, (r->>'_zona_id')::uuid,
              coalesce((r->>'numero')::int, 1), coalesce((r->>'capacidad')::int, 4),
              coalesce((r->>'x')::int, 0), coalesce((r->>'y')::int, 0), 'libre');
    end if;
  end loop;

  -- Usuarios: recrea auth.users con las columnas de token en '' (no NULL).
  for u in select * from jsonb_array_elements(coalesce(p_datos->'usuarios', '[]'::jsonb))
  loop
    v_rol := lower(coalesce(u->>'rol', 'cajero'));
    if v_rol not in ('admin', 'cajero', 'mesero') then v_rol := 'cajero'; end if;
    v_usuario := nullif(u->>'id', '')::uuid;
    if v_usuario is null then v_usuario := gen_random_uuid(); end if;

    if not exists (select 1 from auth.users where id = v_usuario) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at,
                              raw_app_meta_data, raw_user_meta_data,
                              confirmation_token, recovery_token,
                              email_change, email_change_token_new, email_change_token_current,
                              phone_change, phone_change_token, reauthentication_token)
      values ('00000000-0000-0000-0000-000000000000', v_usuario, 'authenticated', 'authenticated',
              lower(btrim(u->>'email')),
              extensions.crypt(coalesce(nullif(p_clave_inicial, ''), 'pos12345'),
                               extensions.gen_salt('bf', 10)),
              now(), now(), now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('nombre', coalesce(u->>'nombre', '')),
              '', '', '', '', '', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_usuario, v_usuario::text, 'email',
              jsonb_build_object('sub', v_usuario::text, 'email', lower(btrim(u->>'email'))),
              now(), now(), now());
    end if;

    insert into public.membresias (empresa_id, usuario_id, rol)
    values (v_empresa, v_usuario, v_rol)
    on conflict (empresa_id, usuario_id) do update set rol = excluded.rol;
  end loop;

  perform private.auditar(v_empresa, 'super_importo',
    jsonb_build_object('codigo', v_codigo, 'empresa', v_empresa::text, 'articulos_nuevos', v_nuevos));
  return v_empresa;
end $fn$;
revoke all on function public.super_importar_empresa(jsonb, text, text) from public, anon;
grant execute on function public.super_importar_empresa(jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7) Verificación (auth.uid() es NULL en el SQL Editor ⇒ solo contados)
-- ----------------------------------------------------------------------------
select 'limites' as objeto, count(*) as filas from public.limites
union all select 'throttle', count(*) from public.throttle
union all select 'auditoria', count(*) from public.auditoria
union all select 'columna_imagen', count(*)::bigint from information_schema.columns
   where table_schema='public' and table_name='productos' and column_name='imagen_path'
union all select 'triggers_productos', count(*)::bigint from pg_trigger t
   where t.tgrelid = 'public.productos'::regclass and not t.tgisinternal
union all select 'politicas_storage', count(*)::bigint from pg_policies
   where schemaname='storage' and tablename='objects' and policyname like 'pos_imagenes%'
union all select 'bucket', count(*)::bigint from storage.buckets where id='pos-imagenes';
