-- ============================================================================
-- setup.sql · POS Control · TODO el backend en UN solo archivo (el ÚNICO SQL del proyecto)
-- ----------------------------------------------------------------------------
-- Pegar COMPLETO en el SQL Editor de Supabase. Es idempotente: se puede volver a correr
-- siempre (base nueva o ya instalada) sin romper ni duplicar datos, y es atómico
-- (begin/commit: si algo falla, no queda nada a medias).
-- Contiene, en este orden: esquema + RLS + RPCs · super admin (tablas/funciones) ·
-- seguridad (cuota, auditoría, throttle, fotos) · comensales · altas y equipo ·
-- lista de empresas del login · cola de impresión (estación de impresión del local) ·
-- retención e inventario · cocina/barra con áreas por ítem, salida y anulación con
-- aprobación, auditoría local e INVENTARIO (009) · super admin fusionado (crear_super /
-- quitar_super, que antes iban en un archivo aparte; ahora todo está aquí). Regla de caja:
-- cajero y admin pueden anular ítems enviados (con motivo).
-- ============================================================================
begin;

-- ################################################################
-- ## schema.sql
-- ################################################################
-- ============================================================================
-- POS MULTI-TENANT · SUPABASE POSTGRES · schema.sql
-- (c) IA-1 · Proyecto "Punto de venta / POS Control Gratis" · Bolivia, moneda Bs
--
-- Cómo usar: pegar ESTE archivo completo en el SQL editor de Supabase (Dashboard
-- → SQL Editor → New query → Run). Debe ejecutarse como el role dueño del
-- proyecto (`postgres`), que es lo que hace el editor por defecto. Es idempotente:
-- puede volver a ejecutarse tras cambios sin duplicar nada (usa IF NOT EXISTS /
-- OR REPLACE / DROP POLICY IF EXISTS).
--
-- ============================================================================
-- MODELO DE MULTI-TENENCIA (plan gratuito: TODAS las empresas comparten la misma
-- base de datos; cada usuario solo ve los datos de SU empresa)
-- ============================================================================
--
--  1. `public.empresas`            → cada tenant (negocio).
--  2. `public.membresias`          → relación usuario(auth) ↔ empresa + rol
--                                    (admin | cajero | mesero | cocina | barra) + pin_descuento_hash.
--  3. EN TODAS las tablas de negocio hay columna `empresa_id` + índice.
--
--  FLUJO DE "EMPRESA ACTIVA" (cómo sabe la base a qué empresa pertenece cada
--  petición):
--
--    a) En el LOGIN la app lista las empresas del usuario:
--         select e.* from public.empresas e
--         join public.membresias m on m.empresa_id = e.id
--         where m.user_id = auth.uid();
--       (la política de SELECT de `empresas` permite ver exactamente aquellas
--       empresas en las que auth.uid() tiene membresía — ver política más abajo).
--
--    b) El usuario elige una empresa. La app guarda ese uuid (localStorage) y lo
--       pasa como `p_empresa_id` en CADA llamada RPC. Cada RPC empieza con
--       `select private.fijar_empresa(p_empresa_id)`, que:
--         - verifica que auth.uid() tiene membresía en esa empresa (si no: ERROR),
--         - ejecuta `set_config('app.empresa_id', <uuid>, true)` → GUC local a la
--           transacción (PostgREST envuelve cada request en 1 transacción, así
--           que el ajuste vive lo que dura la llamada; nada "contamina" otras).
--
--    c) La función auxiliar `private.empresa_activa()` (SECURITY DEFINER) es el
--       corazón del RLS. Devuelve el uuid de la empresa activa SOLO si:
--         - el GUC `app.empresa_id` está seteado Y auth.uid() tiene membresía en
--           esa empresa (protege contra un uuid "inventado" por el cliente), O
--         - (fallback) no hay GUC pero el usuario tiene EXACTAMENTE UNA membresía
--           → se usa esa. Esto permite SELECTs directos y REALTIME sobre vistas
--           (p. ej. v_estado_mesas) sin pasar parámetros, para usuarios de una
--           sola empresa (el caso normal de un negocio chico).
--       Cualquier combinación inválida devuelve NULL ⇒ todas las políticas
--       `empresa_id = private.empresa_activa()` evalúan a NULL/`false` ⇒ 0 filas.
--
--    d) RLS: en TODAS las tablas, políticas SELECT/INSERT/UPDATE/DELETE filtradas
--       por `empresa_id = private.empresa_activa()`. Las funciones privadas son
--       SECURITY DEFINER (owner = postgres) para poder leer `membresias` sin
--       recursión de RLS dentro de las propias políticas.
--
--    e) Las RPCs de escritura son SECURITY DEFINER y BYPASEAN el RLS (su dueño es
--       el owner de las tablas). Por eso NUNCA confían en el RLS internamente:
--       Filtran explícitamente `where empresa_id = v_emp` en cada SELECT/UPDATE/
--       DELETE y validan el ROL del usuario contra `membresias` antes de operar.
--       El cliente NO tiene INSERT/UPDATE/DELETE directo sobre tablas de negocio
--       (cuentas, items, pagos, turnos): solo puede mutar vía RPCs atómicas.
--       Tablas de catálogo (zonas, mesas, secciones, productos) sí admiten
--       escritura directa, pero sus políticas de escritura exigen rol admin.
--
--  Nota de seguridad: `private` NO es un schema expuesto por PostgREST (Solo
--  `public` está en la API), así que el cliente no puede ejecutar directamente
--  las funciones auxiliares; solo las políticas y las RPCs de `public` las usan.
--  Hardening futuro (fuera del alcance de este schema): usar el Auth Hook
--  "custom access token" para meter la empresa activa como claim del JWT
--  (p. ej. `app_empresa_id`) y leerla en `empresa_activa()` además del GUC.
--
-- ============================================================================
-- ORDEN DE CREACIÓN (todo se declara ANTES de ser referenciado):
--   0) extensiones + schema private        4) vista v_estado_mesas
--   1) tablas + índices (empresa_id+índice en todas las de negocio)
--                                          5) RLS (habilitar + políticas) + GRANTs
--   2) funciones auxiliares private.*      6) trigger handle_new_user (auth.users)
--   3) RPCs public.* + revoke/grant de ejecución
--   7) seed comentado + checklist post-ejecución
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Extensiones y schemas
-- ----------------------------------------------------------------------------
create schema if not exists private;

-- pgcrypto: crypt()/gen_salt() para validar el PIN de descuento (bcrypt).
-- En Supabase las extensiones viven en el schema "extensions".
create extension if not exists pgcrypto with schema extensions;

-- gen_random_uuid() es nativo de PostgreSQL >= 13 y vive en pg_catalog (schema
-- implícito aun con search_path=''), así que las tablas no dependen de pgcrypto.

-- ----------------------------------------------------------------------------
-- 1) TABLAS
-- ----------------------------------------------------------------------------

-- empresas: el tenant. config guarda ajustes libres (nombre largo, dirección…).
create table if not exists public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 1 and 120),
  codigo      text,  -- código corto que el usuario escribe en el login (único en minúsculas)
  moneda      text not null default 'Bs',
  iva_pct     numeric(5,2) not null default 0,
  propina_pct numeric(5,2) not null default 10,
  config      jsonb not null default '{}'::jsonb,
  creada_en   timestamptz not null default now()
);
create unique index if not exists empresas_codigo_uniq on public.empresas (lower(codigo)) where codigo is not null;

-- perfiles: puente auth.users ↔ datos visibles por la app (nombre para tickets,
-- etc.). La fila la crea el trigger handle_new_user() al registrarse.
create table if not exists public.perfiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  telefono     text,
  creado_en    timestamptz not null default now()
);

-- membresias: usuario ↔ empresa ↔ rol. pin_descuento_hash: bcrypt del PIN que
-- autoriza descuentos cuando el rol NO es admin (null = descuento bloqueado).
create table if not exists public.membresias (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  rol               text not null check (rol in ('admin','cajero','mesero','cocina','barra')),
  pin_descuento_hash text,
  creada_en         timestamptz not null default now(),
  unique (empresa_id, user_id)
);

-- zonas: agrupadores del salón (Salón, Terraza…).
create table if not exists public.zonas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  orden      integer not null default 0,
  creada_en  timestamptz not null default now()
);

-- mesas: geometría en el lienzo NORMALIZADO 1000 (ancho) × 600 (alto), igual
-- que el canvas de SalonPage.jsx del cliente (ver CONTRATO.md).
create table if not exists public.mesas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  zona_id     uuid references public.zonas(id) on delete set null,
  nombre      text not null check (length(trim(nombre)) between 1 and 60),
  x           numeric(6,2) not null default 0 check (x between 0 and 1000),
  y           numeric(6,2) not null default 0 check (y between 0 and 600),
  w           numeric(6,2) not null default 100 check (w between 10 and 1000),
  h           numeric(6,2) not null default 100 check (h between 10 and 600),
  forma       text not null default 'cuadrada' check (forma in ('cuadrada','redonda','rect')),
  capacidad   integer not null default 4 check (capacidad between 1 and 50),
  activa      boolean not null default true,
  creada_en   timestamptz not null default now()
);

-- secciones_menu: "Desayunos", "Comida", "Bebidas"…
create table if not exists public.secciones_menu (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  orden      integer not null default 0,
  creada_en  timestamptz not null default now()
);

-- productos: precio en Bs, numeric(10,2). activo=false en vez de borrar
-- (los items históricos conservan su snapshot de nombre/precio).
create table if not exists public.productos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  seccion_id uuid references public.secciones_menu(id) on delete set null,
  nombre     text not null check (length(trim(nombre)) between 1 and 120),
  precio     numeric(10,2) not null check (precio >= 0),
  activo     boolean not null default true,
  creada_en  timestamptz not null default now()
);

-- cuentas: la "comanda" global. tipo 'mesa' (asociada a mesas) o 'directa'
-- (venta para llevar con número autogenerado por empresa/día).
create table if not exists public.cuentas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  tipo         text not null check (tipo in ('mesa','directa')),
  numero       integer,                    -- solo tipo='directa'
  estado       text not null default 'abierta' check (estado in ('abierta','precuenta','cerrada')),
  comensales   integer not null default 1 check (comensales between 1 and 99),
  propina      numeric(10,2) not null default 0 check (propina >= 0),
  descuento    numeric(10,2) not null default 0 check (descuento >= 0),
  nota         text,
  abierta_por  uuid references auth.users(id),
  abierta_en   timestamptz not null default now(),
  cerrada_por  uuid references auth.users(id),
  cerrada_en   timestamptz
);

-- cuenta_mesas: n:m cuenta ↔ mesas (una cuenta "unida" abarca varias mesas).
create table if not exists public.cuenta_mesas (
  cuenta_id  uuid not null references public.cuentas(id) on delete cascade,
  mesa_id    uuid not null references public.mesas(id)   on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (cuenta_id, mesa_id)
);

-- cuenta_items: snapshot de nombre/precio al momento de agregar (la carta puede
-- cambiar; el ticket debe reflejar lo que se cobró). estado 'anulado' conserva
-- el item con su motivo (auditoría), NO se borra.
create table if not exists public.cuenta_items (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  cuenta_id        uuid not null references public.cuentas(id) on delete cascade,
  producto_id      uuid references public.productos(id) on delete set null,
  nombre_snapshot  text not null,
  precio_snapshot  numeric(10,2) not null check (precio_snapshot >= 0),
  qty              integer not null default 1 check (qty >= 1),
  estado           text not null default 'pendiente' check (estado in ('pendiente','enviado','listo','anulacion','anulado')),
  nota             text not null default '',
  motivo_anulacion text,
  enviado_en       timestamptz,
  creada_en        timestamptz not null default now()
);

-- pagos: cada línea de pago de una cuenta. detalle jsonb trae lo propio del
-- método: {recibido, cambio} para efectivo, {referencia} para QR, {tarjeta,
-- ultimos4} para tarjeta…
create table if not exists public.pagos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cuenta_id  uuid not null references public.cuentas(id) on delete cascade,
  metodo     text not null check (metodo in ('efectivo','qr','tarjeta','mixed')),
  monto      numeric(10,2) not null check (monto >= 0),
  detalle    jsonb not null default '{}'::jsonb,
  creada_por uuid references auth.users(id),
  creada_en  timestamptz not null default now()
);

-- turnos_caja: apertura/cierre de caja. movimientos jsonb es un log tipo
-- {"movimientos":[{id,tipo:'ingreso'|'egreso',monto,motivo,creada_en,usuario}]}
-- Al cerrar, la RPC escribe además el cálculo: esperado/venta_efectivo/etc.
create table if not exists public.turnos_caja (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  abierto_por  uuid references auth.users(id),
  abierto_en   timestamptz not null default now(),
  fondo        numeric(10,2) not null default 0 check (fondo >= 0),
  cerrado_en   timestamptz,
  cerrado_por  uuid references auth.users(id),
  contado      numeric(10,2),
  esperado     numeric(10,2),
  movimientos  jsonb not null default '{"movimientos":[]}'::jsonb
);

-- ----------------------------------------------------------------------------
-- 1b) ÍNDICES: empresa_id en TODAS las tablas de negocio + índices de acceso
-- ----------------------------------------------------------------------------
create index if not exists idx_membresias_empresa      on public.membresias (empresa_id);
create index if not exists idx_membresias_user         on public.membresias (user_id);
create index if not exists idx_zonas_empresa           on public.zonas (empresa_id);
create index if not exists idx_mesas_empresa           on public.mesas (empresa_id);
create index if not exists idx_mesas_zona              on public.mesas (zona_id);
create index if not exists idx_secciones_empresa       on public.secciones_menu (empresa_id);
create index if not exists idx_productos_empresa       on public.productos (empresa_id);
create index if not exists idx_productos_seccion       on public.productos (seccion_id);
create index if not exists idx_cuentas_empresa_estado  on public.cuentas (empresa_id, estado);
create index if not exists idx_cuentas_directa_dia     on public.cuentas (empresa_id, tipo, abierta_en desc);
create index if not exists idx_cuenta_mesas_mesa       on public.cuenta_mesas (mesa_id);
create index if not exists idx_cuenta_mesas_empresa    on public.cuenta_mesas (empresa_id);
create index if not exists idx_cuenta_items_empresa    on public.cuenta_items (empresa_id);
create index if not exists idx_cuenta_items_cuenta     on public.cuenta_items (cuenta_id);
create index if not exists idx_pagos_empresa           on public.pagos (empresa_id);
create index if not exists idx_pagos_cuenta            on public.pagos (cuenta_id);
create index if not exists idx_turnos_empresa          on public.turnos_caja (empresa_id, cerrado_en);

-- ----------------------------------------------------------------------------
-- 2) FUNCIONES AUXILIARES (schema private; SECURITY DEFINER donde se indica)
--    Declaradas TODAS antes que las políticas y las RPCs que las usan.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 2) NÚCLEO DE ACCESO · tablas auxiliares y funciones de empresa/rol/auditoría
--    Cada función está definida UNA sola vez (antes vivían 2-3 versiones que se
--    pisaban entre sí) y TODAS van antes de las políticas y RPCs que las usan.
--    Quién es super → public.es_super() (tabla `supers` siempre existe).
--    La empresa activa se guarda como FILA por usuario (empresa_activa_usuario): el GUC
--    de sesión no sobrevive al pool de Supabase en modo transacción (pgbouncer).
-- ============================================================================

-- Super admins (dueño de la plataforma). Se crean con public.crear_super (final del archivo).
-- 1) tabla de super administradores (dueño de la plataforma)
create table if not exists public.supers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  creado_en  timestamptz not null default now()
);
alter table public.supers enable row level security;
drop policy if exists supers_propio on public.supers;
create policy supers_propio on public.supers for select using (user_id = auth.uid());

-- Auditoría de accesos y acciones. Sin políticas ni grants: la API no la expone;
-- solo se lee con super_listar_auditoria() / auditoria_listar() (security definer).
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
  en         timestamptz not null default now(),
  actor_nombre text,      -- quién (perfil o correo)
  actor_rol    text,      -- con qué rol actuó
  entity_type  text,      -- sobre qué tipo de entidad
  entity_label text       -- y cuál (texto legible)
);
alter table public.auditoria enable row level security;
alter table public.auditoria force row level security;
   -- ni el dueño accidental
revoke all on table public.auditoria from public, anon, authenticated;
create index if not exists idx_auditoria_empresa_en on public.auditoria (empresa_id, en desc);

