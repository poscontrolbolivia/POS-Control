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
