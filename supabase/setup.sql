-- ============================================================================
-- POS Control · setup.sql  —  ARCHIVO ÚNICO de base de datos (pegar COMPLETO)
-- Supabase → SQL Editor → pegar todo → Run. Idempotente: se puede volver a pegar
-- completo cada vez que haya una versión nueva, sin perder datos.
-- Para nombrar a un super admin: usar supabase/super-admin.sql (aparte).
-- Orden interno: schema → super → seguridad → comensales → altas → login.
-- ============================================================================

-- ############################################################################
-- PARTE 1/6 · schema (tablas, RLS, RPC del POS)
-- ############################################################################
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
--                                    (admin | cajero | mesero) + pin_descuento_hash.
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

-- búsqueda pre-login: solo datos públicos de la empresa por código
create or replace function public.empresa_por_codigo(p_codigo text)
returns table (id uuid, nombre text, moneda text)
language sql stable security definer
set search_path = ''
as $$
  select e.id, e.nombre, e.moneda
  from public.empresas e
  where e.codigo is not null and lower(e.codigo) = lower(trim(p_codigo));
$$;
revoke all on function public.empresa_por_codigo(text) from anon, authenticated;
grant execute on function public.empresa_por_codigo(text) to anon, authenticated;

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
  rol               text not null check (rol in ('admin','cajero','mesero')),
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
  estado           text not null default 'pendiente' check (estado in ('pendiente','enviado','anulado')),
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

-- es_super_compat(): true si la migración 001_super.sql está aplicada y el
--   usuario es super. Se consulta pg_class primero porque la tabla `supers` NO
--   existe en una instalación sin esa migración (y una excepción dentro de
--   empresa_activa() abortaría toda la política RLS).
create or replace function private.es_super_compat()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not exists (select 1 from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'supers') then
    return false;
  end if;
  return public.es_super();
end $fn$;

-- ★ empresa_activa(): fuente de verdad de la "empresa actual" para RLS.
--   Lee current_setting('app.empresa_id', true) (seteado por fijar_empresa(),
--   transacción-local) y verifica que auth.uid() tiene membresía ahí.
--   Fallback: sin setting y con EXACTAMENTE una membresía → esa empresa.
--   SECURITY DEFINER para leer membresias sin recursión de RLS.
--   Un SUPER (migración 001_super) puede fijar cualquier empresa.
create or replace function private.empresa_activa()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_setting uuid;
  v_unica   uuid;
  v_uid     uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return null;                      -- sin sesión ⇒ nada visible
  end if;

  -- El GUC puede venir ausente ('' / NULL) o basura no-uuid: nullif + bloque
  -- de excepción lo reducen a NULL sin abortar la transacción.
  begin
    v_setting := nullif(current_setting('app.empresa_id', true), '')::uuid;
  exception when others then
    v_setting := null;
  end;

  if v_setting is not null then
    if exists (select 1 from public.membresias m
               where m.empresa_id = v_setting and m.user_id = v_uid)
       or private.es_super_compat() then
      return v_setting;               -- setting válido + membresía real (o super)
    end if;
    return null;                      -- setting espurio ⇒ denial
  end if;

  -- Fallback 1-empresa (SELECTs directos / realtime sobre vistas):
  -- OJO: min(uuid) no existe como agregado en PostgreSQL < 17; se agregava a
  -- text y se vuelve a castear (fix 2026-10-16: sin esto, TODO SELECT RLS con
  -- GUC sin fijar fallaba con «function min(uuid) does not exist»).
  select min(m.empresa_id::text)::uuid into v_unica
    from public.membresias m
   where m.user_id = v_uid
   having count(*) = 1;               -- si tiene 2+ membresías ⇒ NULL (0 filas)
  return v_unica;
end $fn$;

-- fijar_empresa(): cabecera del flujo "RPC → GUC transaccional → RLS".
-- Valida membresía y fija app.empresa_id LOCAL a la transacción (true).
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
  if not exists (select 1 from public.membresias m
                 where m.empresa_id = v and m.user_id = auth.uid()) then
    raise exception 'el usuario actual no tiene membresía en la empresa %', v;
  end if;
  perform set_config('app.empresa_id', v::text, true);
  return v;
end $fn$;

-- mi_rol(): rol del usuario en la empresa activa (NULL si no es miembro).
create or replace function private.mi_rol()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.rol
    from public.membresias m
   where m.empresa_id = private.empresa_activa()
     and m.user_id = auth.uid()
   limit 1;
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

-- es_admin(): usado en políticas RLS de escritura de tablas de catálogo.
-- SECURITY DEFINER + envolvente (select ...) para evitar recursión en RLS.
create or replace function private.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.membresias m
     where m.empresa_id = private.empresa_activa()
       and m.user_id = auth.uid()
       and m.rol = 'admin'
  );
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