-- Empresa elegida por cada usuario (el GUC de sesión no sobrevive al pool en modo transacción).
create table if not exists public.empresa_activa_usuario (
  user_id    uuid primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  updated_at timestamptz not null default now()
);
comment on table public.empresa_activa_usuario is
  'Empresa elegida por cada usuario; reemplaza al GUC de sesión (no sobrevive al pool en modo transacción).';
alter table public.empresa_activa_usuario enable row level security;
drop policy if exists eau_select on public.empresa_activa_usuario;
create policy eau_select on public.empresa_activa_usuario for select to authenticated
  using (user_id = auth.uid());
drop policy if exists eau_write on public.empresa_activa_usuario;
create policy eau_write on public.empresa_activa_usuario for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.empresa_activa_usuario to authenticated;

-- 2) helper es_super()
create or replace function public.es_super()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.supers s where s.user_id = auth.uid()); $$;

grant execute on function public.es_super() to authenticated;

-- private.empresa_activa(): versión definitiva (manda sobre las de 002 y 008).
-- Prioridad: 1) GUC transaccional, 2) fila del usuario, 3) miembro único.
create or replace function private.empresa_activa()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid;
  v_guc   uuid;
  v_fila  uuid;
  v_unica uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return null; end if;    -- sin sesión ⇒ nada visible

  -- 1) GUC transaccional: lo pone private.fijar_empresa(p_empresa_id) dentro de cada RPC
  --    de negocio. Es la empresa EXPLÍCITA de esta llamada ⇒ manda sobre lo demás, si no,
  --    una RPC de otra empresa leería datos de la última empresa visitada.
  begin
    v_guc := nullif(current_setting('app.empresa_id', true), '')::uuid;
  exception when others then
    v_guc := null;   -- GUC ausente o basura no-uuid: se ignora, no aborta la transacción
  end;
  if v_guc is not null then
    if exists (select 1 from public.membresias m
               where m.empresa_id = v_guc and m.user_id = v_uid)
       or public.es_super() then
      return v_guc;
    end if;
    return null;
  end if;

  -- 2) Fila del usuario: los SELECT/INSERT directos de PostgREST llegan sin GUC y pueden
  --    caer en cualquier conexión; la empresa que eligió al entrar es lo único estable.
  select e.empresa_id into v_fila
    from public.empresa_activa_usuario e where e.user_id = v_uid limit 1;
  if v_fila is not null then
    if exists (select 1 from public.membresias m
               where m.empresa_id = v_fila and m.user_id = v_uid)
       or public.es_super() then
      return v_fila;
    end if;
    return null;
  end if;

  -- 3) Miembro de una sola empresa: no hay nada que elegir.
  --    min(uuid) no es agregado en PostgreSQL < 17: se agrega como text y se resuelve.
  select min(m.empresa_id::text)::uuid into v_unica
    from public.membresias m where m.user_id = v_uid having count(*) = 1;
  return v_unica;
end $fn$;

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
          or public.es_super()) then
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
    case when public.es_super()
          and private.empresa_activa() is not null
         then 'admin' end
  );
$fn$;

-- exigir_rol(): gate de permisos de las RPCs. Aborta si el rol no está en la
-- lista. Devuelve el rol para conveniencia del caller.
create or replace function private.exigir_rol(p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rol text;
begin
  v_rol := private.mi_rol();
  if v_rol is null or not (v_rol = any (p_roles)) then
    raise exception 'acción no permitida para el rol %', coalesce(v_rol, 'sin membresía');
  end if;
  return v_rol;
end $fn$;

-- es_admin(): la versión de la sección 002 consulta public.membresias en crudo, así que
-- ignoraba a mi_rol() y devolvía false para un super sin membresía. Con false le quedaban
-- vetados TODOS los writes directos de catálogo (zonas/mesas/secciones_menu/productos → 403
-- al dar de alta una sección o una mesa desde «Entrar en empresa» del super) y el SELECT de
-- las tablas de inventario. Se redefine sobre mi_rol(), que ya mapea super → 'admin'.
create or replace function private.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select private.mi_rol() = 'admin';
$fn$;

-- empresa_ok(): true si p_id ES la empresa activa. Se usa en la política de
-- UPDATE de empresas (que no tiene columna empresa_id: la columna es su PK id).
create or replace function private.empresa_ok(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_id = private.empresa_activa();
$fn$;

-- 8) un super ve TODAS las empresas en el listado de acceso (empresas_select es
--    la única política que usa es_miembro_de; las de escritura usan
--    empresa_activa()+es_admin() y no se modifican).
create or replace function private.es_miembro_de(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.membresias m
     where m.empresa_id = p_empresa_id
       and m.user_id = auth.uid()
  ) or public.es_super();
$fn$;

-- compartir_empresa(): para perfiles (puedo ver los nombres de mis colegas).
create or replace function private.comparte_empresa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.membresias a
      join public.membresias b on b.empresa_id = a.empresa_id
     where a.user_id = auth.uid()
       and b.user_id = p_user_id
  );
$fn$;

-- private.auditar(): firma de 5 args (los 2 últimos opcionales ⇒ las llamadas de 3 args siguen válidas).
drop function if exists private.auditar(uuid, text, jsonb);
create or replace function private.auditar(
  p_empresa      uuid,
  p_accion       text,
  p_detalle      jsonb default '{}'::jsonb,
  p_entity_type  text  default null,
  p_entity_label text  default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_nombre text;
  v_actor_rol    text;
begin
  select coalesce(
           nullif((select pf.display_name from public.perfiles pf
                    where pf.user_id = auth.uid()), ''),
           nullif(auth.jwt() ->> 'email', ''),
           'Sistema'
         ),
         coalesce(
           nullif(private.mi_rol(), ''),
           case when public.es_super() then 'super' else '—' end
         )
    into v_actor_nombre, v_actor_rol;

  insert into public.auditoria (empresa_id, actor, accion, detalle,
                                actor_nombre, actor_rol, entity_type, entity_label)
  values (p_empresa, auth.uid(), p_accion, coalesce(p_detalle, '{}'::jsonb),
          v_actor_nombre, v_actor_rol, p_entity_type, p_entity_label);
end $fn$;

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
  -- Antes: set_config(..., false) (GUC de SESIÓN). Inútil bajo pgbouncer en modo
  -- transacción; la elección se guarda como fila, que sí viaja hasta la siguiente
  -- petición sin importar qué conexión la atienda.
  insert into public.empresa_activa_usuario (user_id, empresa_id, updated_at)
  values (auth.uid(), p_empresa, now())
  on conflict (user_id) do update
    set empresa_id = excluded.empresa_id, updated_at = excluded.updated_at;
  if public.es_super() then
    perform private.auditar(p_empresa, 'super_entro',
                            jsonb_build_object('empresa', p_empresa::text));
  end if;
end $fn$;

revoke all on function public.fijar_empresa(uuid) from public, anon;

grant execute on function public.fijar_empresa(uuid) to authenticated;

-- total_items(): suma de items VIVOS (no anulados) de una cuenta.
create or replace function private.total_items(p_cuenta_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(i.precio_snapshot * i.qty), 0)::numeric
    from public.cuenta_items i
   where i.cuenta_id = p_cuenta_id
     and i.estado <> 'anulado';
$fn$;

-- jsonb_items(): serializa los items de una cuenta (payload de respuesta RPC).
create or replace function private.jsonb_items(p_cuenta_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',             i.id,
        'producto_id',    i.producto_id,
        'nombre',         i.nombre_snapshot,
        'precio',         i.precio_snapshot,
        'qty',            i.qty,
        'estado',         i.estado,
        'nota',           i.nota,
        'motivo_anulacion', i.motivo_anulacion,
        'enviado_en',     i.enviado_en,
        'creada_en',      i.creada_en
      ) order by i.creada_en, i.id
    ),
    '[]'::jsonb
  )
  from public.cuenta_items i
  where i.cuenta_id = p_cuenta_id;
$fn$;

-- load_cuenta(): carga la cuenta de la empresa activa y valida estado.
-- Aborta con error claro si no existe o está en estado inapropiado.
create or replace function private.load_cuenta(
  p_cuenta_id uuid,
  p_estados   text[] default array['abierta','precuenta']::text[]
)
returns public.cuentas
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  c public.cuentas;
begin
  select * into c
    from public.cuentas
   where id = p_cuenta_id
     and empresa_id = private.empresa_activa();
  if not found then
    raise exception 'cuenta % no encontrada en la empresa activa', p_cuenta_id;
  end if;
  if not (c.estado = any (p_estados)) then
    raise exception 'operación no permitida: la cuenta está en estado "%"', c.estado;
  end if;
  return c;
end $fn$;

-- verificar_pin_descuento(): bcrypt contra membresias.pin_descuento_hash.
-- Se llama SOLO cuando el rol no es admin y se pretende aplicar descuento.
create or replace function private.verificar_pin_descuento(
  p_empresa_id uuid,
  p_pin        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
begin
  select m.pin_descuento_hash into v_hash
    from public.membresias m
   where m.empresa_id = p_empresa_id
     and m.user_id = auth.uid();
  if v_hash is null then
    raise exception 'descuento sin PIN autorizado (configure pin_descuento_hash para este usuario)';
  end if;
  if p_pin is null or not (extensions.crypt(p_pin, v_hash) = v_hash) then
    raise exception 'PIN de descuento incorrecto';
  end if;
end $fn$;

-- ----------------------------------------------------------------------------
-- 3) RPCs DE NEGOCIO (public, SECURITY DEFINER, atómicas)
--    Patrón común:
--      v_emp := private.fijar_empresa(p_empresa_id);   -- GUC + validez membresía
--      perform private.exigir_rol(ARRAY[...]);          -- permiso por rol
--      todo acceso lleva WHERE empresa_id = v_emp       -- no confía en el RLS
-- ----------------------------------------------------------------------------

-- abrir_cuenta ← d({t:'abrir', mesaId, comensales})
create or replace function public.abrir_cuenta(
  p_empresa_id uuid,
  p_mesa_id    uuid,
  p_comensales integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_id  uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);

  if not exists (select 1 from public.mesas m
                 where m.id = p_mesa_id and m.empresa_id = v_emp and m.activa) then
    raise exception 'mesa inexistente o inactiva';
  end if;

  -- Serializa aperturas sobre la misma mesa (evita 2 cuentas simultáneas).
  perform pg_advisory_xact_lock(hashtextextended('mesa:' || p_mesa_id::text, 0));

  if exists (select 1
               from public.cuentas c
               join public.cuenta_mesas cm on cm.cuenta_id = c.id
              where cm.mesa_id = p_mesa_id
                and c.empresa_id = v_emp
                and c.estado <> 'cerrada') then
    raise exception 'la mesa ya tiene una cuenta abierta';
  end if;

  insert into public.cuentas (empresa_id, tipo, estado, comensales, abierta_por)
  values (v_emp, 'mesa', 'abierta', greatest(coalesce(p_comensales, 1), 1), auth.uid())
  returning id into v_id;

  insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
  values (v_emp, v_id, p_mesa_id);

  return v_id;
end $fn$;

-- abrir_venta_directa ← d({t:'abrir-directa'}) · número autogenerado empresa/día
create or replace function public.abrir_venta_directa(
  p_empresa_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_num integer;
  v_id  uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);

  -- Lock empresa/día: los números no se duplican con pedidos concurrentes.
  perform pg_advisory_xact_lock(
    hashtextextended('directa:' || v_emp::text || ':' || to_char(now(), 'YYYY-MM-DD'), 0)
  );

  select coalesce(max(c.numero), 0) + 1 into v_num
    from public.cuentas c
   where c.empresa_id = v_emp
     and c.tipo = 'directa'
     and c.abierta_en::date = current_date;

  insert into public.cuentas (empresa_id, tipo, numero, estado, abierta_por)
  values (v_emp, 'directa', v_num, 'abierta', auth.uid())
  returning id into v_id;

  return v_id;
end $fn$;

