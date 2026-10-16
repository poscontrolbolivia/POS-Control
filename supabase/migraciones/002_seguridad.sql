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
-- 6) EXPORTAR / IMPORTAR SIN PÉRDIDAS — redefinidos sobre 001_super.sql.
--    a) auth.users con las columnas de token en '' y NO NULL: con NULL GoTrue
--       responde 500 "Database error querying schema" y ningún usuario importado
--       puede iniciar sesión (probado con el correo de pruebas).
--    b) bcrypt con coste 10 explícito: extensions.gen_salt('bf') sin argumento
--       deja hashes que GoTrue rechaza al verificar.
--    c) RESTAURA EL HISTÓRICO (cuentas, sus mesas, items, pagos y turnos de caja).
--       La versión de 001 los exportaba pero NO los importaba: "llevar todos los
--       datos" al pasar a plan de pago incluye lo ya facturado.
--    d) auditoría de la importación y validación de roles.
-- ----------------------------------------------------------------------------

-- El equipo necesita el id del usuario de origen para poder reasignar las cuentas
-- históricas a su autor real (abierta_por / cerrada_por / creada_por).
create or replace function public.super_exportar_empresa(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v jsonb;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  select jsonb_build_object(
    'version', 2,
    'exportado_en', now(),
    'empresa', (select to_jsonb(e) from public.empresas e where e.id = p_empresa),
    'zonas',       coalesce((select jsonb_agg(to_jsonb(z) order by z.orden) from public.zonas z where z.empresa_id = p_empresa), '[]'),
    'mesas',       coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('zona_nombre',
                                      (select z.nombre from public.zonas z where z.id = m.zona_id)))
                                 from public.mesas m where m.empresa_id = p_empresa), '[]'),
    'secciones',   coalesce((select jsonb_agg(to_jsonb(s) order by s.orden) from public.secciones_menu s where s.empresa_id = p_empresa), '[]'),
    'productos',   coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('seccion_nombre', s.nombre)) from public.productos p
                             left join public.secciones_menu s on s.id = p.seccion_id where p.empresa_id = p_empresa), '[]'),
    'cuentas',     coalesce((select jsonb_agg(to_jsonb(c)) from public.cuentas c where c.empresa_id = p_empresa), '[]'),
    'cuenta_mesas',coalesce((select jsonb_agg(to_jsonb(cm)) from public.cuenta_mesas cm
                             join public.cuentas c on c.id = cm.cuenta_id where c.empresa_id = p_empresa), '[]'),
    'cuenta_items',coalesce((select jsonb_agg(to_jsonb(ci)) from public.cuenta_items ci
                             join public.cuentas c on c.id = ci.cuenta_id where c.empresa_id = p_empresa), '[]'),
    'pagos',       coalesce((select jsonb_agg(to_jsonb(pg)) from public.pagos pg
                             join public.cuentas c on c.id = pg.cuenta_id where c.empresa_id = p_empresa), '[]'),
    'turnos',      coalesce((select jsonb_agg(to_jsonb(t)) from public.turnos_caja t where t.empresa_id = p_empresa), '[]'),
    'equipo',      coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'correo', u.email,
                                                                 'rol', m.rol, 'nombre', coalesce(p.display_name,'')))
                             from public.membresias m
                             join auth.users u on u.id = m.user_id
                             left join public.perfiles p on p.user_id = m.user_id
                             where m.empresa_id = p_empresa), '[]')
  ) into v;
  if v->'empresa' is null then raise exception 'empresa inexistente'; end if;
  return v;
end $fn$;
revoke all on function public.super_exportar_empresa(uuid) from public, anon;
grant execute on function public.super_exportar_empresa(uuid) to authenticated;