-- es_miembro_de(): usado en la política SELECT de empresas (login: "veo las
-- empresas a las que pertenezco" ANTES de fijar empresa activa).
create or replace function private.es_miembro_de(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.membresias m
     where m.empresa_id = p_empresa_id
       and m.user_id = auth.uid()
  ) or private.es_super_compat();
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
        (empresa_id, cuenta_id, producto_id, nombre_snapshot, precio_snapshot, qty, estado, nota)
      values
        (v_emp, v_cuenta.id, v_prod.id, v_prod.nombre, v_prod.precio, v_qty, 'pendiente',
         coalesce(v_it->>'nota', ''))
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
  if v_it.estado = 'enviado' then
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
  if v_it.estado = 'enviado' then
    if v_rol <> 'admin' then
      raise exception 'anular un ítem enviado requiere rol admin';
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
-- -- Para dar de alta cajeros/meseros: crear sus cuentas en Auth y repetir
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

-- ############################################################################
-- PARTE 2/6 · super admin (tabla supers, exportar/importar)
-- ############################################################################
-- ============================================================================
-- migraciones/001_super.sql · Super admin multiempresa + exportar/importar
-- Idempotente. Ejecutar como postgres en el SQL Editor (después de schema.sql).
-- ============================================================================

-- 1) tabla de super administradores (dueño de la plataforma)
create table if not exists public.supers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  creado_en  timestamptz not null default now()
);
alter table public.supers enable row level security;
drop policy if exists supers_propio on public.supers;
create policy supers_propio on public.supers for select using (user_id = auth.uid());


-- 2) helper es_super()
create or replace function public.es_super()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.supers s where s.user_id = auth.uid()); $$;
grant execute on function public.es_super() to authenticated;

-- 3) empresa_activa() ahora también deja "entrar" a un super a cualquier empresa
--    (el GUC app.empresa_id sigue siendo el único canal; un super puede fijarlo
--     a una empresa aunque no tenga membresía).
create or replace function private.empresa_activa()
returns uuid language plpgsql stable security definer set search_path = ''
as $fn$
declare
  v_setting uuid;
  v_unica   uuid;
  v_uid     uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return null; end if;
  begin
    v_setting := nullif(current_setting('app.empresa_id', true), '')::uuid;
  exception when others then
    v_setting := null;
  end;
  if v_setting is not null then
    if exists (select 1 from public.membresias m
               where m.empresa_id = v_setting and m.user_id = v_uid)
       or public.es_super() then
      return v_setting;
    end if;
    return null;
  end if;
  if public.es_super() then
    return null;  -- el super debe fijar empresa explícitamente
  end if;
  -- min(uuid) no es agregado en PostgreSQL < 17: se agrega como text y se
  -- vuelve a castea (mismo fix que schema.sql).
  select min(m.empresa_id::text)::uuid into v_unica
    from public.membresias m where m.user_id = v_uid having count(*) = 1;
  return v_unica;
end $fn$;