-- agregar_items ← d({t:'item+', cuentaId, p})
-- p_items: [{producto_id, qty?, nota?}] · hace merge en pendiente existente sin
-- nota (idéntico al reducer local: suma qty en vez de duplicar la línea).
create or replace function public.agregar_items(
  p_cuenta_id  uuid,
  p_items      jsonb,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_cuenta public.cuentas;
  v_it     jsonb;
  v_prod   public.productos;
  v_item   uuid;
  v_qty    integer;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta']::text[]);

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items debe ser un array jsonb no vacío';
  end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    select p.* into v_prod
      from public.productos p
     where p.id = nullif(v_it->>'producto_id','')::uuid
       and p.empresa_id = v_emp
       and p.activo;
    if not found then
      raise exception 'producto inexistente, inactivo o de otra empresa: %', coalesce(v_it->>'producto_id','?');
    end if;

    v_qty := greatest(coalesce(nullif(v_it->>'qty','')::integer, 1), 1);

    select i.id into v_item
      from public.cuenta_items i
     where i.cuenta_id = v_cuenta.id
       and i.producto_id = v_prod.id
       and i.estado = 'pendiente'
       and coalesce(i.nota, '') = ''
     limit 1;

    if found then
      update public.cuenta_items
         set qty = qty + v_qty
       where id = v_item;
    else
      insert into public.cuenta_items
        (empresa_id, cuenta_id, producto_id, nombre_snapshot, precio_snapshot, qty, estado, nota, areas)
      values
        (v_emp, v_cuenta.id, v_prod.id, v_prod.nombre, v_prod.precio, v_qty, 'pendiente',
         coalesce(v_it->>'nota', ''),
         coalesce(v_prod.areas, array['cocina']::text[]))
      returning id into v_item;
    end if;
  end loop;

  return private.jsonb_items(v_cuenta.id);
end $fn$;

-- cambiar_qty_item ← d({t:'qty', cuentaId, itemId, d})
-- delta ±1 (o el entero que sea); si la cantidad resulta <= 0 el ítem SE ELIMINA
-- (igual que el reducer). Solo ítems pendientes.
create or replace function public.cambiar_qty_item(
  p_item_id    uuid,
  p_delta      integer,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_it  public.cuenta_items;
  v_nue integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  if p_delta = 0 then
    return jsonb_build_object('ok', true);
  end if;

  select * into v_it
    from public.cuenta_items
   where id = p_item_id and empresa_id = v_emp;
  if not found then
    raise exception 'ítem inexistente en la empresa activa';
  end if;
  perform private.load_cuenta(v_it.cuenta_id, array['abierta']::text[]);

  if v_it.estado = 'anulado' then
    raise exception 'el ítem está anulado';
  end if;
  if v_it.estado in ('enviado','listo','anulacion') then
    raise exception 'ítem ya enviado a cocina: anúlelo y agréguelo de nuevo';
  end if;

  v_nue := v_it.qty + p_delta;
  if v_nue <= 0 then
    delete from public.cuenta_items where id = p_item_id;
    return jsonb_build_object('id', p_item_id, 'eliminado', true);
  end if;

  update public.cuenta_items set qty = v_nue where id = p_item_id;
  return jsonb_build_object(
    'id', p_item_id, 'eliminado', false,
    'item', (select jsonb_build_object('id', i.id, 'nombre', i.nombre_snapshot,
                                       'precio', i.precio_snapshot, 'qty', i.qty,
                                       'estado', i.estado, 'nota', i.nota)
             from public.cuenta_items i where i.id = p_item_id));
end $fn$;

-- poner_nota ← d({t:'nota', cuentaId, itemId, nota})
create or replace function public.poner_nota(
  p_item_id    uuid,
  p_nota       text,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_it  public.cuenta_items;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);

  select * into v_it from public.cuenta_items
   where id = p_item_id and empresa_id = v_emp;
  if not found then
    raise exception 'ítem inexistente en la empresa activa';
  end if;
  perform private.load_cuenta(v_it.cuenta_id, array['abierta']::text[]);

  if v_it.estado <> 'pendiente' then
    raise exception 'solo se puede anotar un ítem pendiente (estado: %)', v_it.estado;
  end if;

  update public.cuenta_items set nota = coalesce(p_nota, '') where id = p_item_id;
end $fn$;

-- enviar_items ← d({t:'enviar', cuentaId}) · null = todos los pendientes
create or replace function public.enviar_items(
  p_cuenta_id  uuid,
  p_item_ids   jsonb default null,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_cuenta public.cuentas;
  v_n      integer;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta']::text[]);

  update public.cuenta_items
     set estado = 'enviado', enviado_en = now()
   where cuenta_id = v_cuenta.id
     and empresa_id = v_emp
     and estado = 'pendiente'
     and (p_item_ids is null
          or id in (select "value"::uuid from jsonb_array_elements_text(p_item_ids)));

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- anular_item ← d({t:'anular', cuentaId, itemId, motivo})
-- ÍTEM YA ENVIADO ⇒ exige rol admin + motivo no vacío (política del reducer).
create or replace function public.anular_item(
  p_item_id    uuid,
  p_motivo     text,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_rol text;
  v_it  public.cuenta_items;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  v_rol := private.exigir_rol(array['admin','cajero','mesero']::text[]);

  select * into v_it from public.cuenta_items
   where id = p_item_id and empresa_id = v_emp;
  if not found then
    raise exception 'ítem inexistente en la empresa activa';
  end if;
  perform private.load_cuenta(v_it.cuenta_id, array['abierta','precuenta']::text[]);

  if v_it.estado = 'anulado' then
    raise exception 'el ítem ya está anulado';
  end if;
  if v_it.estado in ('enviado','listo','anulacion') then
    if v_rol not in ('admin','cajero') then
      raise exception 'anular un ítem enviado requiere rol cajero o admin';
    end if;
    if coalesce(trim(p_motivo), '') = '' then
      raise exception 'el motivo de anulación es obligatorio para ítems enviados';
    end if;
  end if;

  update public.cuenta_items
     set estado = 'anulado', motivo_anulacion = coalesce(nullif(trim(p_motivo), ''), 'sin motivo')
   where id = p_item_id;
end $fn$;

-- unir_mesas ← d({t:'unir', cuentaId, mesaIds})
-- Suma mesas a la cuenta; si alguna mesa tenía cuenta activa propia, SE ABSORBE
-- (items migran, cuenta absorbida se cierra con nota 'unida a otra cuenta').
create or replace function public.unir_mesas(
  p_cuenta_id  uuid,
  p_mesa_ids   jsonb,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp       uuid;
  v_cuenta    public.cuentas;
  v_mesa      uuid;
  v_absorbida uuid;
  v_absorb    jsonb := '[]'::jsonb;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if jsonb_typeof(p_mesa_ids) <> 'array' or jsonb_array_length(p_mesa_ids) = 0 then
    raise exception 'p_mesa_ids debe ser un array jsonb no vacío';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  for v_mesa in select "value"::uuid from jsonb_array_elements_text(p_mesa_ids) loop
    if not exists (select 1 from public.mesas m
                   where m.id = v_mesa and m.empresa_id = v_emp and m.activa) then
      raise exception 'mesa inexistente o inactiva: %', v_mesa;
    end if;

    if exists (select 1 from public.cuenta_mesas cm
               where cm.cuenta_id = v_cuenta.id and cm.mesa_id = v_mesa) then
      continue;                                    -- ya estaba unida
    end if;

    select c.id into v_absorbida
      from public.cuentas c
      join public.cuenta_mesas cm on cm.cuenta_id = c.id
     where cm.mesa_id = v_mesa
       and c.empresa_id = v_emp
       and c.estado <> 'cerrada'
       and c.id <> v_cuenta.id
     limit 1;

    if found then
      update public.cuenta_items
         set cuenta_id = v_cuenta.id
       where cuenta_id = v_absorbida and empresa_id = v_emp;
      update public.cuentas
         set estado = 'cerrada', cerrada_por = auth.uid(),
             cerrada_en = now(), nota = 'unida a otra cuenta'
       where id = v_absorbida and empresa_id = v_emp;
      delete from public.cuenta_mesas where cuenta_id = v_absorbida;
      v_absorb := v_absorb || jsonb_build_array(v_absorbida);
    end if;

    insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
    values (v_emp, v_cuenta.id, v_mesa)
    on conflict (cuenta_id, mesa_id) do nothing;
  end loop;

  return jsonb_build_object('cuenta_id', v_cuenta.id, 'absorbidas', v_absorb);
end $fn$;

-- separar_mesa ← d({t:'separar', cuentaId, mesaId})
-- Saca UNA mesa de la cuenta unida (debe quedar ≥1) y le crea cuenta propia
-- VACÍA (los ítems se reparten después con mover_items; igual que el demo).
create or replace function public.separar_mesa(
  p_cuenta_id  uuid,
  p_mesa_id    uuid,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_cuenta public.cuentas;
  v_nmesas integer;
  v_nueva  uuid;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  select count(*) into v_nmesas
    from public.cuenta_mesas where cuenta_id = v_cuenta.id;
  if v_nmesas < 2 then
    raise exception 'la cuenta no tiene mesas unidas que separar';
  end if;
  if not exists (select 1 from public.cuenta_mesas
                 where cuenta_id = v_cuenta.id and mesa_id = p_mesa_id) then
    raise exception 'esa mesa no pertenece a la cuenta';
  end if;

  delete from public.cuenta_mesas
   where cuenta_id = v_cuenta.id and mesa_id = p_mesa_id;

  insert into public.cuentas (empresa_id, tipo, estado, comensales, abierta_por)
  values (v_emp, 'mesa', 'abierta', 1, auth.uid())
  returning id into v_nueva;

  insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
  values (v_emp, v_nueva, p_mesa_id);

  return v_nueva;
end $fn$;

-- mover_items ← d({t:'mover', cuentaId, itemIds, mesaDestino | cuentaDestinoId})
-- Destino: cuenta explícita O cuenta activa de la mesa destino; si la mesa
-- destino no tiene cuenta, se crea una (como el reducer).
create or replace function public.mover_items(
  p_cuenta_id        uuid,
  p_item_ids         jsonb,
  p_mesa_destino     uuid   default null,
  p_cuenta_destino_id uuid  default null,
  p_empresa_id       uuid   default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_origen public.cuentas;
  v_dest   uuid;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_origen := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if jsonb_typeof(p_item_ids) <> 'array' or jsonb_array_length(p_item_ids) = 0 then
    raise exception 'p_item_ids debe ser un array jsonb no vacío';
  end if;
  if p_cuenta_destino_id is null and p_mesa_destino is null then
    raise exception 'indique p_mesa_destino o p_cuenta_destino_id';
  end if;

  if p_cuenta_destino_id is not null then
    v_dest := (select c.id from public.cuentas c
                where c.id = p_cuenta_destino_id
                  and c.empresa_id = v_emp
                  and c.estado <> 'cerrada'
                  and c.id <> v_origen.id);
    if v_dest is null then
      raise exception 'cuenta destino inexistente, cerrada o de otra empresa';
    end if;
  else
    if not exists (select 1 from public.mesas m
                   where m.id = p_mesa_destino and m.empresa_id = v_emp and m.activa) then
      raise exception 'mesa destino inexistente o inactiva';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mesa:' || p_mesa_destino::text, 0));
    select c.id into v_dest
      from public.cuentas c
      join public.cuenta_mesas cm on cm.cuenta_id = c.id
     where cm.mesa_id = p_mesa_destino
       and c.empresa_id = v_emp
       and c.estado <> 'cerrada'
       and c.id <> v_origen.id
     limit 1;
    if v_dest is null then
      insert into public.cuentas (empresa_id, tipo, estado, comensales, abierta_por)
      values (v_emp, 'mesa', 'abierta', 1, auth.uid())
      returning id into v_dest;
      insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
      values (v_emp, v_dest, p_mesa_destino);
    end if;
  end if;

  update public.cuenta_items
     set cuenta_id = v_dest
   where cuenta_id = v_origen.id
     and empresa_id = v_emp
     and estado <> 'anulado'
     and id in (select "value"::uuid from jsonb_array_elements_text(p_item_ids));

  return v_dest;
end $fn$;

-- aplicar_extras ← d({t:'extras', cuentaId, propina?, descuento?})
-- (pre-cuenta y reapertura tienen RPCs propias: pre_cuenta / reabrir_cuenta).
-- Descuento > 0 con rol != admin ⇒ exige p_pin válido.
create or replace function public.aplicar_extras(
  p_cuenta_id  uuid,
  p_propina    numeric default null,
  p_descuento  numeric default null,
  p_pin        text    default null,
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_cuenta public.cuentas;
  v_rol    text;
  v_total  numeric;
  v_final  numeric;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  v_rol    := private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  if p_propina is not null then
    update public.cuentas set propina = greatest(p_propina, 0) where id = v_cuenta.id;
  end if;

  if p_descuento is not null then
    if p_descuento > 0 and v_rol <> 'admin' then
      perform private.verificar_pin_descuento(v_emp, p_pin);
    end if;
    update public.cuentas set descuento = greatest(p_descuento, 0) where id = v_cuenta.id;
  end if;

  select propina, descuento into v_cuenta.propina, v_cuenta.descuento
    from public.cuentas where id = v_cuenta.id;

  v_total := private.total_items(v_cuenta.id);
  v_final := greatest(v_total - v_cuenta.descuento, 0) + v_cuenta.propina;
  return jsonb_build_object(
    'cuenta_id', v_cuenta.id,
    'subtotal',  v_total,
    'descuento', v_cuenta.descuento,
    'propina',   v_cuenta.propina,
    'total',     v_final
  );
end $fn$;

-- pre_cuenta / reabrir_cuenta ← d({t:'precuenta'}) / d({t:'reabrir'})
create or replace function public.pre_cuenta(
  p_cuenta_id  uuid,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  update public.cuentas set estado = 'precuenta'
   where id = p_cuenta_id and empresa_id = v_emp and estado = 'abierta';
  if not found then
    raise exception 'no se pudo pasar a pre-cuenta (cuenta no abierta en la empresa activa)';
  end if;
end $fn$;

create or replace function public.reabrir_cuenta(
  p_cuenta_id  uuid,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  update public.cuentas set estado = 'abierta'
   where id = p_cuenta_id and empresa_id = v_emp and estado = 'precuenta';
  if not found then
    raise exception 'la cuenta no está en pre-cuenta (empresa activa)';
  end if;
end $fn$;

-- cobrar_cuenta ← d({t:'cobrar', cuentaId, pagos, propina?, descuento?})
-- Atómico: aplica extras (con PIN si aplica), valida que los pagos cubran el
-- total, inserta pagos, cierra la cuenta, libera mesas y suma la venta en
-- efectivo al turno abierto (para el arqueo de cerrar_turno). Devuelve ticket.
create or replace function public.cobrar_cuenta(
  p_cuenta_id  uuid,
  p_pagos      jsonb,                      -- [{metodo,monto,detalle?}]
  p_propina    numeric default null,
  p_descuento  numeric default null,
  p_pin        text    default null,
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp      uuid;
  v_cuenta   public.cuentas;
  v_rol      text;
  v_pg       jsonb;
  v_metodo   text;
  v_monto    numeric(10,2);
  v_subtotal numeric;
  v_final    numeric;
  v_pagado   numeric := 0;
  v_efectivo numeric := 0;
  v_turno    uuid;
  v_mesas    jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  v_rol := private.exigir_rol(array['admin','cajero']::text[]);   -- cobrar: caja
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'p_pagos debe ser un array jsonb no vacío';
  end if;

  -- Candado por cuenta: dos cajeros no cobran la misma cuenta a la vez.
  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  -- Extras (mismo contrato que aplicar_extras; PIN si descuento sin admin).
  if p_propina is not null then
    update public.cuentas set propina = greatest(p_propina, 0) where id = v_cuenta.id;
  end if;
  if p_descuento is not null and p_descuento > 0 and v_rol <> 'admin' then
    perform private.verificar_pin_descuento(v_emp, p_pin);
  end if;
  if p_descuento is not null then
    update public.cuentas set descuento = greatest(p_descuento, 0) where id = v_cuenta.id;
  end if;

  select propina, descuento into v_cuenta.propina, v_cuenta.descuento
    from public.cuentas where id = v_cuenta.id;

  v_subtotal := private.total_items(v_cuenta.id);
  v_final    := greatest(v_subtotal - v_cuenta.descuento, 0) + v_cuenta.propina;

  for v_pg in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := lower(coalesce(v_pg->>'metodo', ''));
    if v_metodo not in ('efectivo','qr','tarjeta','mixed') then
      raise exception 'método de pago inválido: %', v_metodo;
    end if;
    v_monto := coalesce(nullif(v_pg->>'monto','')::numeric, 0);
    if v_monto < 0 then
      raise exception 'el monto del pago no puede ser negativo';
    end if;
    insert into public.pagos (empresa_id, cuenta_id, metodo, monto, detalle, creada_por)
    values (v_emp, v_cuenta.id, v_metodo, v_monto,
            coalesce(v_pg->'detalle', '{}'::jsonb), auth.uid());
    v_pagado := v_pagado + v_monto;
    if v_metodo = 'efectivo' then
      v_efectivo := v_efectivo + v_monto;
    end if;
  end loop;

  if v_pagado < v_final then
    raise exception 'el pago (% Bs) no cubre el total (% Bs)', v_pagado, v_final;
  end if;

  update public.cuentas
     set estado = 'cerrada', cerrada_por = auth.uid(), cerrada_en = now()
   where id = v_cuenta.id and empresa_id = v_emp;

  -- Capturar las mesas ANTES de liberarlas (para el ticket):
  select coalesce(jsonb_agg(m.nombre order by m.nombre), '[]'::jsonb) into v_mesas
    from public.cuenta_mesas cm
    join public.mesas m on m.id = cm.mesa_id
   where cm.cuenta_id = v_cuenta.id;

  delete from public.cuenta_mesas where cuenta_id = v_cuenta.id;  -- libera mesas

  -- Acumular en el turno abierto (si existe): la venta en efectivo entra al
  -- cajón; cerrar_turno la usa como base del esperado.
  select id into v_turno
    from public.turnos_caja
   where empresa_id = v_emp and cerrado_en is null
   order by abierto_en desc
   limit 1;
  if v_turno is not null then
    update public.turnos_caja t
       set movimientos = t.movimientos
         || jsonb_build_object(
              'venta_efectivo',   coalesce((t.movimientos->>'venta_efectivo')::numeric, 0) + v_efectivo,
              'cuentas_cerradas', coalesce((t.movimientos->>'cuentas_cerradas')::integer, 0) + 1)
     where t.id = v_turno;
  end if;

  -- INVENTARIO (009) · descuenta stock por receta al cobrar. BEST-EFFORT: un fallo
  -- de inventario NUNCA puede impedir el cobro ni desbaratar la cuenta cerrada.
  begin
    with vivos as (
      select i.producto_id, sum(i.qty)::numeric as qty
        from public.cuenta_items i
       where i.cuenta_id = v_cuenta.id and i.empresa_id = v_emp
         and i.producto_id is not null
         and i.estado <> 'anulado'
       group by i.producto_id
    ), baja as (
      select r.insumo_id, sum(v.qty * r.cantidad) as consume
        from vivos v
        join public.recetas r on r.producto_id = v.producto_id
       group by r.insumo_id
    ), upd as (
      update public.insumos s
         set stock = s.stock - b.consume,       -- sin bloquear: puede quedar negativo
             actualizado_en = now()
        from baja b
       where s.id = b.insumo_id
      returning s.id as insumo_id, b.consume, s.stock as stock_after
    )
    insert into public.insumos_movimientos
      (empresa_id, insumo_id, tipo, cantidad, stock_after, nota, usuario, usuario_nombre)
    select v_emp, u.insumo_id, 'venta', u.consume, u.stock_after,
           'venta cuenta ' || coalesce(v_cuenta.numero::text, v_cuenta.id::text),
           auth.uid(),
           coalesce((select p.display_name from public.perfiles p where p.user_id = auth.uid()), '')
      from upd u;
  exception when others then
    null;   -- la cuenta se cierra igual; el inventario se corrige a mano
  end;

  return jsonb_build_object(
    'cuenta_id',  v_cuenta.id,
    'tipo',       v_cuenta.tipo,
    'numero',     v_cuenta.numero,
    'mesas',      v_mesas,
    'items',      private.jsonb_items(v_cuenta.id),
    'pagos',      (select coalesce(jsonb_agg(jsonb_build_object(
                     'metodo', p.metodo, 'monto', p.monto, 'detalle', p.detalle)
                     order by p.creada_en), '[]'::jsonb)
                     from public.pagos p where p.cuenta_id = v_cuenta.id),
    'subtotal',   v_subtotal,
    'descuento',  v_cuenta.descuento,
    'propina',    v_cuenta.propina,
    'total',      v_final,
    'pagado',     v_pagado,
    'cambio',     v_pagado - v_final,
    'cerrada_en', now(),
    'moneda',     (select e.moneda from public.empresas e where e.id = v_emp)
  );
end $fn$;

-- abrir_turno ← d({t:'turno+', usuario, fondo})
create or replace function public.abrir_turno(
  p_empresa_id uuid,
  p_fondo      numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_id  uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  perform pg_advisory_xact_lock(hashtextextended('turno:' || v_emp::text, 0));

  if exists (select 1 from public.turnos_caja
             where empresa_id = v_emp and cerrado_en is null) then
    raise exception 'ya existe un turno de caja abierto para esta empresa';
  end if;

  insert into public.turnos_caja (empresa_id, abierto_por, fondo)
  values (v_emp, auth.uid(), greatest(coalesce(p_fondo, 0), 0))
  returning id into v_id;
  return v_id;
end $fn$;

-- registrar_movimiento_caja ← d({t:'caja-mov+', tipo, monto, motivo})
-- tipo: 'ingreso' | 'egreso'. Se acumula en movimientos->'movimientos'.
create or replace function public.registrar_movimiento_caja(
  p_tipo       text,                       -- 'ingreso' | 'egreso'
  p_monto      numeric,
  p_motivo     text    default null,
  p_turno_id   uuid    default null,       -- null = turno abierto de la empresa
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_turno public.turnos_caja;
  v_monto numeric;
  v_mov   jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  if coalesce(p_tipo, '') not in ('ingreso','egreso') then
    raise exception 'p_tipo debe ser ingreso o egreso (recibido: %)', p_tipo;
  end if;
  v_monto := coalesce(p_monto, 0);
  if v_monto <= 0 then
    raise exception 'el monto del movimiento debe ser > 0';
  end if;

  select * into v_turno
    from public.turnos_caja t
   where t.empresa_id = v_emp
     and t.cerrado_en is null
     and (p_turno_id is null or t.id = p_turno_id)
   order by t.abierto_en desc
   limit 1;
  if not found then
    raise exception 'no hay turno de caja abierto para registrar movimientos';
  end if;

  v_mov := jsonb_build_object(
    'id',         gen_random_uuid(),
    'tipo',       p_tipo,
    'monto',      v_monto,
    'motivo',     coalesce(p_motivo, ''),
    'creada_en',  now(),
    'usuario',    auth.uid()
  );

  update public.turnos_caja
     set movimientos = jsonb_set(
           coalesce(movimientos, '{"movimientos":[]}'::jsonb),
           '{movimientos}',
           coalesce(movimientos->'movimientos', '[]'::jsonb) || v_mov,
           true
         )
   where id = v_turno.id and empresa_id = v_emp;

  return jsonb_build_object('turno_id', v_turno.id, 'movimiento', v_mov);
end $fn$;

-- cerrar_turno ← d({t:'turno-', usuario, contado})
-- Calcula el ESPERADO en cajón: fondo + ventas en efectivo de cuentas cerradas
-- durante el turno + ingresos − egresos. Guarda esperado/contado/diferencia y
-- un snapshot del detalle en movimientos. No exige turno (si no hay, error).
create or replace function public.cerrar_turno(
  p_contado       numeric,
  p_turno_id      uuid    default null,   -- null = turno abierto
  p_empresa_id    uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp      uuid;
  v_turno    public.turnos_caja;
  v_efectivo numeric;
  v_ingresos numeric;
  v_egresos  numeric;
  v_esperado numeric;
  v_dif      numeric;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  select * into v_turno
    from public.turnos_caja t
   where t.empresa_id = v_emp
     and t.cerrado_en is null
     and (p_turno_id is null or t.id = p_turno_id)
   order by t.abierto_en desc
   limit 1;
  if not found then
    raise exception 'no hay turno abierto que cerrar';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('turno:' || v_turno.id::text, 0));

  -- Efectivo cobrado mientras el turno estuvo abierto (cuentas cerradas en la
  -- ventana abierta_en → now).
  select coalesce(sum(p.monto), 0)::numeric into v_efectivo
    from public.pagos p
    join public.cuentas c on c.id = p.cuenta_id
   where p.empresa_id = v_emp
     and p.metodo = 'efectivo'
     and c.cerrada_en is not null
     and c.cerrada_en >= v_turno.abierto_en
     and c.cerrada_en <= now();

  -- (m->>'monto') es text: el cast va ANTES del sum, si no PostgreSQL protesta
  -- con «function sum(text) does not exist» (fix 2026-10-16).
  select coalesce(sum((m->>'monto')::numeric), 0) into v_ingresos
    from jsonb_array_elements(v_turno.movimientos->'movimientos') m
   where m->>'tipo' = 'ingreso';

  select coalesce(sum((m->>'monto')::numeric), 0) into v_egresos
    from jsonb_array_elements(v_turno.movimientos->'movimientos') m
   where m->>'tipo' = 'egreso';

  v_esperado := v_turno.fondo + coalesce(v_efectivo, 0)
                + coalesce(v_ingresos, 0) - coalesce(v_egresos, 0);
  v_dif := coalesce(p_contado, 0) - v_esperado;

  update public.turnos_caja t
     set cerrado_en = now(),
         cerrado_por = auth.uid(),
         contado     = p_contado,
         esperado    = v_esperado,
         movimientos = jsonb_set(
           coalesce(t.movimientos, '{"movimientos":[]}'::jsonb),
           '{cierre}',
           jsonb_build_object(
             'esperado',          v_esperado,
             'contado',           coalesce(p_contado, 0),
             'diferencia',        v_dif,
             'venta_efectivo',    v_efectivo,
             'ingresos_extra',    v_ingresos,
             'egresos_extra',     v_egresos,
             'fondo',             t.fondo,
             'cerrado_por',       auth.uid(),
             'cerrado_en',        now()
           ), true
         )
   where t.id = v_turno.id and t.empresa_id = v_emp;

  return jsonb_build_object(
    'turno_id',       v_turno.id,
    'fondo',          v_turno.fondo,
    'venta_efectivo', v_efectivo,
    'ingresos',       v_ingresos,
    'egresos',        v_egresos,
    'esperado',       v_esperado,
    'contado',        coalesce(p_contado, 0),
    'diferencia',     v_dif
  );
end $fn$;

-- ----------------------------------------------------------------------------
-- 3b) Permisos de ejecución de las RPCs
-- ----------------------------------------------------------------------------
revoke execute on function
  public.abrir_cuenta(uuid, uuid, integer),
  public.abrir_venta_directa(uuid),
  public.agregar_items(uuid, jsonb, uuid),
  public.cambiar_qty_item(uuid, integer, uuid),
  public.poner_nota(uuid, text, uuid),
  public.enviar_items(uuid, jsonb, uuid),
  public.anular_item(uuid, text, uuid),
  public.unir_mesas(uuid, jsonb, uuid),
  public.separar_mesa(uuid, uuid, uuid),
  public.mover_items(uuid, jsonb, uuid, uuid, uuid),
  public.aplicar_extras(uuid, numeric, numeric, text, uuid),
  public.pre_cuenta(uuid, uuid),
  public.reabrir_cuenta(uuid, uuid),
  public.cobrar_cuenta(uuid, jsonb, numeric, numeric, text, uuid),
  public.abrir_turno(uuid, numeric),
  public.registrar_movimiento_caja(text, numeric, text, uuid, uuid),
  public.cerrar_turno(numeric, uuid, uuid)
from public, anon;

grant execute on function
  public.abrir_cuenta(uuid, uuid, integer),
  public.abrir_venta_directa(uuid),
  public.agregar_items(uuid, jsonb, uuid),
  public.cambiar_qty_item(uuid, integer, uuid),
  public.poner_nota(uuid, text, uuid),
  public.enviar_items(uuid, jsonb, uuid),
  public.anular_item(uuid, text, uuid),
  public.unir_mesas(uuid, jsonb, uuid),
  public.separar_mesa(uuid, uuid, uuid),
  public.mover_items(uuid, jsonb, uuid, uuid, uuid),
  public.aplicar_extras(uuid, numeric, numeric, text, uuid),
  public.pre_cuenta(uuid, uuid),
  public.reabrir_cuenta(uuid, uuid),
  public.cobrar_cuenta(uuid, jsonb, numeric, numeric, text, uuid),
  public.abrir_turno(uuid, numeric),
  public.registrar_movimiento_caja(text, numeric, text, uuid, uuid),
  public.cerrar_turno(numeric, uuid, uuid)
to authenticated;

-- ----------------------------------------------------------------------------
-- 4) VISTA: estado de mesas por empresa (mesa + cuenta activa + total)
--    security_invoker = true ⇒ el RLS de las tablas base se aplica al query
--    (Supabase ≥ PG15). Funciona para SELECT realtime porque el usuario típico
--    tiene UNA membresía → empresa_activa() resuelve por fallback sin GUC.
-- ----------------------------------------------------------------------------
create or replace view public.v_estado_mesas
with (security_invoker = true)
as
select
  m.empresa_id,
  m.id            as mesa_id,
  m.nombre        as mesa,
  m.zona_id,
  m.x, m.y, m.w, m.h,
  m.forma, m.capacidad, m.activa,
  c.id            as cuenta_id,
  c.estado        as cuenta_estado,
  c.comensales,
  c.propina,
  c.descuento,
  coalesce(t.total_items, 0)::numeric(10,2)            as subtotal,
  (greatest(coalesce(t.total_items, 0) - coalesce(c.descuento, 0), 0)
        + coalesce(c.propina, 0))::numeric(10,2)        as total,
  coalesce(e.n_enviado, 0)                              as items_enviados,
  coalesce(e.n_pendiente, 0)                            as items_pendientes
from public.mesas m
left join lateral (
  select cc.*
    from public.cuentas cc
    join public.cuenta_mesas cm on cm.cuenta_id = cc.id
   where cm.mesa_id = m.id
     and cc.empresa_id = m.empresa_id
     and cc.estado <> 'cerrada'
   order by cc.abierta_en desc
   limit 1
) c on true
left join lateral (
  select sum(i.precio_snapshot * i.qty) as total_items
    from public.cuenta_items i
   where i.cuenta_id = c.id
     and i.estado <> 'anulado'
) t on true
left join lateral (
  select count(*) filter (where i.estado = 'enviado')   as n_enviado,
         count(*) filter (where i.estado = 'pendiente') as n_pendiente
    from public.cuenta_items i
   where i.cuenta_id = c.id
) e on true;

-- ----------------------------------------------------------------------------
-- 5) RLS: habilitado en TODAS + políticas SELECT/INSERT/UPDATE/DELETE por
--    empresa. Las subconsultas helper van envueltas en (select private.xxx())
--    para que el planner las evalúe como InitPlan (una vez por statement) y no
--    por fila.
-- ----------------------------------------------------------------------------
alter table public.empresas      enable row level security;
alter table public.perfiles      enable row level security;
alter table public.membresias    enable row level security;
alter table public.zonas         enable row level security;
alter table public.mesas         enable row level security;
alter table public.secciones_menu enable row level security;
alter table public.productos     enable row level security;
alter table public.cuentas       enable row level security;
alter table public.cuenta_mesas  enable row level security;
alter table public.cuenta_items  enable row level security;
alter table public.pagos         enable row level security;
alter table public.turnos_caja   enable row level security;

-- empresas: se ve solo de qué soy miembro (pantalla de selección en login).
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select to authenticated
  using ((select private.es_miembro_de(id)));
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas
  for update to authenticated
  using ((select private.empresa_ok(id)) and (select private.es_admin()))
  with check ((select private.empresa_ok(id)));

-- membresias: el propio usuario ve sus membresías (login) y los miembros de la
-- empresa activa pueden ver la lista (mostrar roles/compañeros). Escritura:
-- solo por SQL/dashboard o futuras RPCs de administración (sin GRANT directo).
drop policy if exists membresias_select on public.membresias;
create policy membresias_select on public.membresias
  for select to authenticated
  using (user_id = auth.uid()
         or empresa_id = (select private.empresa_activa()));

-- perfiles: el propio + colegas de empresa. Update: solo el propio.
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles
  for select to authenticated
  using (user_id = auth.uid() or (select private.comparte_empresa(user_id)));
drop policy if exists perfiles_insert on public.perfiles;
create policy perfiles_insert on public.perfiles
  for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Tablas de negocio genéricas: filtro empresa en las 4 operaciones. ----
-- Catalog (zonas/mesas/secciones_menu/productos): SELECT para todos los roles;
-- INSERT/UPDATE/DELETE directos SOLO admin (el alta/edición del menú y del
-- salón es tarea de admin; los clientes pueden usar estas tablas o RPCs futuras).
-- Negocio (cuentas/cuenta_mesas/cuenta_items/pagos/turnos_caja): SELECT para
-- todos los miembros de la empresa; el cliente NO tiene GRANT de escritura:
-- las mutaciones van por RPC (políticas abajo son defensa en profundidad por si
-- algún día se concede el permiso).

-- zonas
drop policy if exists zonas_select on public.zonas;
create policy zonas_select on public.zonas for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists zonas_insert on public.zonas;
create policy zonas_insert on public.zonas for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
drop policy if exists zonas_update on public.zonas;
create policy zonas_update on public.zonas for update to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists zonas_delete on public.zonas;
create policy zonas_delete on public.zonas for delete to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));

-- mesas
drop policy if exists mesas_select on public.mesas;
create policy mesas_select on public.mesas for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists mesas_insert on public.mesas;
create policy mesas_insert on public.mesas for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
drop policy if exists mesas_update on public.mesas;
create policy mesas_update on public.mesas for update to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists mesas_delete on public.mesas;
create policy mesas_delete on public.mesas for delete to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));

-- secciones_menu
drop policy if exists secciones_select on public.secciones_menu;
create policy secciones_select on public.secciones_menu for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists secciones_insert on public.secciones_menu;
create policy secciones_insert on public.secciones_menu for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
drop policy if exists secciones_update on public.secciones_menu;
create policy secciones_update on public.secciones_menu for update to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists secciones_delete on public.secciones_menu;
create policy secciones_delete on public.secciones_menu for delete to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));

-- productos
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists productos_insert on public.productos;
create policy productos_insert on public.productos for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
drop policy if exists productos_update on public.productos;
create policy productos_update on public.productos for update to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists productos_delete on public.productos;
create policy productos_delete on public.productos for delete to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));

-- cuentas
drop policy if exists cuentas_select on public.cuentas;
create policy cuentas_select on public.cuentas for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists cuentas_insert on public.cuentas;
create policy cuentas_insert on public.cuentas for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists cuentas_update on public.cuentas;
create policy cuentas_update on public.cuentas for update to authenticated
  using (empresa_id = (select private.empresa_activa()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists cuentas_delete on public.cuentas;
create policy cuentas_delete on public.cuentas for delete to authenticated
  using (empresa_id = (select private.empresa_activa()));

-- cuenta_mesas
drop policy if exists cuenta_mesas_select on public.cuenta_mesas;
create policy cuenta_mesas_select on public.cuenta_mesas for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists cuenta_mesas_insert on public.cuenta_mesas;
create policy cuenta_mesas_insert on public.cuenta_mesas for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists cuenta_mesas_update on public.cuenta_mesas;
create policy cuenta_mesas_update on public.cuenta_mesas for update to authenticated
  using (empresa_id = (select private.empresa_activa()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists cuenta_mesas_delete on public.cuenta_mesas;
create policy cuenta_mesas_delete on public.cuenta_mesas for delete to authenticated
  using (empresa_id = (select private.empresa_activa()));

-- cuenta_items
drop policy if exists cuenta_items_select on public.cuenta_items;
create policy cuenta_items_select on public.cuenta_items for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists cuenta_items_insert on public.cuenta_items;
create policy cuenta_items_insert on public.cuenta_items for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists cuenta_items_update on public.cuenta_items;
create policy cuenta_items_update on public.cuenta_items for update to authenticated
  using (empresa_id = (select private.empresa_activa()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists cuenta_items_delete on public.cuenta_items;
create policy cuenta_items_delete on public.cuenta_items for delete to authenticated
  using (empresa_id = (select private.empresa_activa()));

-- pagos
drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists pagos_insert on public.pagos;
create policy pagos_insert on public.pagos for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists pagos_update on public.pagos;
create policy pagos_update on public.pagos for update to authenticated
  using (empresa_id = (select private.empresa_activa()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists pagos_delete on public.pagos;
create policy pagos_delete on public.pagos for delete to authenticated
  using (empresa_id = (select private.empresa_activa()));

-- turnos_caja
drop policy if exists turnos_select on public.turnos_caja;
create policy turnos_select on public.turnos_caja for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
drop policy if exists turnos_insert on public.turnos_caja;
create policy turnos_insert on public.turnos_caja for insert to authenticated
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists turnos_update on public.turnos_caja;
create policy turnos_update on public.turnos_caja for update to authenticated
  using (empresa_id = (select private.empresa_activa()))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists turnos_delete on public.turnos_caja;
create policy turnos_delete on public.turnos_caja for delete to authenticated
  using (empresa_id = (select private.empresa_activa()));

-- ----------------------------------------------------------------------------
-- 5b) GRANTs de datos
--     authenticated: SELECT en todo; DML directo SOLO en catálogos + empresas
--     (config) + perfiles (el propio). Sin DML directo en tablas de negocio ni
--     en membresias.
-- ----------------------------------------------------------------------------
grant usage on schema public, private to authenticated;

grant select on
  public.empresas, public.perfiles, public.membresias,
  public.zonas, public.mesas, public.secciones_menu, public.productos,
  public.cuentas, public.cuenta_mesas, public.cuenta_items,
  public.pagos, public.turnos_caja, public.v_estado_mesas
to authenticated;

grant insert, update, delete on
  public.zonas, public.mesas, public.secciones_menu, public.productos,
  public.perfiles
to authenticated;

grant update on public.empresas to authenticated;   -- config (nombre, propina_pct…)

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Las políticas RLS se evalúan con el role que consulta (authenticated) y LLAMAN
-- a private.empresa_activa()/es_admin()/es_miembro_de()/etc., así que
-- authenticated NECESITA EXECUTE sobre las helpers de `private`. No hay riesgo
-- de exposición: PostgREST solo enruta funciones de `public` (schema expuesto);
-- `private` nunca es invocable por HTTP, solo desde políticas y RPCs server-side.
grant usage on schema private to authenticated;
revoke all on all functions in schema private from anon;
grant execute on all functions in schema private to authenticated;
-- Excepción: private.auditar() solo la llaman RPCs security definer, nunca un cliente.
revoke all on function private.auditar(uuid, text, jsonb, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) Trigger: crear public.perfiles al registrarse en Supabase Auth
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.perfiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name',
                           split_part(coalesce(new.email,''), '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 7) SEED COMENTADO (ejemplo "Demo Café Bs") — descomentar y ejecutar aparte.
--    Pasos: (1) crear empresa + catálogo, (2) que el dueño se registre en la
--    app (Auth sign up), (3) asignarse como ADMIN.
-- ============================================================================
--
-- -- (1) Empresa demo + catálogo. DO block idempotente, ids fijos de ejemplo:
-- do $seed$
-- declare
--   v_emp uuid := '11111111-1111-4111-8111-111111111111';
--   v_sal uuid := '22222222-2222-4222-8222-222222222222';
--   v_ter uuid := '33333333-3333-4333-8333-333333333333';
--   v_s1  uuid := '44444444-4444-4444-8444-444444444444';
--   v_s2  uuid := '55555555-5555-4555-8555-555555555555';
--   v_s3  uuid := '66666666-6666-4666-8666-666666666666';
-- begin
--   if exists (select 1 from public.empresas where id = v_emp) then
--     raise notice 'la empresa demo ya existe; seed omitido';
--     return;
--   end if;
--
--   insert into public.empresas (id, nombre, moneda, iva_pct, propina_pct)
--     values (v_emp, 'Demo Café Bs', 'Bs', 0, 10);
--
--   insert into public.zonas (id, empresa_id, nombre, orden) values
--     (v_sal, v_emp, 'Salón',   1),
--     (v_ter, v_emp, 'Terraza', 2);
--
--   -- Geometría en lienzo 1000×600 (idéntica a store.jsx: x=120+i*200, y=150…):
--   insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad) values
--     (v_emp, v_sal, 'Mesa 1', 120, 150, 110, 110, 'cuadrada', 4),
--     (v_emp, v_sal, 'Mesa 2', 320, 150, 110, 110, 'redonda',  4),
--     (v_emp, v_sal, 'Mesa 3', 520, 150, 110, 110, 'cuadrada', 4),
--     (v_emp, v_sal, 'Mesa 4', 720, 150, 110, 110, 'redonda',  4),
--     (v_emp, v_ter, 'Mesa 5', 300, 250, 150, 100, 'rect',     6);
--
--   insert into public.secciones_menu (id, empresa_id, nombre, orden) values
--     (v_s1, v_emp, 'Desayunos', 1),
--     (v_s2, v_emp, 'Comida',    2),
--     (v_s3, v_emp, 'Bebidas',   3);
--
--   insert into public.productos (empresa_id, seccion_id, nombre, precio) values
--     (v_emp, v_s1, 'Café',            10),
--     (v_emp, v_s1, 'Api con pastel',  12),
--     (v_emp, v_s1, 'Sándwich',        18),
--     (v_emp, v_s2, 'Milanesa',        45),
--     (v_emp, v_s2, 'Pique macho',     60),
--     (v_emp, v_s2, 'Sopa del día',    20),
--     (v_emp, v_s3, 'Jugo de naranja', 14),
--     (v_emp, v_s3, 'Refresco',        10),
--     (v_emp, v_s3, 'Cerveza',         25);
-- end $seed$;
--
-- -- (2) El dueño se REGISTRA en la app (Auth → Sign up) primero.
--
-- -- (3) Asignar el PRIMER ADMIN. Opción A (recomendada, desde el SQL editor,
-- --     referencia al usuario por su email porque auth.uid() es NULL acá):
-- insert into public.membresias (empresa_id, user_id, rol, pin_descuento_hash)
--   select '11111111-1111-4111-8111-111111111111', u.id, 'admin',
--          extensions.crypt('1234', extensions.gen_salt('bf'))   -- PIN demo: 1234
--     from auth.users u where u.email = 'dueno@demo.com'
--   on conflict (empresa_id, user_id) do update
--     set rol = 'admin',
--         pin_descuento_hash = excluded.pin_descuento_hash;
--
-- -- Opción B (NOTA del pedido: `update … set user_id = auth.uid()`): solo útil
-- -- cuando el SQL corre DENTRO de una sesión autenticada (una query transitoria
-- -- ejecutada desde el cliente con el JWT propio, o la futura RPC de alta de
-- -- miembros). En el SQL editor del Dashboard auth.uid() es NULL → usa Opción A.
-- --   insert into public.membresias (empresa_id, user_id, rol)
-- --     values ('11111111-1111-4111-8111-111111111111', auth.uid(), 'admin');
--
-- -- Para dar de alta cajeros/meseros/cocina/barra: crear sus cuentas en Auth y repetir
-- -- (3) con su email y rol; o (más adelante) una RPC admin add_membresia.
-- -- FIN SEED ==================================================================

-- ============================================================================
-- CHECKLIST POST-EJECUCIÓN (para el dueño del proyecto):
--  * Autenticación: habilitar Email/Password (o el proveedor elegido) en el
--    Dashboard → Authentication. El trigger de perfiles ya está creado.
--  * Realtime: Dashboard → Database → Replication → añadir la tabla
--    public.cuentas y public.mesas a la publicación `supabase_realtime` si se
--    quiere push de estados (opcional; v_estado_mesas se refresca por poll).
--  * Timezone del proyecto: America/La_Paz (Settings → Database → timezone o
--    a nivel rol) para que numero por día de venta_directa y "hoy" coincidan.
-- ============================================================================

-- ################################################################
-- ## 001 · super admin
-- ################################################################
-- ============================================================================
-- migraciones/001_super.sql · Super admin multiempresa + exportar/importar
-- Idempotente. Ejecutar como postgres en el SQL Editor (después de schema.sql).
-- ============================================================================

-- 5) listado global (solo super)
create or replace function public.super_listar_empresas()
returns table (id uuid, nombre text, codigo text, moneda text,
               usuarios bigint, mesas bigint, productos bigint,
               cuentas bigint, creada_en timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  return query
    select e.id, e.nombre, e.codigo, e.moneda,
      (select count(*) from public.membresias m where m.empresa_id = e.id),
      (select count(*) from public.mesas x where x.empresa_id = e.id),
      (select count(*) from public.productos p where p.empresa_id = e.id),
      (select count(*) from public.cuentas c where c.empresa_id = e.id),
      e.creada_en
    from public.empresas e order by e.creada_en;
end $$;
grant execute on function public.super_listar_empresas() to authenticated;

-- ################################################################
-- ## 002 · seguridad
-- ################################################################
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
-- 2) PLANES Y CUOTAS OCULTAS (Básico = 'gratis' · Premium = 'pago')
--    Básico: 20 artículos activos y 3 personas en el equipo (admin incluido).
--    Premium: sin límite. Los valores viven en private.plan_defaults() (UN solo sitio) y
--    en public.limites, tabla SIN grants ni políticas: el comercio NO puede leer ni
--    cambiar su cuota y nunca ve un número; solo un aviso genérico al tocar el tope.
--    Se exige en el servidor con triggers (catálogo y membresías se escriben por INSERT
--    directo o por RPC security definer). El super no cuenta ni se bloquea.
-- ----------------------------------------------------------------------------
create or replace function private.plan_defaults(p_plan text)
returns table (max_productos integer, max_miembros integer)
language sql
immutable
set search_path = ''
as $fn$
  select case when p_plan = 'pago' then null else 20 end,   -- artículos activos
         case when p_plan = 'pago' then null else 3  end;   -- personas en el equipo
$fn$;
revoke all on function private.plan_defaults(text) from public, anon, authenticated;

create table if not exists public.limites (
  empresa_id      uuid primary key references public.empresas(id) on delete cascade,
  max_productos   integer,                              -- NULL = sin límite
  max_miembros    integer,                              -- NULL = sin límite
  plan            text not null default 'gratis' check (plan in ('gratis','pago')),
  notas           text,                                 -- nota interna del super
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);
alter table public.limites add column if not exists max_miembros integer;
alter table public.limites enable row level security;
alter table public.limites force row level security;
revoke all on table public.limites from public, anon, authenticated;

-- Empresas existentes sin fila: nacen en Básico.
insert into public.limites (empresa_id, plan, max_productos, max_miembros)
select e.id, 'gratis', d.max_productos, d.max_miembros
  from public.empresas e, private.plan_defaults('gratis') d
on conflict (empresa_id) do nothing;

-- Migración única v0.14: SOLO toca lo que aún tiene el valor heredado. Volver a pegar
-- este archivo NO pisa los valores que el super haya puesto a mano.
update public.limites l
   set max_miembros = (select d.max_miembros from private.plan_defaults('gratis') d)
 where l.plan = 'gratis' and l.max_miembros is null;
update public.limites l
   set max_productos = (select d.max_productos from private.plan_defaults('gratis') d)
 where l.plan = 'gratis' and l.max_productos = 30;
update public.limites set max_productos = null, max_miembros = null where plan = 'pago';

create or replace function private.nueva_cuota_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.limites (empresa_id, plan, max_productos, max_miembros)
  select new.id, 'gratis', d.max_productos, d.max_miembros
    from private.plan_defaults('gratis') d
  on conflict (empresa_id) do nothing;
  return new;
end $fn$;
revoke all on function private.nueva_cuota_empresa() from public, anon, authenticated;

drop trigger if exists trg_nueva_cuota on public.empresas;
create trigger trg_nueva_cuota
  after insert on public.empresas
  for each row execute function private.nueva_cuota_empresa();

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
  if public.es_super() then return new; end if;

  select l.max_productos into v_max from public.limites l where l.empresa_id = new.empresa_id;
  if not found then                                   -- sin fila = Básico (falla cerrado)
    select d.max_productos into v_max from private.plan_defaults('gratis') d;
  end if;
  if v_max is null then return new; end if;           -- Premium

  if not coalesce(new.activo, true) then return new; end if;                 -- dar de baja siempre se puede
  if tg_op = 'UPDATE' and coalesce(old.activo, true) = coalesce(new.activo, true) then
    return new;                                        -- editar nombre/precio/foto no cuenta
  end if;

  perform pg_advisory_xact_lock(hashtext('cuota_productos:' || new.empresa_id::text));
  select count(*) into v_hay from public.productos where empresa_id = new.empresa_id and activo;
  if v_hay >= v_max then
    raise exception 'Llegaste al límite de artículos de tu plan Básico. Para agregar más, solicita el plan Premium.'
      using errcode = '22000';
  end if;
  return new;
end $fn$;
revoke all on function private.controlar_cuota_productos() from public, anon, authenticated;

drop trigger if exists trg_controlar_cuota on public.productos;
create trigger trg_controlar_cuota
  before insert or update on public.productos
  for each row execute function private.controlar_cuota_productos();

create or replace function private.controlar_cuota_miembros()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_max integer;
  v_hay integer;
begin
  if public.es_super() then return new; end if;

  select l.max_miembros into v_max from public.limites l where l.empresa_id = new.empresa_id;
  if not found then
    select d.max_miembros into v_max from private.plan_defaults('gratis') d;
  end if;
  if v_max is null then return new; end if;           -- Premium

  -- Serializa altas simultáneas de la misma empresa (si no, dos invitaciones a la vez
  -- podrían colarse las dos con el cupo en 2/3).
  perform pg_advisory_xact_lock(hashtext('cuota_miembros:' || new.empresa_id::text));
  select count(*) into v_hay from public.membresias where empresa_id = new.empresa_id;
  if v_hay >= v_max then
    raise exception 'Llegaste al límite de personas de tu plan Básico. Para sumar más gente al equipo, solicita el plan Premium.'
      using errcode = '22000';
  end if;
  return new;
end $fn$;
revoke all on function private.controlar_cuota_miembros() from public, anon, authenticated;

drop trigger if exists trg_cuota_miembros on public.membresias;
create trigger trg_cuota_miembros
  before insert on public.membresias
  for each row execute function private.controlar_cuota_miembros();

-- RPC del super: ajuste fino (valores a mano). NULL en un máximo = sin límite.
drop function if exists public.super_ajustar_empresa(uuid, integer, text, text);
create or replace function public.super_ajustar_empresa(
  p_empresa       uuid,
  p_max_productos integer default null,
  p_plan          text    default null,
  p_notas         text    default null,
  p_max_miembros  integer default null
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
  v_prod integer;
  v_miem integer;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_empresa is null or not exists (select 1 from public.empresas e where e.id = p_empresa) then
    raise exception 'empresa inexistente';
  end if;
  if v_plan not in ('gratis','pago') then raise exception 'plan inválido'; end if;
  if p_max_productos is not null and p_max_productos < 1 then
    raise exception 'el máximo de artículos debe ser 1 o más (vacío = sin límite)';
  end if;
  if p_max_miembros is not null and p_max_miembros < 1 then
    raise exception 'el máximo de personas debe ser 1 o más (vacío = sin límite)';
  end if;

  -- Premium ⇒ sin límite. Básico ⇒ lo que mande el super o, si no manda nada, el defecto.
  if v_plan = 'pago' then
    v_prod := null; v_miem := null;
  else
    select coalesce(p_max_productos, d.max_productos),
           coalesce(p_max_miembros,  d.max_miembros)
      into v_prod, v_miem
      from private.plan_defaults('gratis') d;
  end if;

  insert into public.limites (empresa_id, plan, max_productos, max_miembros, notas, actualizado_en, actualizado_por)
  values (p_empresa, v_plan, v_prod, v_miem, p_notas, now(), auth.uid())
  on conflict (empresa_id) do update
    set plan           = excluded.plan,
        max_productos  = excluded.max_productos,
        max_miembros   = excluded.max_miembros,
        notas          = coalesce(excluded.notas, limites.notas),
        actualizado_en = now(),
        actualizado_por = excluded.actualizado_por;
  perform private.auditar(p_empresa, 'super_ajustar_cuota',
    jsonb_build_object('plan', v_plan, 'max_productos', v_prod, 'max_miembros', v_miem));
  return jsonb_build_object('plan', v_plan, 'max_productos', v_prod, 'max_miembros', v_miem);
end $fn$;
revoke all on function public.super_ajustar_empresa(uuid, integer, text, text, integer) from public, anon;
grant execute on function public.super_ajustar_empresa(uuid, integer, text, text, integer) to authenticated;

-- Pasar de plan con un clic (valores por defecto del plan).
create or replace function public.super_cambiar_plan(p_empresa uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prod integer;
  v_miem integer;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_plan not in ('gratis', 'pago') then raise exception 'plan inválido (gratis | pago)'; end if;
  if p_empresa is null or not exists (select 1 from public.empresas e where e.id = p_empresa) then
    raise exception 'empresa inexistente';
  end if;

  select d.max_productos, d.max_miembros into v_prod, v_miem from private.plan_defaults(p_plan) d;

  insert into public.limites (empresa_id, plan, max_productos, max_miembros, actualizado_en, actualizado_por)
  values (p_empresa, p_plan, v_prod, v_miem, now(), auth.uid())
  on conflict (empresa_id) do update
    set plan = excluded.plan,
        max_productos = excluded.max_productos,
        max_miembros  = excluded.max_miembros,
        actualizado_en = now(),
        actualizado_por = excluded.actualizado_por;

  perform private.auditar(p_empresa, 'super_cambio_plan',
    jsonb_build_object('plan', p_plan, 'max_productos', v_prod, 'max_miembros', v_miem));
  return jsonb_build_object('plan', p_plan, 'max_productos', v_prod, 'max_miembros', v_miem);
end $fn$;
revoke all on function public.super_cambiar_plan(uuid, text) from public, anon;
grant execute on function public.super_cambiar_plan(uuid, text) to authenticated;

-- Lectura de cuota y uso para el panel del super (nunca para el comercio).
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
    'plan',               (select l.plan          from public.limites l where l.empresa_id = p_empresa),
    'max_productos',      (select l.max_productos from public.limites l where l.empresa_id = p_empresa),
    'max_miembros',       (select l.max_miembros  from public.limites l where l.empresa_id = p_empresa),
    'notas',              (select l.notas         from public.limites l where l.empresa_id = p_empresa),
    'productos_actuales', (select count(*) from public.productos p where p.empresa_id = p_empresa and p.activo),
    'miembros_actuales',  (select count(*) from public.membresias m where m.empresa_id = p_empresa)
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
    v_rol := case when r->>'rol' in ('admin','cajero','mesero','cocina','barra') then r->>'rol' else 'cajero' end;
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
                                     precio_snapshot, qty, estado, nota, motivo_anulacion, enviado_en, areas)
    values (v_emp, v_cuenta, v_old,
            coalesce(nullif(r->>'nombre_snapshot',''),'(importado)'),
            coalesce((r->>'precio_snapshot')::numeric, 0),
            greatest(1, coalesce((r->>'qty')::int, 1)),
            case when coalesce(r->>'estado','pendiente') in ('pendiente','enviado','listo','anulacion','anulado')
                 then r->>'estado' else 'pendiente' end,
            coalesce(r->>'nota',''), r->>'motivo_anulacion',
            (r->>'enviado_en')::timestamptz,
            coalesce((select p.areas from public.productos p where p.id = v_old), array['cocina']::text[]));
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

-- ################################################################
-- ## 003 · comensales
-- ################################################################
-- ============================================================================
-- migraciones/003_comensales.sql · Asignar / corregir el número de comensales
-- Idempotente. Ejecutar DESPUÉS de schema.sql, 001_super.sql y 002_seguridad.sql.
--
-- Por qué hace falta: el CONTRATO solo traía comensales en `abrir_cuenta`, así que
-- el salón no podía corregirlos después (Soft Restaurant permite moverlos en
-- cualquier momento de la comida). Se hace por RPC y no con un UPDATE directo a
-- public.cuentas porque el UPDATE abierto no sabe si la cuenta ya está cerrada
-- (el comensal de un ticket cobrado no debe cambiar) ni deja rastro en la
-- auditoría.
-- ============================================================================

create or replace function public.actualizar_comensales(
  p_cuenta_id   uuid,
  p_comensales  integer,
  p_empresa_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_n   integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);

  -- El rango es el mismo del CHECK de la tabla (cuentas.comensales 1..99):
  -- se rechaza aquí para devolver el mensaje en español en vez de un 23514.
  v_n := coalesce(p_comensales, 0);
  if v_n < 1 or v_n > 99 then
    raise exception 'El número de comensales debe estar entre 1 y 99';
  end if;

  update public.cuentas set comensales = v_n
   where id = p_cuenta_id and empresa_id = v_emp and estado <> 'cerrada';
  if not found then
    raise exception 'No se pudo cambiar los comensales: la cuenta no está abierta en esta empresa';
  end if;

  -- Deja rastro solo si la migración 002 está aplicada (instalaciones sin ella
  -- seguirían funcionando; una excepción aquí abortaría el cambio).
  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'comensales',
      jsonb_build_object('cuenta', p_cuenta_id::text, 'comensales', v_n));
  end if;

  return v_n;
end $fn$;

revoke all on function public.actualizar_comensales(uuid, integer, uuid) from public, anon;
grant execute on function public.actualizar_comensales(uuid, integer, uuid) to authenticated;

-- Verificación: la función existe y solo authenticated puede ejecutarla.
select 'funcion' as objeto, p.proname as nombre,
       (select count(*) from pg_proc q where q.oid = p.oid) as hay
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'actualizar_comensales';

-- ################################################################
-- ## 004 · altas y equipo
-- ################################################################
-- ============================================================================
-- migraciones/004_altas.sql · Alta self-service de empresa + gestión de equipo
-- Idempotente. Ejecutar DESPUÉS de schema.sql, 001_super.sql y 002_seguridad.sql
-- (y, por convención, después de 003_comensales.sql).
--
-- Requiere 001 (public.supers / public.es_super() y el patrón de INSERT directo
-- a auth.users de super_importar_empresa) y 002 (private.auditar, public.es_super,
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
                         'codigo',  v_codigo),
      'empresa', (select e.nombre from public.empresas e where e.id = v_emp));
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

  if coalesce(p_rol, '') not in ('admin','cajero','mesero','cocina','barra') then
    raise exception 'El rol debe ser admin, cajero, mesero, cocina o barra';
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
      jsonb_build_object('usuario', v_new::text, 'correo', v_email, 'rol', p_rol),
      'usuario', coalesce(nullif(trim(p_nombre), ''), v_email));
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
      jsonb_build_object('usuario', p_usuario_id::text),
      'usuario', coalesce(nullif((select pf.display_name from public.perfiles pf
                                   where pf.user_id = p_usuario_id), ''),
                          (select u.email from auth.users u where u.id = p_usuario_id)));
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

-- ################################################################
-- ## 006 · empresas para el login
-- ################################################################
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

-- ################################################################
-- ## 007 · cola de impresión (estación de impresión del local)
-- ################################################################
-- Los teléfonos de meseros y cajeros NO hablan con la impresora: dejan el trabajo en esta cola
-- (RPC encolar_impresion) y la PC del local, con la pestaña "Impresión" abierta, lo reclama
-- (reclamar_impresion, atómico y sin duplicar aunque haya 2 estaciones) y lo imprime en la
-- impresora de su grupo (Cocina, Barra, Caja…). Sin IPs ni configuración de red.
-- La tabla es de SOLO LECTURA para el cliente: todo cambio pasa por RPCs con control de rol.
create table if not exists public.trabajos_impresion (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  grupo        text not null check (char_length(grupo) between 1 and 60),
  titulo       text not null default '',
  payload      jsonb not null,                       -- {lineas:[...], ancho, corte, beep}
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','imprimiendo','impreso','error')),
  intentos     integer not null default 0,
  error        text,
  creado_por   uuid references auth.users(id),
  creado_en    timestamptz not null default now(),
  tomado_en    timestamptz,
  terminado_en timestamptz
);
create index if not exists idx_trabajos_impresion_cola
  on public.trabajos_impresion (empresa_id, estado, creado_en);

alter table public.trabajos_impresion enable row level security;
drop policy if exists trabajos_impresion_select on public.trabajos_impresion;
create policy trabajos_impresion_select on public.trabajos_impresion for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
-- sin políticas de insert/update/delete + sin privilegios: solo escriben las RPCs (security definer)
revoke all on public.trabajos_impresion from public, anon;
revoke insert, update, delete, truncate on public.trabajos_impresion from authenticated;
grant select on public.trabajos_impresion to authenticated;

-- Realtime (aviso instantáneo a la estación). Si la publicación no existe o ya la tiene, no pasa nada:
-- la estación además consulta la cola cada pocos segundos.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'trabajos_impresion') then
    alter publication supabase_realtime add table public.trabajos_impresion;
  end if;
exception when others then
  null;
end $$;

-- encolar_impresion: meseros, cajeros y admin dejan 1..20 trabajos [{grupo,titulo,payload}].
create or replace function public.encolar_impresion(
  p_trabajos   jsonb,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  t     jsonb;
  v_n   integer := 0;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);

  if p_trabajos is null or jsonb_typeof(p_trabajos) <> 'array' then
    raise exception 'Trabajos de impresión inválidos';
  end if;
  if jsonb_array_length(p_trabajos) = 0 or jsonb_array_length(p_trabajos) > 20 then
    raise exception 'Se admiten de 1 a 20 trabajos de impresión por envío';
  end if;

  for t in select * from jsonb_array_elements(p_trabajos) loop
    if coalesce(t->>'grupo', '') = '' or char_length(t->>'grupo') > 60 then
      raise exception 'Falta el grupo de impresión';
    end if;
    if jsonb_typeof(t->'payload') <> 'object'
       or jsonb_typeof(t->'payload'->'lineas') <> 'array'
       or jsonb_array_length(t->'payload'->'lineas') > 400
       or length(t->>'payload') > 60000 then
      raise exception 'El contenido a imprimir es inválido o demasiado grande';
    end if;
    insert into public.trabajos_impresion (empresa_id, grupo, titulo, payload, creado_por)
    values (v_emp, t->>'grupo', left(coalesce(t->>'titulo', ''), 120), t->'payload', auth.uid());
    v_n := v_n + 1;
  end loop;

  -- Limpieza: el historial de la cola solo sirve unos días.
  delete from public.trabajos_impresion
   where empresa_id = v_emp and creado_en < now() - interval '3 days';

  return v_n;
end $fn$;
revoke all on function public.encolar_impresion(jsonb, uuid) from public, anon;
grant execute on function public.encolar_impresion(jsonb, uuid) to authenticated;

-- reclamar_impresion: la estación toma los trabajos pendientes de SUS grupos (los que puede imprimir).
-- Atómico (for update skip locked): dos estaciones nunca imprimen el mismo trabajo. Un trabajo que
-- quedó "imprimiendo" más de 2 minutos (estación caída) vuelve a la cola una vez; luego pasa a error.
create or replace function public.reclamar_impresion(
  p_grupos     jsonb   default null,
  p_limite     integer default 10,
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_lim integer := least(greatest(coalesce(p_limite, 10), 1), 25);
  v     jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  update public.trabajos_impresion
     set estado = case when intentos >= 2 then 'error' else 'pendiente' end,
         error  = case when intentos >= 2 then 'La estación dejó de responder mientras imprimía' else error end,
         terminado_en = case when intentos >= 2 then now() else terminado_en end
   where empresa_id = v_emp and estado = 'imprimiendo'
     and tomado_en < now() - interval '2 minutes';

  with c as (
    select id from public.trabajos_impresion
     where empresa_id = v_emp and estado = 'pendiente'
       and (p_grupos is null
            or grupo in (select jsonb_array_elements_text(p_grupos)))
     order by creado_en
     limit v_lim
     for update skip locked
  ), u as (
    update public.trabajos_impresion t
       set estado = 'imprimiendo', intentos = t.intentos + 1, tomado_en = now(), error = null
      from c where t.id = c.id
    returning t.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'grupo', u.grupo, 'titulo', u.titulo,
           'payload', u.payload, 'intentos', u.intentos, 'creado_en', u.creado_en)
         order by u.creado_en), '[]'::jsonb)
    into v from u;
  return v;
end $fn$;
revoke all on function public.reclamar_impresion(jsonb, integer, uuid) from public, anon;
grant execute on function public.reclamar_impresion(jsonb, integer, uuid) to authenticated;

-- finalizar_impresion: la estación informa el resultado (ok / error con motivo).
create or replace function public.finalizar_impresion(
  p_id         uuid,
  p_ok         boolean,
  p_error      text default null,
  p_empresa_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  update public.trabajos_impresion
     set estado = case when coalesce(p_ok, false) then 'impreso' else 'error' end,
         error  = case when coalesce(p_ok, false) then null else left(coalesce(p_error, 'Error de impresión'), 300) end,
         terminado_en = now()
   where id = p_id and empresa_id = v_emp and estado = 'imprimiendo';
  return found;
end $fn$;
revoke all on function public.finalizar_impresion(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.finalizar_impresion(uuid, boolean, text, uuid) to authenticated;

-- listar_impresion: últimos trabajos (sin el contenido) para la pantalla de la estación.
create or replace function public.listar_impresion(
  p_limite     integer default 40,
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v     jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  select coalesce(jsonb_agg(r order by (r->>'creado_en') desc), '[]'::jsonb) into v
    from (
      select jsonb_build_object('id', t.id, 'grupo', t.grupo, 'titulo', t.titulo, 'estado', t.estado,
                                'error', t.error, 'intentos', t.intentos, 'creado_en', t.creado_en) as r
        from public.trabajos_impresion t
       where t.empresa_id = v_emp
       order by t.creado_en desc
       limit least(greatest(coalesce(p_limite, 40), 1), 100)
    ) q;
  return v;
end $fn$;
revoke all on function public.listar_impresion(integer, uuid) from public, anon;
grant execute on function public.listar_impresion(integer, uuid) to authenticated;

-- gestionar_impresion: 'reintentar' (error/imprimiendo → pendiente), 'descartar' (borra un trabajo
-- no impreso) o 'descartar_todo' (borra todos los pendientes y con error de la empresa).
create or replace function public.gestionar_impresion(
  p_accion     text,
  p_id         uuid default null,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_n   integer := 0;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  if p_accion = 'reintentar' then
    update public.trabajos_impresion
       set estado = 'pendiente', error = null, intentos = 0, terminado_en = null
     where id = p_id and empresa_id = v_emp and estado in ('error','imprimiendo');
  elsif p_accion = 'descartar' then
    delete from public.trabajos_impresion
     where id = p_id and empresa_id = v_emp and estado <> 'impreso';
  elsif p_accion = 'descartar_todo' then
    delete from public.trabajos_impresion
     where empresa_id = v_emp and estado in ('pendiente','error','imprimiendo');
  else
    raise exception 'Acción de impresión desconocida';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;
revoke all on function public.gestionar_impresion(text, uuid, uuid) from public, anon;
grant execute on function public.gestionar_impresion(text, uuid, uuid) to authenticated;

commit;

-- ################################################################
-- ## 008 · retención de datos (plan gratis = 6 meses), «mi plan» y exportar mis datos
-- ################################################################
-- · Plan gratis: cada noche se borran de verdad las ventas cerradas, turnos cerrados y registros
--   de auditoría con más de `retencion_meses` (6 por defecto). Mesas, menú, imágenes y equipo
--   NO se tocan. El plan 'pago' no se purga nunca.
-- · Borrar un artículo/sección desde la app ya BORRA la fila (y la imagen en Storage); los items
--   de ventas viejas conservan nombre y precio (snapshot), por eso no se rompe el historial.
-- · El admin de cada empresa puede bajar una copia de sus datos (exportar_mi_empresa).
alter table public.limites add column if not exists retencion_meses integer not null default 6;
alter table public.limites drop constraint if exists limites_retencion_chk;
alter table public.limites add constraint limites_retencion_chk check (retencion_meses between 1 and 120);

create or replace function private.purgar_datos_antiguos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cuentas integer := 0; v_turnos integer := 0; v_aud integer := 0; v_thr integer := 0;
begin
  with b as (
    delete from public.cuentas c using public.limites l
     where l.empresa_id = c.empresa_id and l.plan = 'gratis'
       and c.estado = 'cerrada'
       and c.cerrada_en < now() - make_interval(months => l.retencion_meses)
    returning 1)
  select count(*) into v_cuentas from b;       -- cascada: cuenta_items, pagos, cuenta_mesas

  with b as (
    delete from public.turnos_caja t using public.limites l
     where l.empresa_id = t.empresa_id and l.plan = 'gratis'
       and t.cerrado_en is not null
       and t.cerrado_en < now() - make_interval(months => l.retencion_meses)
    returning 1)
  select count(*) into v_turnos from b;

  with b as (
    delete from public.auditoria a
     where (a.empresa_id is not null and exists (
              select 1 from public.limites l
               where l.empresa_id = a.empresa_id and l.plan = 'gratis'
                 and a.en < now() - make_interval(months => l.retencion_meses)))
        or (a.empresa_id is null and a.en < now() - interval '12 months')
    returning 1)
  select count(*) into v_aud from b;

  with b as (delete from public.throttle where hasta < now() - interval '1 day' returning 1)
  select count(*) into v_thr from b;

  if v_cuentas + v_turnos + v_aud > 0 then
    insert into public.auditoria (empresa_id, actor, accion, detalle)
    values (null, null, 'purga_retencion',
            jsonb_build_object('cuentas', v_cuentas, 'turnos', v_turnos, 'auditoria', v_aud));
  end if;
  return jsonb_build_object('cuentas', v_cuentas, 'turnos', v_turnos, 'auditoria', v_aud, 'throttle', v_thr);
end $fn$;
revoke all on function private.purgar_datos_antiguos() from public, anon, authenticated;

-- Para probarla a mano desde el panel de super / SQL (solo super).
create or replace function public.super_purgar_ahora()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  return private.purgar_datos_antiguos();
end $fn$;
revoke all on function public.super_purgar_ahora() from public, anon;
grant execute on function public.super_purgar_ahora() to authenticated;

-- Programación diaria (04:30 UTC ≈ 00:30 en Bolivia). Si pg_cron no está habilitado, avisa y
-- sigue: se activa en Database → Extensions → pg_cron y se vuelve a pegar este archivo.
do $do$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('pos-purga-retencion', '30 4 * * *', 'select private.purgar_datos_antiguos()');
exception when others then
  raise notice 'pg_cron no disponible (%): la purga automática NO está programada.', sqlerrm;
end $do$;

-- Plan y retención de la empresa activa (cualquier miembro).
create or replace function public.mi_plan(p_empresa_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_emp uuid; v jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  select jsonb_build_object(
           'plan', l.plan,
           'retencion_meses', case when l.plan = 'gratis' then l.retencion_meses end)
    into v from public.limites l where l.empresa_id = v_emp;
  return coalesce(v, jsonb_build_object('plan', 'gratis', 'retencion_meses', 6));
end $fn$;
revoke all on function public.mi_plan(uuid) from public, anon;
grant execute on function public.mi_plan(uuid) to authenticated;

-- Copia completa de MI empresa (admin): mismo formato que super_exportar_empresa, importable
-- con super_importar_empresa en otro proyecto (plan de pago / migración).
create or replace function public.exportar_mi_empresa(p_empresa_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_emp uuid; v jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);
  select jsonb_build_object(
    'version', 2,
    'exportado_en', now(),
    'empresa', (select to_jsonb(e) from public.empresas e where e.id = v_emp),
    'zonas',       coalesce((select jsonb_agg(to_jsonb(z) order by z.orden) from public.zonas z where z.empresa_id = v_emp), '[]'),
    'mesas',       coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('zona_nombre',
                                      (select z.nombre from public.zonas z where z.id = m.zona_id)))
                                 from public.mesas m where m.empresa_id = v_emp), '[]'),
    'secciones',   coalesce((select jsonb_agg(to_jsonb(s) order by s.orden) from public.secciones_menu s where s.empresa_id = v_emp), '[]'),
    'productos',   coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('seccion_nombre', s.nombre)) from public.productos p
                             left join public.secciones_menu s on s.id = p.seccion_id where p.empresa_id = v_emp), '[]'),
    'cuentas',     coalesce((select jsonb_agg(to_jsonb(c)) from public.cuentas c where c.empresa_id = v_emp), '[]'),
    'cuenta_mesas',coalesce((select jsonb_agg(to_jsonb(cm)) from public.cuenta_mesas cm
                             join public.cuentas c on c.id = cm.cuenta_id where c.empresa_id = v_emp), '[]'),
    'cuenta_items',coalesce((select jsonb_agg(to_jsonb(ci)) from public.cuenta_items ci
                             join public.cuentas c on c.id = ci.cuenta_id where c.empresa_id = v_emp), '[]'),
    'pagos',       coalesce((select jsonb_agg(to_jsonb(pg)) from public.pagos pg
                             join public.cuentas c on c.id = pg.cuenta_id where c.empresa_id = v_emp), '[]'),
    'turnos',      coalesce((select jsonb_agg(to_jsonb(t)) from public.turnos_caja t where t.empresa_id = v_emp), '[]'),
    'equipo',      coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'correo', u.email,
                                                                 'rol', m.rol, 'nombre', coalesce(p.display_name,'')))
                             from public.membresias m
                             join auth.users u on u.id = m.user_id
                             left join public.perfiles p on p.user_id = m.user_id
                             where m.empresa_id = v_emp), '[]')
  ) into v;
  perform private.auditar(v_emp, 'exportar_datos', '{}'::jsonb);
  return v;