create or replace function public.super_importar_empresa(
  p_datos         jsonb,
  p_codigo        text,
  p_clave_inicial text default 'pos12345'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  r        jsonb;
  v_new    uuid;
  v_old    uuid;
  v_rol    text;
  v_cuenta uuid;
  v_mesa   uuid;
  v_prod   uuid;
  v_map_zonas     jsonb := '{}'::jsonb;
  v_map_secciones jsonb := '{}'::jsonb;
  v_map_mesas     jsonb := '{}'::jsonb;
  v_map_productos jsonb := '{}'::jsonb;
  v_map_cuentas   jsonb := '{}'::jsonb;
  v_map_users     jsonb := '{}'::jsonb;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_datos is null or jsonb_typeof(p_datos->'empresa') <> 'object'
     or coalesce(p_datos->'empresa'->>'nombre','') = '' then
    raise exception 'snapshot invalido';
  end if;
  if coalesce(trim(p_codigo),'') = '' then raise exception 'Falta el código de la empresa'; end if;
  if exists (select 1 from public.empresas where lower(codigo) = lower(p_codigo)) then
    raise exception 'el codigo % ya existe', p_codigo;
  end if;

  insert into public.empresas (nombre, codigo, moneda, iva_pct, propina_pct, config)
  values (p_datos->'empresa'->>'nombre', lower(p_codigo),
          coalesce(p_datos->'empresa'->>'moneda','Bs'),
          coalesce((p_datos->'empresa'->>'iva_pct')::numeric, 0),
          coalesce((p_datos->'empresa'->>'propina_pct')::numeric, 10),
          coalesce(p_datos->'empresa'->'config', '{}'::jsonb))
  returning id into v_emp;

  -- El trigger trg_nueva_cuota ya sembró public.limites (30 / gratis) para v_emp.

  for r in select * from jsonb_array_elements(coalesce(p_datos->'zonas','[]'::jsonb)) loop
    insert into public.zonas (empresa_id, nombre, orden)
    values (v_emp, coalesce(nullif(r->>'nombre',''),'Zona'), coalesce((r->>'orden')::int, 0))
    returning id into v_new;
    if (r->>'id') is not null then
      v_map_zonas := jsonb_set(v_map_zonas, array[r->>'id'], to_jsonb(v_new));
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'secciones','[]'::jsonb)) loop
    insert into public.secciones_menu (empresa_id, nombre, orden)
    values (v_emp, coalesce(nullif(r->>'nombre',''),'Sección'), coalesce((r->>'orden')::int, 0))
    returning id into v_new;
    if (r->>'id') is not null then
      v_map_secciones := jsonb_set(v_map_secciones, array[r->>'id'], to_jsonb(v_new));
    end if;
  end loop;

  -- Artículos: el super está exento del trigger de cuota, así que un snapshot de
  -- 500 artículos se instala entero aunque la empresa nueva nazca en plan gratis.
  for r in select * from jsonb_array_elements(coalesce(p_datos->'productos','[]'::jsonb)) loop
    v_new := nullif(v_map_secciones->>(r->>'seccion_id'), '')::uuid;
    if v_new is null then
      select s.id into v_new from public.secciones_menu s
       where s.empresa_id = v_emp and s.nombre = (r->>'seccion_nombre') limit 1;
    end if;
    insert into public.productos (empresa_id, seccion_id, nombre, precio, activo)
    values (v_emp, v_new, coalesce(nullif(r->>'nombre',''),'Artículo'),
            coalesce((r->>'precio')::numeric, 0), coalesce((r->>'activo')::boolean, true))
    returning id into v_prod;
    if (r->>'id') is not null then
      v_map_productos := jsonb_set(v_map_productos, array[r->>'id'], to_jsonb(v_prod));
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'mesas','[]'::jsonb)) loop
    v_new := nullif(v_map_zonas->>(r->>'zona_id'), '')::uuid;
    if v_new is null then
      select z.id into v_new from public.zonas z
       where z.empresa_id = v_emp and z.nombre = (r->>'zona_nombre') limit 1;
    end if;
    insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad, activa)
    values (v_emp, v_new, coalesce(nullif(r->>'nombre',''),'Mesa'),
            least(1000, greatest(0, coalesce((r->>'x')::numeric, 0))),
            least(600,  greatest(0, coalesce((r->>'y')::numeric, 0))),
            least(1000, greatest(10, coalesce((r->>'w')::numeric, 100))),
            least(600,  greatest(10, coalesce((r->>'h')::numeric, 100))),
            case when r->>'forma' in ('cuadrada','redonda','rect') then r->>'forma' else 'cuadrada' end,
            coalesce((r->>'capacidad')::int, 4), coalesce((r->>'activa')::boolean, true))
    returning id into v_mesa;
    if (r->>'id') is not null then
      v_map_mesas := jsonb_set(v_map_mesas, array[r->>'id'], to_jsonb(v_mesa));
    end if;
  end loop;

  -- Equipo: recrea auth.users que no existen (confirmados, clave temporal) y mapea
  -- el id de origen para que el histórico conserve a su autor.
  for r in select * from jsonb_array_elements(coalesce(p_datos->'equipo','[]'::jsonb)) loop
    if coalesce(nullif(r->>'correo',''),'') = '' then continue; end if;
    select u.id into v_new from auth.users u
     where lower(u.email) = lower(r->>'correo') limit 1;
    if v_new is null then
      v_new := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at,
                              raw_app_meta_data, raw_user_meta_data,
                              confirmation_token, recovery_token,
                              email_change, email_change_token_new, email_change_token_current,
                              phone_change, phone_change_token, reauthentication_token)
      values ('00000000-0000-0000-0000-000000000000', v_new, 'authenticated', 'authenticated',
              lower(r->>'correo'),
              extensions.crypt(coalesce(nullif(p_clave_inicial,''), 'pos12345'),
                               extensions.gen_salt('bf', 10)),
              now(), now(), now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('display_name', coalesce(r->>'nombre','')),
              '', '', '', '', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_new, v_new::text, 'email',
              jsonb_build_object('sub', v_new::text, 'email', lower(r->>'correo'), 'email_verified', true),
              now(), now(), now());
      insert into public.perfiles (user_id, display_name)
      values (v_new, coalesce(r->>'nombre',''))
      on conflict (user_id) do nothing;
    end if;
    v_rol := case when r->>'rol' in ('admin','cajero','mesero') then r->>'rol' else 'cajero' end;
    insert into public.membresias (empresa_id, user_id, rol)
    values (v_emp, v_new, v_rol)
    on conflict (empresa_id, user_id) do nothing;
    if (r->>'user_id') is not null then
      v_map_users := jsonb_set(v_map_users, array[r->>'user_id'], to_jsonb(v_new));
    end if;
  end loop;

  -- HISTÓRICO · cuentas (una importación no borra el dinero ya cobrado)
  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuentas','[]'::jsonb)) loop
    if not coalesce(r->>'tipo','') in ('mesa','directa') then continue; end if;
    insert into public.cuentas (empresa_id, tipo, numero, estado, comensales, propina, descuento, nota,
                                abierta_por, abierta_en, cerrada_por, cerrada_en)
    values (v_emp, r->>'tipo', (r->>'numero')::int,
            case when coalesce(r->>'estado','abierta') in ('abierta','precuenta','cerrada')
                 then r->>'estado' else 'cerrada' end,
            coalesce((r->>'comensales')::int, 1),
            coalesce((r->>'propina')::numeric, 0), coalesce((r->>'descuento')::numeric, 0), r->>'nota',
            nullif(v_map_users->>(r->>'abierta_por'), '')::uuid,
            coalesce((r->>'abierta_en')::timestamptz, now()),
            nullif(v_map_users->>(r->>'cerrada_por'), '')::uuid,
            (r->>'cerrada_en')::timestamptz)
    returning id into v_cuenta;
    if (r->>'id') is not null then
      v_map_cuentas := jsonb_set(v_map_cuentas, array[r->>'id'], to_jsonb(v_cuenta));
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuenta_mesas','[]'::jsonb)) loop
    v_cuenta := nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid;
    v_mesa   := nullif(v_map_mesas->>(r->>'mesa_id'), '')::uuid;
    if v_cuenta is null or v_mesa is null then continue; end if;
    insert into public.cuenta_mesas (cuenta_id, mesa_id, empresa_id)
    values (v_cuenta, v_mesa, v_emp)
    on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuenta_items','[]'::jsonb)) loop
    v_cuenta := nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid;
    if v_cuenta is null then continue; end if;
    v_old    := nullif(v_map_productos->>(r->>'producto_id'), '')::uuid;
    insert into public.cuenta_items (empresa_id, cuenta_id, producto_id, nombre_snapshot,
                                     precio_snapshot, qty, estado, nota, motivo_anulacion, enviado_en)
    values (v_emp, v_cuenta, v_old,
            coalesce(nullif(r->>'nombre_snapshot',''),'(importado)'),
            coalesce((r->>'precio_snapshot')::numeric, 0),
            greatest(1, coalesce((r->>'qty')::int, 1)),
            case when coalesce(r->>'estado','pendiente') in ('pendiente','enviado','anulado')
                 then r->>'estado' else 'pendiente' end,
            coalesce(r->>'nota',''), r->>'motivo_anulacion',
            (r->>'enviado_en')::timestamptz);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'pagos','[]'::jsonb)) loop
    v_cuenta := nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid;
    if v_cuenta is null then continue; end if;
    if not coalesce(r->>'metodo','') in ('efectivo','qr','tarjeta','mixed') then continue; end if;
    insert into public.pagos (empresa_id, cuenta_id, metodo, monto, detalle, creada_por, creada_en)
    values (v_emp, v_cuenta, r->>'metodo', coalesce((r->>'monto')::numeric, 0),
            coalesce(r->'detalle', '{}'::jsonb),
            nullif(v_map_users->>(r->>'creada_por'), '')::uuid,
            coalesce((r->>'creada_en')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'turnos','[]'::jsonb)) loop
    insert into public.turnos_caja (id, empresa_id, abierto_por, abierto_en, fondo, cerrado_en,
                                   cerrado_por, contado, esperado, movimientos)
    values (gen_random_uuid(), v_emp,
            nullif(v_map_users->>(r->>'abierto_por'), '')::uuid,
            coalesce((r->>'abierto_en')::timestamptz, now()),
            coalesce((r->>'fondo')::numeric, 0),
            (r->>'cerrado_en')::timestamptz,
            nullif(v_map_users->>(r->>'cerrado_por'), '')::uuid,
            (r->>'contado')::numeric, (r->>'esperado')::numeric,
            coalesce(r->'movimientos', '{"movimientos":[]}'::jsonb));
  end loop;

  perform private.auditar(v_emp, 'super_importo', jsonb_build_object(
    'codigo', lower(p_codigo),
    'origen', p_datos->'empresa'->>'id',
    'articulos', jsonb_array_length(coalesce(p_datos->'productos','[]'::jsonb)),
    'cuentas',   jsonb_array_length(coalesce(p_datos->'cuentas','[]'::jsonb)),
    'equipo',    jsonb_array_length(coalesce(p_datos->'equipo','[]'::jsonb))));
  return v_emp;
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