-- 4) fijar empresa activa (la app la llama tras login / cambio de empresa)
create or replace function public.fijar_empresa(p_empresa uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'sin sesion'; end if;
  if not (exists (select 1 from public.membresias m
                  where m.empresa_id = p_empresa and m.user_id = auth.uid())
          or public.es_super()) then
    raise exception 'no pertenece a esa empresa';
  end if;
  perform set_config('app.empresa_id', p_empresa::text, false);  -- sesión actual
end $$;
grant execute on function public.fijar_empresa(uuid) to authenticated;

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

-- 6) EXPORTAR empresa completa a un jsonb (respaldo / migración a plan de pago)
create or replace function public.super_exportar_empresa(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  select jsonb_build_object(
    'version', 1,
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
    'equipo',      coalesce((select jsonb_agg(jsonb_build_object('correo', u.email, 'rol', m.rol, 'nombre', coalesce(p.display_name,'')))
                             from public.membresias m
                             join auth.users u on u.id = m.user_id
                             left join public.perfiles p on p.user_id = m.user_id
                             where m.empresa_id = p_empresa), '[]')
  ) into v;
  if v->'empresa' is null then
    raise exception 'empresa inexistente';
  end if;
  return v;
end $$;
grant execute on function public.super_exportar_empresa(uuid) to authenticated;

-- 7) IMPORTAR snapshot en ESTE proyecto (crea empresa nueva con código nuevo)
--    clave_inicial: contraseña temporal para recrear usuarios que no existan.
create or replace function public.super_importar_empresa(p_datos jsonb, p_codigo text, p_clave_inicial text default 'pos12345')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_emp   uuid;
  v_old   uuid := (p_datos->'empresa'->>'id')::uuid;
  r       jsonb;
  v_map   jsonb := '{}'::jsonb;   -- producto viejo -> nuevo (para items no hace falta: snapshot)
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_datos is null or (p_datos->'empresa'->>'nombre') is null then raise exception 'snapshot invalido'; end if;
  if exists (select 1 from public.empresas where lower(codigo) = lower(p_codigo)) then
    raise exception 'el codigo % ya existe', p_codigo;
  end if;

  insert into public.empresas (nombre, codigo, moneda, iva_pct, propina_pct, config)
  values (p_datos->'empresa'->>'nombre', lower(p_codigo),
          coalesce(p_datos->'empresa'->>'moneda','Bs'),
          coalesce((p_datos->'empresa'->>'iva_pct')::numeric,0),
          coalesce((p_datos->'empresa'->>'propina_pct')::numeric,10),
          coalesce((p_datos->'empresa'->'config'), '{}'::jsonb))
  returning id into v_emp;

  for r in select * from jsonb_array_elements(p_datos->'zonas') loop
    insert into public.zonas (id, empresa_id, nombre, orden)
    values (gen_random_uuid(), v_emp, r->>'nombre', coalesce((r->>'orden')::int,0));
  end loop;

  for r in select * from jsonb_array_elements(p_datos->'secciones') loop
    insert into public.secciones_menu (id, empresa_id, nombre, orden)
    values (gen_random_uuid(), v_emp, r->>'nombre', coalesce((r->>'orden')::int,0));
  end loop;

  for r in select * from jsonb_array_elements(p_datos->'productos') loop
    insert into public.productos (empresa_id, seccion_id, nombre, precio, activo)
    select v_emp, s.id, r->>'nombre', coalesce((r->>'precio')::numeric,0), coalesce((r->>'activo')::boolean,true)
    from public.secciones_menu s
    where s.empresa_id = v_emp and s.nombre = r->>'seccion_nombre'
    limit 1;
  end loop;

  for r in select * from jsonb_array_elements(p_datos->'mesas') loop
    insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad, activa)
    select v_emp, z.id, r->>'nombre', coalesce((r->>'x')::numeric,0), coalesce((r->>'y')::numeric,0),
           coalesce((r->>'w')::numeric,100), coalesce((r->>'h')::numeric,100),
           coalesce(r->>'forma','cuadrada'), coalesce((r->>'capacidad')::int,4), coalesce((r->>'activa')::boolean,true)
    from public.zonas z
    where z.empresa_id = v_emp and z.nombre = r->>'zona_nombre'
    limit 1;
  end loop;

  -- equipo: recrear usuarios por correo si no existen (confirmados, clave temporal)
  for r in select * from jsonb_array_elements(p_datos->'equipo') loop
    if not exists (select 1 from auth.users u where u.email = r->>'correo') then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at,
                              raw_app_meta_data, raw_user_meta_data)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
              r->>'correo', extensions.crypt(p_clave_inicial, extensions.gen_salt('bf')),
              now(), now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', r->>'nombre'));
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), au.id, au.id::text, 'email', jsonb_build_object('sub', au.id::text, 'email', au.email, 'email_verified', true),
             now(), now(), now()
      from auth.users au where au.email = r->>'correo';
    end if;
    insert into public.membresias (empresa_id, user_id, rol)
    select v_emp, u.id, r->>'rol' from auth.users u where u.email = r->>'correo'
    on conflict (empresa_id, user_id) do nothing;
  end loop;

  return v_emp;
end $$;
grant execute on function public.super_importar_empresa(jsonb, text, text) to authenticated;

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

-- 9) verificación (contados directos: auth.uid() es null en el SQL Editor)
select (select count(*) from public.supers) as supers_semilla,
       (select count(*) from public.empresas) as empresas;

-- ############################################################################
-- PARTE 3/6 · seguridad (cuotas, auditoría, throttle)
-- ############################################################################
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

-- ############################################################################
-- PARTE 4/6 · comensales
-- ############################################################################
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

-- ############################################################################
-- PARTE 5/6 · altas self-service y equipo
-- ############################################################################
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

-- ############################################################################
-- PARTE 6/6 · lista de empresas para el login
-- ############################################################################
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

-- ############################################################################
-- VERIFICACIÓN (resultado final en una fila)
-- ############################################################################
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name in
    ('empresas','perfiles','membresias','zonas','mesas','secciones_menu','productos','cuentas','cuenta_mesas','cuenta_items','pagos','turnos_caja')) as tablas_ok,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity) as tablas_con_rls,
  (select count(*) from pg_policies where schemaname='public') as politicas,
  (select count(*) from information_schema.routines where routine_schema='public') as funciones,
  (select count(distinct routine_name) from information_schema.routines where routine_schema='public' and routine_name in
    ('abrir_cuenta','abrir_venta_directa','agregar_items','cambiar_qty_item','poner_nota','enviar_items','anular_item','unir_mesas','separar_mesa','mover_items','aplicar_extras','cobrar_cuenta','abrir_turno','registrar_movimiento_caja','cerrar_turno')) as rpcs_ok,
  (select count(*) from information_schema.views where table_schema='public' and table_name='v_estado_mesas') as vista_ok;