end $fn$;
revoke all on function public.exportar_mi_empresa(uuid) from public, anon;
grant execute on function public.exportar_mi_empresa(uuid) to authenticated;

-- ################################################################
-- ## 009 · cocina/barra · áreas por ítem · salida y anulación con aprobación ·
-- ##         auditoría local · inventario · super admin fusionado
-- ################################################################
-- Roles nuevos (cocina, barra) SIN tocar los permisos de dinero: cobrar, turnos,
-- movimientos de caja, import/export y gestión de equipo siguen siendo admin/cajero.
-- Los ítems ahora llevan su área (snapshot de productos.areas) y estados extendidos
-- ('listo' y 'anulacion' con solicitud + aprobación). Las tablas de inventario se
-- crean acá y cobrar_cuenta ya descuenta su stock (best-effort, arriba en §cobrar).
begin;

-- ----------------------------------------------------------------------------
-- A) ROL · cocina y barra en membresías (constraint con nombre estable).
-- ----------------------------------------------------------------------------
alter table public.membresias drop constraint if exists membresias_rol_check;
alter table public.membresias add constraint membresias_rol_check
  check (rol in ('admin','cajero','mesero','cocina','barra'));

-- ----------------------------------------------------------------------------
-- B) MULTI-ÁREA · un combo puede ir a cocina Y barra a la vez.
--    productos.areas = origen; cuenta_items.areas = snapshot al insertar
--    (agregar_items y la importación ya copian p.areas).
-- ----------------------------------------------------------------------------
alter table public.productos add column if not exists areas text[] not null default array['cocina']::text[];
alter table public.productos drop constraint if exists productos_areas_chk;
alter table public.productos add constraint productos_areas_chk
  check (areas <@ array['cocina','barra']::text[] and coalesce(array_length(areas, 1), 0) > 0);

alter table public.cuenta_items add column if not exists areas text[] not null default array['cocina']::text[];

-- ----------------------------------------------------------------------------
-- C) ESTADOS · 'listo' y 'anulacion' (anulación pedida, no aprobada aún).
--    Primero el update defensivo (base vieja con valores raros), luego el CHECK.
-- ----------------------------------------------------------------------------
update public.cuenta_items
   set estado = 'enviado'
 where estado not in ('pendiente','enviado','listo','anulacion','anulado');
alter table public.cuenta_items drop constraint if exists cuenta_items_estado_check;
alter table public.cuenta_items add constraint cuenta_items_estado_check
  check (estado in ('pendiente','enviado','listo','anulacion','anulado'));

alter table public.cuenta_items add column if not exists listo_en              timestamptz;
alter table public.cuenta_items add column if not exists anulacion_motivo      text;
alter table public.cuenta_items add column if not exists anulacion_por         uuid;
alter table public.cuenta_items add column if not exists anulacion_pedida_en   timestamptz;
alter table public.cuenta_items add column if not exists anulacion_estado_previo text;
alter table public.cuenta_items add column if not exists anulacion_resuelta_por uuid;
alter table public.cuenta_items add column if not exists anulacion_resuelta_en  timestamptz;

-- marcar_salida: cocina/barra/admin/cajero pasan ítems 'enviado' → 'listo'.
create or replace function public.marcar_salida(
  p_item_ids   jsonb,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_n   integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','cocina','barra']::text[]);

  if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array' then
    raise exception 'Debe enviar una lista de ítems';
  end if;

  update public.cuenta_items
     set estado = 'listo', listo_en = now()
   where empresa_id = v_emp
     and estado = 'enviado'
     and id in (select "value"::uuid from jsonb_array_elements_text(p_item_ids));

  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.auditar(v_emp, 'item_salida',
      jsonb_build_object('items', v_n),
      'cuenta_item',
      (select coalesce(string_agg(s.nombre_snapshot, ', '), (v_n)::text || ' ítems')
         from (select ci.nombre_snapshot
                 from public.cuenta_items ci
                where ci.empresa_id = v_emp
                  and ci.id in (select "value"::uuid from jsonb_array_elements_text(p_item_ids))
                limit 6) s));
  end if;
  return v_n;
end $fn$;
revoke all on function public.marcar_salida(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.marcar_salida(jsonb, uuid) to authenticated;

-- deshacer_salida: 'listo' → 'enviado' (se limpió la salida por error).
create or replace function public.deshacer_salida(
  p_item_ids   jsonb,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_n   integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','cocina','barra']::text[]);

  if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array' then
    raise exception 'Debe enviar una lista de ítems';
  end if;

  update public.cuenta_items
     set estado = 'enviado', listo_en = null
   where empresa_id = v_emp
     and estado = 'listo'
     and id in (select "value"::uuid from jsonb_array_elements_text(p_item_ids));

  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.auditar(v_emp, 'item_salida_deshacer',
      jsonb_build_object('items', v_n),
      'cuenta_item',
      (select coalesce(string_agg(s.nombre_snapshot, ', '), (v_n)::text || ' ítems')
         from (select ci.nombre_snapshot
                 from public.cuenta_items ci
                where ci.empresa_id = v_emp
                  and ci.id in (select "value"::uuid from jsonb_array_elements_text(p_item_ids))
                limit 6) s));
  end if;
  return v_n;
end $fn$;
revoke all on function public.deshacer_salida(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.deshacer_salida(jsonb, uuid) to authenticated;

-- pedir_anulacion: cualquier rol pide anular un ítem ENVIADO o LISTO (motivo obligatorio).
-- El ítem queda en 'anulacion' hasta que admin/cajero resuelva con resolver_anulacion.
create or replace function public.pedir_anulacion(
  p_item_id    uuid,
  p_motivo     text,
  p_empresa_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_it  public.cuenta_items;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero','cocina','barra']::text[]);

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select * into v_it from public.cuenta_items
   where id = p_item_id and empresa_id = v_emp;
  if not found then
    raise exception 'ítem inexistente en la empresa activa';
  end if;
  perform private.load_cuenta(v_it.cuenta_id, array['abierta','precuenta']::text[]);

  if v_it.estado not in ('enviado','listo') then
    raise exception 'Solo se puede pedir anulación de un ítem enviado o listo (estado actual: %)', v_it.estado;
  end if;

  update public.cuenta_items
     set estado = 'anulacion',
         anulacion_estado_previo = v_it.estado,
         anulacion_motivo        = trim(p_motivo),
         anulacion_por           = auth.uid(),
         anulacion_pedida_en     = now(),
         anulacion_resuelta_por  = null,
         anulacion_resuelta_en   = null
   where id = p_item_id;

  perform private.auditar(v_emp, 'item_anulacion_pedida', jsonb_build_object(
    'item', p_item_id::text, 'cuenta', v_it.cuenta_id::text, 'motivo', trim(p_motivo)),
    'cuenta_item', v_it.nombre_snapshot);
  return true;
end $fn$;
revoke all on function public.pedir_anulacion(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.pedir_anulacion(uuid, text, uuid) to authenticated;

-- resolver_anulacion: admin/cajero aprueba (ítem → 'anulado') o rechaza (vuelve al
-- estado previo y se limpian los campos de la solicitud). El corte directo de
-- anular_item sigue existiendo para admin/cajero sin pasar por acá.
create or replace function public.resolver_anulacion(
  p_item_id    uuid,
  p_aprobar    boolean,
  p_motivo     text default null,
  p_empresa_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_it  public.cuenta_items;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  select * into v_it from public.cuenta_items
   where id = p_item_id and empresa_id = v_emp;
  if not found then
    raise exception 'ítem inexistente en la empresa activa';
  end if;
  if v_it.estado <> 'anulacion' then
    raise exception 'Ese ítem no tiene una anulación pendiente';
  end if;

  if coalesce(p_aprobar, false) then
    update public.cuenta_items
       set estado = 'anulado',
           motivo_anulacion = coalesce(nullif(trim(p_motivo), ''), v_it.anulacion_motivo, 'sin motivo'),
           anulacion_resuelta_por = auth.uid(),
           anulacion_resuelta_en  = now()
     where id = p_item_id;
  else
    update public.cuenta_items
       set estado = coalesce(v_it.anulacion_estado_previo, 'enviado'),
           anulacion_motivo        = null,
           anulacion_por           = null,
           anulacion_pedida_en     = null,
           anulacion_estado_previo = null,
           anulacion_resuelta_por  = null,
           anulacion_resuelta_en   = null
     where id = p_item_id;
  end if;

  perform private.auditar(v_emp, 'item_anulacion_resuelta', jsonb_build_object(
    'item', p_item_id::text,
    'aprobada', coalesce(p_aprobar, false),
    'motivo', coalesce(nullif(trim(p_motivo), ''), v_it.anulacion_motivo)),
    'cuenta_item', v_it.nombre_snapshot);
  return true;
end $fn$;
revoke all on function public.resolver_anulacion(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.resolver_anulacion(uuid, boolean, text, uuid) to authenticated;

-- cola_de_area: la pantalla de cocina/barra. Un objeto por cuenta abierta con los
-- ítems vivos de ESA área (enviado/listo/anulacion), ordenados por enviada_en.
create or replace function public.cola_de_area(
  p_area       text default 'cocina',
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_out jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero','cocina','barra']::text[]);

  if coalesce(p_area, '') not in ('cocina','barra') then
    raise exception 'El área debe ser cocina o barra';
  end if;

  select coalesce(jsonb_agg(t.cuenta_json order by t.enviada_en nulls last, t.cuenta_id), '[]'::jsonb)
    into v_out
    from (
      select cu.id                                          as cuenta_id,
             min(i.enviado_en)                              as enviada_en,
             jsonb_build_object(
               'cuenta_id',  cu.id,
               'mesa',       coalesce((select string_agg(m.nombre, ', ' order by m.nombre)
                                        from public.cuenta_mesas cm
                                        join public.mesas m on m.id = cm.mesa_id
                                       where cm.cuenta_id = cu.id), 'Mostrador'),
               'canal',      case when exists (select 1 from public.cuenta_mesas cm
                                               where cm.cuenta_id = cu.id)
                                  then 'mesa' else 'mostrador' end,
               'comensales', cu.comensales,
               'abierta_en', cu.abierta_en,
               'enviada_en', min(i.enviado_en),
               'items', coalesce(jsonb_agg(jsonb_build_object(
                          'id',               i.id,
                          'nombre',           i.nombre_snapshot,
                          'qty',              i.qty,
                          'nota',             i.nota,
                          'estado',           i.estado,
                          'areas',            i.areas,
                          'enviada_en',       i.enviado_en,
                          'listo_en',         i.listo_en,
                          'anulacion_motivo', i.anulacion_motivo)
                        order by i.enviado_en), '[]'::jsonb)
             ) as cuenta_json
        from public.cuentas cu
        join public.cuenta_items i on i.cuenta_id = cu.id
       where cu.empresa_id = v_emp
         and cu.estado <> 'cerrada'
         and i.areas @> array[p_area]::text[]
         and i.estado in ('enviado','listo','anulacion')
       group by cu.id, cu.comensales, cu.abierta_en
    ) t;
  return v_out;
end $fn$;
revoke all on function public.cola_de_area(text, uuid) from public, anon, authenticated;
grant execute on function public.cola_de_area(text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- D) AUDITORÍA local: el admin de la empresa ya puede leer su auditoria desde la app
--    (antes solo el super con super_listar_auditoria).
-- ----------------------------------------------------------------------------
create or replace function public.auditoria_listar(
  p_dias       integer default 7,
  p_accion     text    default null,
  p_actor      uuid    default null,
  p_limite     integer default 300,
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp  uuid;
  v_dias integer;
  v_lim  integer;
  v_out  jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  v_dias := least(greatest(coalesce(p_dias, 7), 1), 90);
  v_lim  := least(greatest(coalesce(p_limite, 300), 1), 500);

  select coalesce(jsonb_agg(q.r order by (q.r->>'en') desc), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object('en', a.en, 'actor', a.actor,
                                'actor_nombre', coalesce(nullif(a.actor_nombre, ''), nullif(p.display_name, ''), '—'),
                                'actor_rol',    coalesce(nullif(a.actor_rol, ''), '—'),
                                'accion', a.accion, 'detalle', a.detalle,
                                'entity_type',  coalesce(nullif(a.entity_type, ''), '—'),
                                'entity_label', coalesce(nullif(a.entity_label, ''), '—')) as r
        from public.auditoria a
        left join public.perfiles p on p.user_id = a.actor
       where a.empresa_id = v_emp
         and a.en >= now() - make_interval(days => v_dias)
         and (p_accion is null or a.accion = p_accion)
         and (p_actor is null or a.actor = p_actor)
       order by a.en desc
       limit v_lim
    ) q;
  return v_out;
end $fn$;
revoke all on function public.auditoria_listar(integer, text, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.auditoria_listar(integer, text, uuid, integer, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- E) INVENTARIO · insumos → recetas de platos → movimientos.
--    cobro (cobrar_cuenta) ya descuenta por receta arriba. Acceso directo solo
--    SELECT para el admin (patrón de trabajos_impresion); lo demás pasa por RPCs
--    security definer con gate admin.
-- ----------------------------------------------------------------------------
create table if not exists public.insumos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  nombre         text not null,
  unidad         text not null default 'unidad',
  stock          numeric(12,3) not null default 0,
  stock_min      numeric(12,3) not null default 0,
  costo          numeric(12,2) not null default 0,
  activo         boolean not null default true,
  creada_en      timestamptz not null default now(),
  actualizado_en timestamptz
);
create index if not exists insumos_empresa_idx on public.insumos (empresa_id);
create unique index if not exists insumos_empresa_nombre_ux
  on public.insumos (empresa_id, lower(nombre));

create table if not exists public.recetas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  insumo_id   uuid not null references public.insumos(id) on delete cascade,
  cantidad    numeric(12,3) not null check (cantidad > 0),
  creada_en   timestamptz not null default now(),
  unique (producto_id, insumo_id)
);
create index if not exists recetas_empresa_idx on public.recetas (empresa_id);

create table if not exists public.insumos_movimientos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null,
  insumo_id      uuid not null references public.insumos(id) on delete cascade,
  tipo           text not null check (tipo in ('entrada','salida','venta','ajuste')),
  cantidad       numeric(12,3) not null,
  stock_after    numeric(12,3),
  nota           text,
  usuario        uuid default auth.uid(),
  usuario_nombre text,
  en             timestamptz not null default now()
);
create index if not exists insumos_movimientos_empresa_en_idx
  on public.insumos_movimientos (empresa_id, en desc);

-- RLS: mismo patrón que trabajos_impresion (el cliente solo lee por API; toda
-- escritura real la hacen las RPCs definer de abajo).
alter table public.insumos enable row level security;
alter table public.insumos force row level security;
drop policy if exists insumos_select on public.insumos;
create policy insumos_select on public.insumos for select to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
revoke all on public.insumos from public, anon;
revoke insert, update, delete, truncate on public.insumos from authenticated;
grant select on public.insumos to authenticated;

alter table public.recetas enable row level security;
alter table public.recetas force row level security;
drop policy if exists recetas_select on public.recetas;
create policy recetas_select on public.recetas for select to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
revoke all on public.recetas from public, anon;
revoke insert, update, delete, truncate on public.recetas from authenticated;
grant select on public.recetas to authenticated;

alter table public.insumos_movimientos enable row level security;
alter table public.insumos_movimientos force row level security;
drop policy if exists insumos_movimientos_select on public.insumos_movimientos;
create policy insumos_movimientos_select on public.insumos_movimientos for select to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
revoke all on public.insumos_movimientos from public, anon;
revoke insert, update, delete, truncate on public.insumos_movimientos from authenticated;
grant select on public.insumos_movimientos to authenticated;

-- inventario_listar: todo lo que necesita la pantalla de inventario de una sola vez.
create or replace function public.inventario_listar(p_empresa_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);
  return jsonb_build_object(
    'insumos', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', i.id, 'nombre', i.nombre, 'unidad', i.unidad,
                   'stock', i.stock, 'stock_min', i.stock_min,
                   'costo', i.costo, 'activo', i.activo)
                 order by lower(i.nombre))
                 from public.insumos i where i.empresa_id = v_emp), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', p.id, 'nombre', p.nombre,
                   'recetas', coalesce((select jsonb_agg(jsonb_build_object(
                                  'insumo_id', r.insumo_id, 'cantidad', r.cantidad)
                                order by r.creada_en)
                                from public.recetas r where r.producto_id = p.id), '[]'::jsonb))
                 order by lower(p.nombre))
                 from public.productos p
                where p.empresa_id = v_emp and p.activo), '[]'::jsonb)
  );
end $fn$;
revoke all on function public.inventario_listar(uuid) from public, anon, authenticated;
grant execute on function public.inventario_listar(uuid) to authenticated;

-- insumo_guardar: upsert. Con 'id' ⇒ actualiza ese insumo; sin 'id' ⇒ crea o
-- actualiza por nombre normalizado (índice único empresa + lower(nombre)).
create or replace function public.insumo_guardar(
  p_insumo     jsonb,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_id     uuid;
  v_out    uuid;
  v_nombre text;
  v_unidad text;
  v_stock  numeric;
  v_min    numeric;
  v_costo  numeric;
  v_activo boolean;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  if p_insumo is null or jsonb_typeof(p_insumo) <> 'object' then
    raise exception 'Los datos del insumo son inválidos';
  end if;
  v_id     := nullif(p_insumo->>'id', '')::uuid;
  v_nombre := trim(coalesce(p_insumo->>'nombre', ''));
  if v_nombre = '' then
    raise exception 'El nombre del insumo es obligatorio';
  end if;
  v_unidad := coalesce(nullif(trim(coalesce(p_insumo->>'unidad', '')), ''), 'unidad');
  v_stock  := coalesce((p_insumo->>'stock')::numeric, 0);
  v_min    := coalesce((p_insumo->>'stock_min')::numeric, 0);
  v_costo  := coalesce((p_insumo->>'costo')::numeric, 0);
  v_activo := coalesce((p_insumo->>'activo')::boolean, true);

  if v_id is not null then
    begin
      update public.insumos
         set nombre = v_nombre, unidad = v_unidad, stock = v_stock,
             stock_min = v_min, costo = v_costo, activo = v_activo,
             actualizado_en = now()
       where id = v_id and empresa_id = v_emp
      returning id into v_out;
    exception when unique_violation then
      raise exception 'Ya existe otro insumo con ese nombre en la empresa';
    end;
    if v_out is null then
      raise exception 'El insumo no existe en la empresa activa';
    end if;
  else
    insert into public.insumos (empresa_id, nombre, unidad, stock, stock_min, costo, activo)
    values (v_emp, v_nombre, v_unidad, v_stock, v_min, v_costo, v_activo)
    on conflict (empresa_id, lower(nombre)) do update
       set unidad = excluded.unidad,
           stock = excluded.stock,
           stock_min = excluded.stock_min,
           costo = excluded.costo,
           activo = excluded.activo,
           actualizado_en = now()
    returning id into v_out;
  end if;
  return v_out;
end $fn$;
revoke all on function public.insumo_guardar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.insumo_guardar(jsonb, uuid) to authenticated;

-- insumo_borrar: borrado real (las recetas caen en cascada; los movimientos también).
create or replace function public.insumo_borrar(
  p_insumo_id  uuid,
  p_empresa_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_nombre text;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  delete from public.insumos
   where id = p_insumo_id and empresa_id = v_emp
  returning nombre into v_nombre;
  if v_nombre is null then
    raise exception 'El insumo no existe en la empresa activa';
  end if;

  perform private.auditar(v_emp, 'insumo_borrar',
    jsonb_build_object('insumo', p_insumo_id::text, 'nombre', v_nombre),
    'insumo', v_nombre);
  return true;
end $fn$;
revoke all on function public.insumo_borrar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.insumo_borrar(uuid, uuid) to authenticated;

-- insumo_movimiento: entrada/salida/ajuste manual. Devuelve el stock nuevo.
create or replace function public.insumo_movimiento(
  p_insumo_id  uuid,
  p_tipo       text,
  p_cantidad   numeric,
  p_nota       text default null,
  p_empresa_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_nombre text;
  v_new    numeric;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  if coalesce(p_tipo, '') not in ('entrada','salida','ajuste') then
    raise exception 'El tipo de movimiento debe ser entrada, salida o ajuste';
  end if;
  if coalesce(p_cantidad, 0) <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  update public.insumos
     set stock = case p_tipo
                   when 'entrada' then stock + p_cantidad
                   when 'salida'  then stock - p_cantidad
                   else p_cantidad   -- ajuste: el valor pasa a ser el stock
                 end,
         actualizado_en = now()
   where id = p_insumo_id and empresa_id = v_emp
  returning nombre, stock into v_nombre, v_new;
  if v_nombre is null then
    raise exception 'El insumo no existe en la empresa activa';
  end if;

  insert into public.insumos_movimientos
    (empresa_id, insumo_id, tipo, cantidad, stock_after, nota, usuario, usuario_nombre)
  values (v_emp, p_insumo_id, p_tipo, p_cantidad, v_new, nullif(trim(coalesce(p_nota, '')), ''),
          auth.uid(),
          coalesce((select p.display_name from public.perfiles p where p.user_id = auth.uid()), ''));

  perform private.auditar(v_emp, 'insumo_movimiento', jsonb_build_object(
    'insumo', p_insumo_id::text, 'nombre', v_nombre, 'tipo', p_tipo,
    'cantidad', p_cantidad, 'stock_after', v_new),
    'insumo', v_nombre);
  return v_new;
end $fn$;
revoke all on function public.insumo_movimiento(uuid, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.insumo_movimiento(uuid, text, numeric, text, uuid) to authenticated;

-- receta_reemplazar: guarda la receta completa de un plato (borra y reinserta).
-- p_lineas = [{insumo_id, cantidad}]. Devuelve cuántas líneas quedaron.
create or replace function public.receta_reemplazar(
  p_producto_id uuid,
  p_lineas      jsonb,
  p_empresa_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp  uuid;
  v_line jsonb;
  v_ins  uuid;
  v_cant numeric;
  v_n    integer := 0;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  if not exists (select 1 from public.productos p
                  where p.id = p_producto_id and p.empresa_id = v_emp) then
    raise exception 'El producto no existe en la empresa activa';
  end if;
  if p_lineas is null then
    p_lineas := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas de la receta deben ser una lista';
  end if;

  delete from public.recetas where producto_id = p_producto_id and empresa_id = v_emp;

  for v_line in select * from jsonb_array_elements(p_lineas) loop
    v_ins  := nullif(v_line->>'insumo_id', '')::uuid;
    v_cant := coalesce((v_line->>'cantidad')::numeric, 0);
    if v_ins is null or v_cant <= 0 then
      raise exception 'Cada línea de receta necesita un insumo y una cantidad mayor que cero';
    end if;
    if not exists (select 1 from public.insumos i
                    where i.id = v_ins and i.empresa_id = v_emp) then
      raise exception 'El insumo de la receta no pertenece a la empresa activa';
    end if;
    insert into public.recetas (empresa_id, producto_id, insumo_id, cantidad)
    values (v_emp, p_producto_id, v_ins, v_cant)
    on conflict (producto_id, insumo_id) do update
       set cantidad = excluded.cantidad;
    v_n := v_n + 1;
  end loop;

  perform private.auditar(v_emp, 'receta_guardar', jsonb_build_object(
    'producto', p_producto_id::text, 'lineas', v_n),
    'producto', (select pr.nombre from public.productos pr where pr.id = p_producto_id));
  return v_n;
end $fn$;
revoke all on function public.receta_reemplazar(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.receta_reemplazar(uuid, jsonb, uuid) to authenticated;

-- movimientos_listar: historial de entradas/salidas/ventas/ajustes de la empresa.
create or replace function public.movimientos_listar(
  p_dias       integer default 7,
  p_limite     integer default 200,
  p_empresa_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp  uuid;
  v_dias integer;
  v_lim  integer;
  v_out  jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  v_dias := least(greatest(coalesce(p_dias, 7), 1), 90);
  v_lim  := least(greatest(coalesce(p_limite, 200), 1), 500);

  select coalesce(jsonb_agg(q.r order by (q.r->>'en') desc), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object('en', m.en,
                                'insumo_nombre', coalesce(i.nombre, '(insumo eliminado)'),
                                'tipo', m.tipo, 'cantidad', m.cantidad,
                                'stock_after', m.stock_after, 'nota', m.nota,
                                'usuario_nombre', coalesce(nullif(m.usuario_nombre, ''), '—')) as r
        from public.insumos_movimientos m
        left join public.insumos i on i.id = m.insumo_id
       where m.empresa_id = v_emp
         and m.en >= now() - make_interval(days => v_dias)
       order by m.en desc
       limit v_lim
    ) q;
  return v_out;
end $fn$;
revoke all on function public.movimientos_listar(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.movimientos_listar(integer, integer, uuid) to authenticated;

-- ============================================================================
-- G) AUDITORÍA LEGIBLE (modelo "Catering Control"): cada fila guarda quién,
--    con qué rol y sobre qué entidad actuó, no solo un jsonb suelto.
--    Columnas nuevas (actor_nombre, actor_rol, entity_type, entity_label) son
--    nullables ⇒ no rompen nada. private.auditar se reemplaza con 2 parámetros
--    OPCIONALES al final ⇒ las ~40 llamadas de 3 argumentos siguen válidas
--    (Postgres resuelve la de 5 usando los defaults).
--    OJO: create or replace con 5 args crea una función DISTINTA de la de 3,
--    así que se hace DROP de la de 3 antes de crear la de 5.
-- ============================================================================

-- 1) Columnas nuevas (idempotente)
alter table public.auditoria add column if not exists actor_nombre text;
alter table public.auditoria add column if not exists actor_rol    text;
alter table public.auditoria add column if not exists entity_type  text;
alter table public.auditoria add column if not exists entity_label text;

-- 3) Backfill idempotente de las filas ya existentes (una sola vez por fila).
--    actor_nombre: desde perfiles (se ignora el display_name vacío).
update public.auditoria a
   set actor_nombre = nullif((select pf.display_name from public.perfiles pf
                              where pf.user_id = a.actor), '')
 where a.actor_nombre is null
   and a.actor is not null
   and exists (select 1 from public.perfiles pf where pf.user_id = a.actor);

--    actor_rol: desde membresias (join directo empresa_id + user_id ⇒ columna rol).
update public.auditoria a
   set actor_rol = (select m.rol from public.membresias m
                    where m.empresa_id = a.empresa_id and m.user_id = a.actor
                    limit 1)
 where a.actor_rol is null
   and a.actor is not null
   and a.empresa_id is not null
   and exists (select 1 from public.membresias m
               where m.empresa_id = a.empresa_id and m.user_id = a.actor);

-- ----------------------------------------------------------------------------
-- F) SUPER ADMIN FUSIONADO (antes vivía en un archivo aparte que ya no existe;
--    todo el backend es este setup.sql). crear_super / quitar_super siguen
--    REVOCADAS para anon y authenticated: solo se usan desde el SQL Editor o con la
--    service key. Nadie con cuenta de negocio puede mintear supers.
--    Ojo con la clave: queda escrita en el historial del SQL Editor.
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
    -- la cuenta está pendiente de confirmación. Igual que equipo_invitar.
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

    -- handle_new_user ya creó public.perfiles con el display_name.
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

-- quitar_super: deja de ser super pero conserva su cuenta y sus empresas
-- (borra la fila de public.supers, no al usuario).
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

-- SUPER SEMILLA · el uuid heredado que traía la siembra antigua. Se deja comentado:
-- si public.supers ya tiene filas no hay que crear nada, y si está vacía lo suyo
-- es promocionarse abajo con crear_super (nunca un uuid heredado de otro proyecto).
-- insert into public.supers (user_id)
-- values ('85201957-cdfb-4235-acfe-dd1a54e348d0')
-- on conflict (user_id) do nothing;

-- Verificación (en el SQL Editor auth.uid() es NULL ⇒ solo contados/.existencias).
select 'funcion' as objeto, p.proname as nombre
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('crear_super', 'quitar_super')
 order by p.proname;

select (select count(*)::int from public.supers)                                        as supers,
       (select count(*)::int from information_schema.routine_privileges rp
         where rp.routine_name in ('crear_super','quitar_super')
           and rp.grantee in ('anon','authenticated'))                                  as permisos_publicos;

-- ============================================================================
-- ★ PASO OPCIONAL · HACERME SUPER ADMIN DESDE AQUÍ ★
-- Si tu correo YA existe (es admin de una empresa, p.ej. el de "fuego"), esta
-- línea lo promociona a super y le fija la clave: con ese correo y clave podrá
-- entrar a TODAS las empresas desde la app.
-- Cambia las 3 comillas y pega el archivo completo en el SQL Editor.
-- Si no quieres hacerlo ahora, deja el select comentado: el resto del archivo
-- funciona igual.
-- ============================================================================
select public.crear_super('tu@correo.com', 'ClaveMin8Caracteres', 'Tu nombre', true)
where false;   -- ← quita esta línea (where false) para que se ejecute

-- Limpieza de una versión anterior: esta función ya no existe (se usa public.es_super()).
drop function if exists private.es_super_compat();

commit;

