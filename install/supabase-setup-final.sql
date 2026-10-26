begin;

-- ## 0) Extensiones y schemas

create schema if not exists private;

create extension if not exists pgcrypto with schema extensions;

-- ## 1) TABLAS

create table if not exists public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 1 and 120),
  codigo      text,
  moneda      text not null default 'Bs',
  iva_pct     numeric(5,2) not null default 0,
  propina_pct numeric(5,2) not null default 10,
  config      jsonb not null default '{}'::jsonb,
  creada_en   timestamptz not null default now()
);
create unique index if not exists empresas_codigo_uniq on public.empresas (lower(codigo)) where codigo is not null;

create table if not exists public.perfiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  telefono     text,
  creado_en    timestamptz not null default now()
);

create table if not exists public.membresias (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  rol               text not null check (rol in ('admin','cajero','mesero','cocina','barra')),
  pin_descuento_hash text,
  creada_en         timestamptz not null default now(),
  unique (empresa_id, user_id)
);

create table if not exists public.zonas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  orden      integer not null default 0,
  creada_en  timestamptz not null default now()
);

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

create table if not exists public.secciones_menu (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  orden      integer not null default 0,
  creada_en  timestamptz not null default now()
);

create table if not exists public.productos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  seccion_id uuid references public.secciones_menu(id) on delete set null,
  nombre     text not null check (length(trim(nombre)) between 1 and 120),
  precio     numeric(10,2) not null check (precio >= 0),
  activo     boolean not null default true,
  creada_en  timestamptz not null default now()
);

create table if not exists public.cuentas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  tipo         text not null check (tipo in ('mesa','directa')),
  numero       integer,
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

create table if not exists public.cuenta_mesas (
  cuenta_id  uuid not null references public.cuentas(id) on delete cascade,
  mesa_id    uuid not null references public.mesas(id)   on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (cuenta_id, mesa_id)
);

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
-- Parte de «nota» que son INDICACIONES elegidas en la comanda (término, salsas…): el resto de «nota» es el comentario libre.
-- Las indicaciones no se editan después; solo el comentario.
alter table public.cuenta_items add column if not exists indicaciones text not null default '';

create table if not exists public.pagos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cuenta_id  uuid not null references public.cuentas(id) on delete cascade,
  metodo     text not null check (metodo in ('efectivo','qr','tarjeta','mixed','cheque','vale','cxc','otro')),
  monto      numeric(10,2) not null check (monto >= 0),
  detalle    jsonb not null default '{}'::jsonb,
  creada_por uuid references auth.users(id),
  creada_en  timestamptz not null default now()
);

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

-- ## 1b) ÍNDICES: empresa_id en TODAS las tablas de negocio + índices de acceso

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

-- ## 2) FUNCIONES AUXILIARES

-- ## 2) NÚCLEO DE ACCESO

-- ## 1) tabla de super administradores
create table if not exists public.supers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  creado_en  timestamptz not null default now()
);
alter table public.supers enable row level security;
drop policy if exists supers_propio on public.supers;
create policy supers_propio on public.supers for select using (user_id = (select auth.uid()));

-- ## 0) AUDITORÍA

create table if not exists public.auditoria (
  id         bigint generated always as identity primary key,
  empresa_id uuid,
  actor      uuid,
  accion     text not null,
  detalle    jsonb not null default '{}'::jsonb,
  en         timestamptz not null default now(),
  actor_nombre text,
  actor_rol    text,
  entity_type  text,
  entity_label text
);
alter table public.auditoria enable row level security;
alter table public.auditoria force row level security;

revoke all on table public.auditoria from public, anon, authenticated;
create index if not exists idx_auditoria_empresa_en on public.auditoria (empresa_id, en desc);

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
  using (user_id = (select auth.uid()));
drop policy if exists eau_write on public.empresa_activa_usuario;
create policy eau_write on public.empresa_activa_usuario for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.empresa_activa_usuario to authenticated;

-- ## 2) helper es_super()
create or replace function public.es_super()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.supers s where s.user_id = auth.uid()); $$;

grant execute on function public.es_super() to authenticated;

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
  if v_uid is null then return null; end if;

  -- ## 1) GUC transaccional: lo pone private.fijar_empresa(p_empresa_id) dentro

  begin
    v_guc := nullif(current_setting('app.empresa_id', true), '')::uuid;
  exception when others then
    v_guc := null;
  end;
  if v_guc is not null then
    if exists (select 1 from public.membresias m
               where m.empresa_id = v_guc and m.user_id = v_uid)
       or public.es_super() then
      return v_guc;
    end if;
    return null;
  end if;

  -- ## 2) Fila del usuario: los SELECT/INSERT directos de PostgREST llegan sin G

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

  -- ## 3) Miembro de una sola empresa: no hay nada que elegir.

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

create or replace function private.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select private.mi_rol() = 'admin';
$fn$;

create or replace function private.empresa_ok(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_id = private.empresa_activa();
$fn$;

-- ## 8) un super ve TODAS las empresas en el listado de acceso

create or replace function private.es_miembro_de(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.membresias m
     where m.empresa_id = p_empresa_id
       and m.user_id = auth.uid()
  ) or public.es_super();
$fn$;

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
        'indicaciones',   i.indicaciones,
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

-- ## 3) RPCs DE NEGOCIO

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

  begin
    perform private.auditar(v_emp, 'cuenta_abierta', jsonb_build_object(
      'cuenta', v_id::text, 'mesa', p_mesa_id::text,
      'comensales', greatest(coalesce(p_comensales, 1), 1)),
      'cuenta', (select m.nombre from public.mesas m where m.id = p_mesa_id));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_id;
end $fn$;

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

  perform pg_advisory_xact_lock(
    hashtextextended('directa:' || v_emp::text || ':' || to_char(now(), 'YYYY-MM-DD'), 0)
  );

  select coalesce(max(c.numero), 0) + 1 into v_num
    from public.cuentas c
   where c.empresa_id = v_emp
     and c.tipo = 'directa'
     and c.canal is null
     and c.abierta_en::date = current_date;

  insert into public.cuentas (empresa_id, tipo, numero, estado, abierta_por)
  values (v_emp, 'directa', v_num, 'abierta', auth.uid())
  returning id into v_id;

  begin
    perform private.auditar(v_emp, 'cuenta_venta_directa', jsonb_build_object(
      'cuenta', v_id::text, 'numero', v_num),
      'cuenta', 'Venta directa ' || v_num);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_id;
end $fn$;

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
  v_cfg    jsonb;
  v_sel    jsonb;
  v_lista  jsonb;
  v_det    jsonb;
  v_extras jsonb;
  v_extra  numeric;
  v_ind    text;
  v_nuegas integer := 0;
  v_nombres text := '';
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta']::text[]);
  select coalesce(e.config->'indicaciones', '[]'::jsonb) into v_cfg
    from public.empresas e where e.id = v_emp;
  if jsonb_typeof(v_cfg) <> 'array' then v_cfg := '[]'::jsonb; end if;

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

    -- Las indicaciones deben ser el comienzo de la nota; si no lo son, se tratan como comentario libre.
    v_ind := left(btrim(coalesce(v_it->>'indicaciones','')), 120);
    if v_ind <> '' and left(coalesce(v_it->>'nota',''), length(v_ind)) <> v_ind then v_ind := ''; end if;

    -- Precio extra y productos de inventario de las opciones elegidas: se leen SIEMPRE de la configuración
    -- del negocio (el cliente solo manda qué lista y qué opción; nunca el precio).
    v_extras := '[]'::jsonb;
    v_extra  := 0;
    if jsonb_typeof(v_it->'sel') = 'array' then
      for v_sel in select * from jsonb_array_elements(v_it->'sel') loop
        select e.value into v_lista from jsonb_array_elements(v_cfg) e
         where e.value->>'id' = v_sel->>'l' limit 1;
        continue when v_lista is null;
        v_det := v_lista->'detalle'->(v_sel->>'o');
        continue when v_det is null or jsonb_typeof(v_det) <> 'object';
        v_extra := v_extra + greatest(coalesce(nullif(v_det->>'extra','')::numeric, 0), 0);
        v_extras := v_extras || jsonb_build_array(jsonb_build_object(
          'nombre', v_sel->>'o',
          'extra', greatest(coalesce(nullif(v_det->>'extra','')::numeric, 0), 0),
          'producto_id', nullif(v_det->>'producto_id', '')));
      end loop;
    end if;

    select i.id into v_item
      from public.cuenta_items i
     where i.cuenta_id = v_cuenta.id
       and i.producto_id = v_prod.id
       and i.estado = 'pendiente'
       and coalesce(i.nota, '') = coalesce(v_it->>'nota', '')
       and coalesce(i.indicaciones, '') = v_ind
       and i.extras = v_extras
     limit 1;

    if found then
      update public.cuenta_items
         set qty = qty + v_qty
       where id = v_item;
    else
      insert into public.cuenta_items
        (empresa_id, cuenta_id, producto_id, nombre_snapshot, precio_snapshot, qty, estado, nota, indicaciones, areas, extras)
      values
        (v_emp, v_cuenta.id, v_prod.id, v_prod.nombre, v_prod.precio + v_extra, v_qty, 'pendiente',
         coalesce(v_it->>'nota', ''), v_ind,
         coalesce(v_prod.areas, array['cocina']::text[]), v_extras)
      returning id into v_item;
    end if;

    v_nuegas := v_nuegas + 1;
    v_nombres := left(v_nombres || case when v_nombres = '' then '' else ', ' end || v_prod.nombre, 160);
  end loop;

  begin
    perform private.auditar(v_emp, 'item_agregado', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'items', v_nuegas,
      'dueno', (select pf.display_name from public.perfiles pf where pf.user_id = v_cuenta.abierta_por),
      'ayuda', (v_cuenta.abierta_por is not null and v_cuenta.abierta_por is distinct from auth.uid())),
      'cuenta_item', nullif(v_nombres, ''));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return private.jsonb_items(v_cuenta.id);
end $fn$;

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
    begin
      perform private.auditar(v_emp, 'item_cantidad', jsonb_build_object(
        'item', p_item_id::text, 'cuenta', v_it.cuenta_id::text,
        'de', v_it.qty, 'eliminado', true),
        'cuenta_item', v_it.nombre_snapshot);
    exception when others then
      null; -- una falla de la bitácora nunca revierte la operación
    end;
    return jsonb_build_object('id', p_item_id, 'eliminado', true);
  end if;

  update public.cuenta_items set qty = v_nue where id = p_item_id;
  begin
    perform private.auditar(v_emp, 'item_cantidad', jsonb_build_object(
      'item', p_item_id::text, 'cuenta', v_it.cuenta_id::text,
      'de', v_it.qty, 'a', v_nue),
      'cuenta_item', v_it.nombre_snapshot);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
  return jsonb_build_object(
    'id', p_item_id, 'eliminado', false,
    'item', (select jsonb_build_object('id', i.id, 'nombre', i.nombre_snapshot,
                                       'precio', i.precio_snapshot, 'qty', i.qty,
                                       'estado', i.estado, 'nota', i.nota, 'indicaciones', i.indicaciones)
             from public.cuenta_items i where i.id = p_item_id));
end $fn$;

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
  v_com text;
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

  -- Las INDICACIONES del producto no se borran ni se editan: solo cambia el comentario.
  -- El cliente puede mandar el texto completo (indicaciones + comentario) o solo el comentario.
  if coalesce(v_it.indicaciones, '') <> '' then
    v_com := btrim(coalesce(p_nota, ''));
    if left(v_com, length(v_it.indicaciones)) = v_it.indicaciones then
      v_com := btrim(substr(v_com, length(v_it.indicaciones) + 1), ' ,');
    end if;
    update public.cuenta_items
       set nota = left(case when v_com = '' then v_it.indicaciones else v_it.indicaciones || ', ' || v_com end, 120)
     where id = p_item_id;
  else
    update public.cuenta_items set nota = coalesce(p_nota, '') where id = p_item_id;
  end if;

  begin
    perform private.auditar(v_emp, 'item_nota', jsonb_build_object(
      'item', p_item_id::text, 'cuenta', v_it.cuenta_id::text,
      'nota', left(coalesce(p_nota, ''), 120)),
      'cuenta_item', v_it.nombre_snapshot);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;

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

  if v_n > 0 then
    begin
      perform private.auditar(v_emp, 'comanda_enviada', jsonb_build_object(
        'cuenta', v_cuenta.id::text, 'numero', v_cuenta.numero, 'items', v_n,
        'parcial', p_item_ids is not null,
        'dueno', (select pf.display_name from public.perfiles pf where pf.user_id = v_cuenta.abierta_por),
        'ayuda', (v_cuenta.abierta_por is not null and v_cuenta.abierta_por is distinct from auth.uid())),
        'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
    exception when others then
      null; -- una falla de la bitácora nunca revierte la comanda
    end;
  end if;

  return v_n;
end $fn$;

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

  if v_it.estado = 'listo' or coalesce(array_length(v_it.areas_listas, 1), 0) > 0 then
    perform private.crear_devoluciones(v_emp, v_it, coalesce(nullif(trim(p_motivo), ''), 'sin motivo'));
  end if;

  begin
    perform private.auditar(v_emp, 'item_anulado', jsonb_build_object(
      'item', p_item_id::text, 'cuenta', v_it.cuenta_id::text, 'qty', v_it.qty,
      'estado_previo', v_it.estado,
      'motivo', coalesce(nullif(trim(p_motivo), ''), 'sin motivo')),
      'cuenta_item', v_it.nombre_snapshot);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;

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
  v_com       integer;
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
      continue;
    end if;

    for v_absorbida in
      select c.id
        from public.cuentas c
        join public.cuenta_mesas cm on cm.cuenta_id = c.id
       where cm.mesa_id = v_mesa
         and c.empresa_id = v_emp
         and c.estado <> 'cerrada'
         and c.id <> v_cuenta.id
    loop
      update public.cuenta_items
         set cuenta_id = v_cuenta.id
       where cuenta_id = v_absorbida and empresa_id = v_emp;
      -- El abono se traslada: si quedara suelto, al borrar la cuenta pagos.cuenta_id se pondría
      -- null en silencio y ese dinero desaparecería del arqueo del turno.
      update public.pagos
         set cuenta_id = v_cuenta.id
       where cuenta_id = v_absorbida and empresa_id = v_emp;
      select greatest(1, coalesce(o.comensales, 1)) into v_com from public.cuentas o where o.id = v_absorbida;
      update public.cuentas
         set comensales = least(coalesce(comensales, 1) + coalesce(v_com, 1), 99)
       where id = v_cuenta.id and empresa_id = v_emp;
      delete from public.cuenta_mesas where cuenta_id = v_absorbida;
      delete from public.cuentas where id = v_absorbida and empresa_id = v_emp;
      v_absorb := v_absorb || jsonb_build_array(v_absorbida);
    end loop;

    insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
    values (v_emp, v_cuenta.id, v_mesa)
    on conflict (cuenta_id, mesa_id) do nothing;
  end loop;

  -- Sin letra cuando ya no queda otra cuenta abierta en ninguna de sus mesas (igual que en unir_subcuentas).
  update public.cuentas set etiqueta = null
   where id = p_cuenta_id and empresa_id = v_emp
     and not exists (
       select 1 from public.cuentas o
        where o.id <> p_cuenta_id and o.empresa_id = v_emp and o.estado <> 'cerrada'
          and exists (select 1 from public.cuenta_mesas a
                       where a.cuenta_id = p_cuenta_id
                         and exists (select 1 from public.cuenta_mesas b
                                      where b.cuenta_id = o.id and b.mesa_id = a.mesa_id)));

  begin
    perform private.auditar(v_emp, 'mesa_unidas', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'mesas', p_mesa_ids, 'absorbidas', v_absorb),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return jsonb_build_object('cuenta_id', v_cuenta.id, 'absorbidas', v_absorb);
end $fn$;

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

  begin
    perform private.auditar(v_emp, 'mesa_separada', jsonb_build_object(
      'cuenta_origen', v_cuenta.id::text, 'cuenta_nueva', v_nueva::text,
      'mesa', p_mesa_id::text),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_nueva;
end $fn$;

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

  begin
    perform private.auditar(v_emp, 'item_movido', jsonb_build_object(
      'origen', v_origen.id::text, 'destino', v_dest::text,
      'mesa_destino', p_mesa_destino::text, 'items', p_item_ids),
      'cuenta', 'cuenta ' || coalesce(v_origen.numero::text, left(v_origen.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_dest;
end $fn$;

-- v0.38 · Unir subcuentas hermanas (2A + 2B) y mover solo parte de un ítem enviado.
-- unir_mesas trabaja por MESAS; las subcuentas de dividir_cuenta comparten la misma mesa, así que
-- unirlas por ahí no tiene efecto. Esta RPC une por CUENTA.
create or replace function public.unir_subcuentas(
  p_cuenta_id  uuid,
  p_cuenta_ids jsonb,
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
  v_otra   uuid;
  v_com    integer;
  v_absorb jsonb := '[]'::jsonb;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if jsonb_typeof(p_cuenta_ids) <> 'array' or jsonb_array_length(p_cuenta_ids) = 0 then
    raise exception 'p_cuenta_ids debe ser un array jsonb no vacío';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  for v_otra in select "value"::uuid from jsonb_array_elements_text(p_cuenta_ids) loop
    if v_otra = v_cuenta.id then
      continue;
    end if;
    if not exists (select 1 from public.cuentas c
                   where c.id = v_otra and c.empresa_id = v_emp and c.estado <> 'cerrada') then
      raise exception 'cuenta inexistente, cerrada o de otra empresa: %', v_otra;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_otra::text, 0));

    update public.cuenta_items
       set cuenta_id = v_cuenta.id
     where cuenta_id = v_otra and empresa_id = v_emp;

    -- El abono se traslada: si quedara en la cuenta cerrada el saldo ya cobrado desaparecería y se cobraría dos veces.
    update public.pagos
       set cuenta_id = v_cuenta.id
     where cuenta_id = v_otra and empresa_id = v_emp;

    -- Si la absorbida estaba en otra mesa, esa mesa pasa a la cuenta que queda.
    insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
    select v_emp, v_cuenta.id, cm.mesa_id
      from public.cuenta_mesas cm
     where cm.cuenta_id = v_otra
    on conflict (cuenta_id, mesa_id) do nothing;

    select greatest(1, coalesce(c.comensales, 1)) into v_com from public.cuentas c where c.id = v_otra;
    update public.cuentas
       set comensales = least(coalesce(comensales, 1) + coalesce(v_com, 1), 99)
     where id = v_cuenta.id and empresa_id = v_emp;

    delete from public.cuenta_mesas where cuenta_id = v_otra;
    -- La absorbida se borra, no se deja «cerrada con nota»: en la mesa sobraba su letra y un cliente
    -- no entiende por qué la 2a sigue existiendo después de unirla con la 2b.
    delete from public.cuentas where id = v_otra and empresa_id = v_emp;

    v_absorb := v_absorb || jsonb_build_array(v_otra);
  end loop;

  -- La letra solo vive mientras hay más de una cuenta abierta en la mesa; unida la mesa, se suelta.
  update public.cuentas set etiqueta = null
   where id = p_cuenta_id and empresa_id = v_emp
     and not exists (
       select 1 from public.cuentas o
        where o.id <> p_cuenta_id and o.empresa_id = v_emp and o.estado <> 'cerrada'
          and exists (select 1 from public.cuenta_mesas a
                       where a.cuenta_id = p_cuenta_id
                         and exists (select 1 from public.cuenta_mesas b
                                      where b.cuenta_id = o.id and b.mesa_id = a.mesa_id)));

  begin
    perform private.auditar(v_emp, 'subcuentas_unidas', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'cuentas', p_cuenta_ids, 'absorbidas', v_absorb),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return jsonb_build_object('cuenta_id', v_cuenta.id, 'absorbidas', v_absorb);
end $fn$;
revoke all on function public.unir_subcuentas(uuid, jsonb, uuid) from public, anon;
grant execute on function public.unir_subcuentas(uuid, jsonb, uuid) to authenticated;

-- Parte una fila: deja el resto en la cuenta origen y manda solo p_cantidad al destino.
-- Conserva estado, áreas, indicaciones y precio, así cocina no vuelve a ver el plato como recién pedido.
create or replace function public.mover_item_parcial(
  p_item_id           uuid,
  p_cantidad          integer,
  p_cuenta_destino_id uuid default null,
  p_mesa_destino      uuid default null,
  p_empresa_id        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_it     public.cuenta_items;
  v_origen public.cuentas;
  v_dest   uuid;
  v_nuevo  uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);

  select * into v_it from public.cuenta_items where id = p_item_id and empresa_id = v_emp;
  if not found then
    raise exception 'ítem inexistente en la empresa activa';
  end if;
  if v_it.estado = 'anulado' then
    raise exception 'el ítem está anulado';
  end if;
  if coalesce(p_cantidad, 0) < 1 then
    raise exception 'indicá cuántas unidades mover';
  end if;

  v_origen := private.load_cuenta(v_it.cuenta_id, array['abierta','precuenta']::text[]);
  if p_cuenta_destino_id is null and p_mesa_destino is null then
    raise exception 'indique p_mesa_destino o p_cuenta_destino_id';
  end if;
  if p_cuenta_destino_id = v_origen.id then
    raise exception 'la cuenta destino es la misma cuenta origen';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_origen.id::text, 0));

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

  if p_cantidad >= v_it.qty then
    update public.cuenta_items set cuenta_id = v_dest where id = v_it.id;
    begin
      perform private.auditar(v_emp, 'item_movido_parcial', jsonb_build_object(
        'item', v_it.id::text, 'cantidad', v_it.qty, 'completo', true,
        'origen', v_origen.id::text, 'destino', v_dest::text),
        'cuenta_item', v_it.nombre_snapshot);
    exception when others then
      null; -- una falla de la bitácora nunca revierte la operación
    end;
    return v_dest;
  end if;

  update public.cuenta_items set qty = qty - p_cantidad where id = v_it.id;

  insert into public.cuenta_items
    (empresa_id, cuenta_id, producto_id, nombre_snapshot, precio_snapshot, qty, estado, nota, indicaciones,
     motivo_anulacion, enviado_en, areas, areas_listas, extras, listo_en,
     anulacion_motivo, anulacion_por, anulacion_pedida_en, anulacion_estado_previo,
     anulacion_resuelta_por, anulacion_resuelta_en)
  values
    (v_emp, v_dest, v_it.producto_id, v_it.nombre_snapshot, v_it.precio_snapshot, p_cantidad, v_it.estado,
     v_it.nota, v_it.indicaciones, v_it.motivo_anulacion, v_it.enviado_en, v_it.areas, v_it.areas_listas,
     v_it.extras, v_it.listo_en, v_it.anulacion_motivo, v_it.anulacion_por, v_it.anulacion_pedida_en,
     v_it.anulacion_estado_previo, v_it.anulacion_resuelta_por, v_it.anulacion_resuelta_en)
  returning id into v_nuevo;

  insert into public.cuenta_item_areas (item_id, empresa_id, area, listo_en, listo_por)
  select v_nuevo, v_emp, a.area, a.listo_en, a.listo_por
    from public.cuenta_item_areas a
   where a.item_id = v_it.id
  on conflict (item_id, area) do nothing;

  begin
    perform private.auditar(v_emp, 'item_movido_parcial', jsonb_build_object(
      'item', v_it.id::text, 'cantidad', p_cantidad, 'completo', false,
      'origen', v_origen.id::text, 'destino', v_dest::text),
      'cuenta_item', v_it.nombre_snapshot);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_nuevo;
end $fn$;
revoke all on function public.mover_item_parcial(uuid, integer, uuid, uuid, uuid) from public, anon;
grant execute on function public.mover_item_parcial(uuid, integer, uuid, uuid, uuid) to authenticated;

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

  begin
    perform private.auditar(v_emp, 'cuenta_extras', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'propina', v_cuenta.propina,
      'descuento', v_cuenta.descuento, 'total', v_final),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return jsonb_build_object(
    'cuenta_id', v_cuenta.id,
    'subtotal',  v_total,
    'descuento', v_cuenta.descuento,
    'propina',   v_cuenta.propina,
    'total',     v_final
  );
end $fn$;

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
  v_num integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  update public.cuentas set estado = 'precuenta'
   where id = p_cuenta_id and empresa_id = v_emp and estado = 'abierta';
  if not found then
    raise exception 'no se pudo pasar a pre-cuenta (cuenta no abierta en la empresa activa)';
  end if;
  select numero into v_num from public.cuentas where id = p_cuenta_id;
  begin
    perform private.auditar(v_emp, 'cuenta_precuenta', jsonb_build_object('cuenta', p_cuenta_id::text),
      'cuenta', 'cuenta ' || coalesce(v_num::text, left(p_cuenta_id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
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
  v_num integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  update public.cuentas set estado = 'abierta'
   where id = p_cuenta_id and empresa_id = v_emp and estado = 'precuenta';
  if not found then
    raise exception 'la cuenta no está en pre-cuenta (empresa activa)';
  end if;
  select numero into v_num from public.cuentas where id = p_cuenta_id;
  begin
    perform private.auditar(v_emp, 'cuenta_reabierta', jsonb_build_object('cuenta', p_cuenta_id::text),
      'cuenta', 'cuenta ' || coalesce(v_num::text, left(p_cuenta_id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;

create or replace function public.cobrar_cuenta(
  p_cuenta_id  uuid,
  p_pagos      jsonb,
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
  v_rol := private.exigir_rol(array['admin','cajero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'p_pagos debe ser un array jsonb no vacío';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

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

  -- Un abono previo (abonar_cuenta) ya es dinero entrado de ESTA cuenta: cuenta
  -- para cubrir el total, si no el cobro final pediría dos veces lo mismo.
  v_pagado := coalesce((select sum(p.monto) from public.pagos p
                         where p.cuenta_id = v_cuenta.id and p.empresa_id = v_emp), 0);

  for v_pg in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := lower(coalesce(v_pg->>'metodo', ''));
    if v_metodo not in ('efectivo','qr','tarjeta','mixed','cheque','vale','cxc','otro') then
      raise exception 'método de pago inválido: %', v_metodo;
    end if;
    -- Cuenta por cobrar: siempre a nombre de una persona registrada en ESTA empresa.
    if v_metodo = 'cxc' and not (
         exists (select 1 from public.membresias mm
                  where mm.empresa_id = v_emp
                    and mm.user_id::text = coalesce(v_pg->'detalle'->>'trabajador_id', ''))
         or exists (select 1 from public.personal pe
                     where pe.empresa_id = v_emp and pe.activo
                       and pe.id::text = coalesce(v_pg->'detalle'->>'trabajador_id', ''))) then
      raise exception 'cuenta por cobrar: elige un trabajador registrado';
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

  select coalesce(jsonb_agg(m.nombre order by m.nombre), '[]'::jsonb) into v_mesas
    from public.cuenta_mesas cm
    join public.mesas m on m.id = cm.mesa_id
   where cm.cuenta_id = v_cuenta.id;

  -- Deja escrita la mesa en la cuenta: cuenta_mesas se borra abajo y sin esto los
  -- reportes no tendrían de qué hablar de "por mesa" en cuentas ya cobradas.
  update public.cuentas
     set mesas_texto = (select string_agg(m.nombre, ', ' order by m.nombre)
                          from public.cuenta_mesas cm
                          join public.mesas m on m.id = cm.mesa_id
                         where cm.cuenta_id = v_cuenta.id)
   where id = v_cuenta.id;

  delete from public.cuenta_mesas where cuenta_id = v_cuenta.id;

  v_turno := (private.turno_actual(v_emp)).id;
  if v_turno is not null then
    update public.turnos_caja t
       set movimientos = t.movimientos
         || jsonb_build_object(
              'venta_efectivo',   coalesce((t.movimientos->>'venta_efectivo')::numeric, 0) + v_efectivo,
              'cuentas_cerradas', coalesce((t.movimientos->>'cuentas_cerradas')::integer, 0) + 1)
     where t.id = v_turno;
  end if;

  begin
    with vivos as (
      select t.producto_id, sum(t.qty)::numeric as qty from (
        select i.producto_id, i.qty
          from public.cuenta_items i
         where i.cuenta_id = v_cuenta.id and i.empresa_id = v_emp
           and i.producto_id is not null
           and i.estado <> 'anulado'
        union all
        select (x.value->>'producto_id')::uuid, i.qty
          from public.cuenta_items i
          cross join lateral jsonb_array_elements(i.extras) x
         where i.cuenta_id = v_cuenta.id and i.empresa_id = v_emp
           and i.estado <> 'anulado'
           and nullif(x.value->>'producto_id', '') is not null
      ) t
       group by t.producto_id
    ), baja as (
      select r.insumo_id, sum(v.qty * r.cantidad) as consume
        from vivos v
        join public.recetas r on r.producto_id = v.producto_id
       group by r.insumo_id
    ), upd as (
      update public.insumos s
         set stock = s.stock - b.consume,
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
    null;
  end;

  begin
    perform private.auditar(v_emp, 'cuenta_cobrada', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'numero', v_cuenta.numero, 'tipo', v_cuenta.tipo,
      'mesas', v_mesas, 'subtotal', v_subtotal, 'descuento', v_cuenta.descuento,
      'propina', v_cuenta.propina, 'total', v_final, 'pagado', v_pagado,
      'cambio', v_pagado - v_final,
      'metodos', (select coalesce(jsonb_agg(distinct p.metodo), '[]'::jsonb)
                    from public.pagos p where p.cuenta_id = v_cuenta.id)),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte el cobro
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

-- Cobro parcial: entra un pago (o varios) DEJANDO la cuenta abierta con su saldo.
-- Es lo que permite cobrar 2 cervezas y que la mesa siga pedida, o que alguien del
-- grupo se vaya pagando su parte. El `detalle` guarda el concepto (qué se cobró).
create or replace function public.abonar_cuenta(
  p_cuenta_id  uuid,
  p_pagos      jsonb,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp      uuid;
  v_cuenta   public.cuentas;
  v_pg       jsonb;
  v_metodo   text;
  v_monto    numeric(10,2);
  v_subtotal numeric;
  v_final    numeric;
  v_previo   numeric := 0;
  v_abonado  numeric := 0;
  v_efectivo numeric := 0;
  v_turno    uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'p_pagos debe ser un array jsonb no vacío';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  v_subtotal := private.total_items(v_cuenta.id);
  v_final    := greatest(v_subtotal - v_cuenta.descuento, 0) + v_cuenta.propina;
  v_previo   := coalesce((select sum(p.monto) from public.pagos p
                           where p.cuenta_id = v_cuenta.id and p.empresa_id = v_emp), 0);

  for v_pg in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := lower(coalesce(v_pg->>'metodo', ''));
    if v_metodo not in ('efectivo','qr','tarjeta','mixed','cheque','vale','cxc','otro') then
      raise exception 'método de pago inválido: %', v_metodo;
    end if;
    -- Cuenta por cobrar: siempre a nombre de una persona registrada en ESTA empresa.
    if v_metodo = 'cxc' and not (
         exists (select 1 from public.membresias mm
                  where mm.empresa_id = v_emp
                    and mm.user_id::text = coalesce(v_pg->'detalle'->>'trabajador_id', ''))
         or exists (select 1 from public.personal pe
                     where pe.empresa_id = v_emp and pe.activo
                       and pe.id::text = coalesce(v_pg->'detalle'->>'trabajador_id', ''))) then
      raise exception 'cuenta por cobrar: elige un trabajador registrado';
    end if;
    v_monto := coalesce(nullif(v_pg->>'monto','')::numeric, 0);
    if v_monto <= 0 then
      raise exception 'el monto del abono debe ser mayor que 0';
    end if;
    insert into public.pagos (empresa_id, cuenta_id, metodo, monto, detalle, creada_por)
    values (v_emp, v_cuenta.id, v_metodo, v_monto,
            coalesce(v_pg->'detalle', '{}'::jsonb), auth.uid());
    v_abonado := v_abonado + v_monto;
    if v_metodo = 'efectivo' then
      v_efectivo := v_efectivo + v_monto;
    end if;
  end loop;

  if v_previo + v_abonado >= v_final then
    raise exception 'el abono (% Bs) cubre el total (% Bs): cierra la cuenta con el cobro', v_abonado, v_final;
  end if;

  -- El dinero del abono está en el cajón AHORA, no cuando la mesa se cierre.
  v_turno := (private.turno_actual(v_emp)).id;
  if v_turno is not null and v_efectivo > 0 then
    update public.turnos_caja t
       set movimientos = t.movimientos
         || jsonb_build_object(
              'venta_efectivo', coalesce((t.movimientos->>'venta_efectivo')::numeric, 0) + v_efectivo)
     where t.id = v_turno;
  end if;

  begin
    perform private.auditar(v_emp, 'cuenta_abonada', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'abonado', v_abonado, 'total', v_final,
      'pagado', v_previo + v_abonado, 'saldo', greatest(v_final - v_previo - v_abonado, 0)),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte el abono
  end;

  return jsonb_build_object(
    'cuenta_id', v_cuenta.id,
    'total',     v_final,
    'pagado',    v_previo + v_abonado,
    'saldo',     greatest(v_final - v_previo - v_abonado, 0),
    'abonado',   v_abonado,
    'moneda',    (select e.moneda from public.empresas e where e.id = v_emp)
  );
end $fn$;

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
  v_emp  uuid;
  v_id   uuid;
  v_modo text;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  v_modo := private.caja_modo(v_emp);

  perform pg_advisory_xact_lock(hashtextextended('turno:' || v_emp::text, 0));

  if v_modo = 'por_cajero' then
    if exists (select 1 from public.turnos_caja
               where empresa_id = v_emp and cerrado_en is null and modo = 'compartida') then
      raise exception 'hay un turno compartido abierto: ciérralo antes de trabajar con un turno por cajero';
    end if;
    if exists (select 1 from public.turnos_caja
               where empresa_id = v_emp and cerrado_en is null and abierto_por = auth.uid()) then
      raise exception 'ya tienes un turno de caja abierto';
    end if;
  elsif exists (select 1 from public.turnos_caja
                where empresa_id = v_emp and cerrado_en is null) then
    raise exception 'ya existe un turno de caja abierto para esta empresa';
  end if;

  insert into public.turnos_caja (empresa_id, abierto_por, fondo, modo)
  values (v_emp, auth.uid(), greatest(coalesce(p_fondo, 0), 0), v_modo)
  returning id into v_id;

  begin
    perform private.auditar(v_emp, 'turno_abierto', jsonb_build_object(
      'turno', v_id::text, 'fondo', greatest(coalesce(p_fondo, 0), 0), 'modo', v_modo),
      'turno', 'turno ' || left(v_id::text, 8));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_id;
end $fn$;

create or replace function public.registrar_movimiento_caja(
  p_tipo       text,
  p_monto      numeric,
  p_motivo     text    default null,
  p_turno_id   uuid    default null,
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

  v_turno := private.turno_actual(v_emp, p_turno_id);
  if v_turno.id is null then
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

  begin
    perform private.auditar(v_emp, 'caja_movimiento', jsonb_build_object(
      'turno', v_turno.id::text, 'tipo', p_tipo, 'monto', v_monto,
      'motivo', coalesce(p_motivo, '')),
      'turno', 'turno ' || left(v_turno.id::text, 8));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return jsonb_build_object('turno_id', v_turno.id, 'movimiento', v_mov);
end $fn$;

create or replace function public.cerrar_turno(
  p_contado       numeric,
  p_turno_id      uuid    default null,
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

  v_turno := private.turno_actual(v_emp, p_turno_id);
  if v_turno.id is null then
    raise exception 'no hay turno abierto que cerrar';
  end if;
  if v_turno.modo = 'por_cajero' and v_turno.abierto_por is distinct from auth.uid() then
    perform private.exigir_rol(array['admin']::text[]);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('turno:' || v_turno.id::text, 0));

  -- Por ventana de PAGOS, no de cierre: un abono de una mesa que sigue abierta ya
  -- está en el cajón y tiene que contar en este turno.
  select coalesce(sum(p.monto), 0)::numeric into v_efectivo
    from public.pagos p
   where p.empresa_id = v_emp
     and p.metodo = 'efectivo'
     and p.creada_en >= v_turno.abierto_en
     and p.creada_en <= now()
     and (v_turno.modo <> 'por_cajero' or p.creada_por = v_turno.abierto_por);

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
             'cerrado_en',        now(),
             'devoluciones',      private.devoluciones_del_turno(v_emp, t.id, t.abierto_en)
           ), true
         )
   where t.id = v_turno.id and t.empresa_id = v_emp;

  begin
    perform private.auditar(v_emp, 'turno_cerrado', jsonb_build_object(
      'turno', v_turno.id::text, 'esperado', v_esperado,
      'contado', coalesce(p_contado, 0), 'diferencia', v_dif,
      'venta_efectivo', v_efectivo, 'ingresos', v_ingresos, 'egresos', v_egresos),
      'turno', 'turno ' || left(v_turno.id::text, 8));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return jsonb_build_object(
    'turno_id',       v_turno.id,
    'fondo',          v_turno.fondo,
    'venta_efectivo', v_efectivo,
    'ingresos',       v_ingresos,
    'egresos',        v_egresos,
    'esperado',       v_esperado,
    'contado',        coalesce(p_contado, 0),
    'diferencia',     v_dif,
    'devoluciones',   private.devoluciones_del_turno(v_emp, v_turno.id, v_turno.abierto_en)
  );
end $fn$;

-- ## 3b) Permisos de ejecución de las RPCs

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
  public.abonar_cuenta(uuid, jsonb, uuid),
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
  public.abonar_cuenta(uuid, jsonb, uuid),
  public.abrir_turno(uuid, numeric),
  public.registrar_movimiento_caja(text, numeric, text, uuid, uuid),
  public.cerrar_turno(numeric, uuid, uuid)
to authenticated;

-- ## 4) VISTA: estado de mesas por empresa

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

-- ## 5) RLS: habilitado en TODAS + políticas SELECT/INSERT/UPDATE/DELETE por

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

drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select to authenticated
  using ((select private.es_miembro_de(id)));
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas
  for update to authenticated
  using ((select private.empresa_ok(id)) and (select private.es_admin()))
  with check ((select private.empresa_ok(id)));

drop policy if exists membresias_select on public.membresias;
create policy membresias_select on public.membresias
  for select to authenticated
  using (user_id = (select auth.uid())
         or empresa_id = (select private.empresa_activa()));

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.comparte_empresa(user_id)));
drop policy if exists perfiles_insert on public.perfiles;
create policy perfiles_insert on public.perfiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

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

-- ## 5b) GRANTs de datos

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

grant update on public.empresas to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from anon;
grant execute on all functions in schema private to authenticated;

revoke all on function private.auditar(uuid, text, jsonb, text, text) from public, anon, authenticated;

-- ## 6) Trigger: crear public.perfiles al registrarse en Supabase Auth

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

-- ## 2) PLANES Y CUOTAS OCULTAS

create or replace function private.plan_defaults(p_plan text)
returns table (max_productos integer, max_miembros integer)
language sql
immutable
set search_path = ''
as $fn$
  select case when p_plan = 'pago' then null else 20 end,
         case when p_plan = 'pago' then null else 3  end;
$fn$;
revoke all on function private.plan_defaults(text) from public, anon, authenticated;

create table if not exists public.limites (
  empresa_id      uuid primary key references public.empresas(id) on delete cascade,
  max_productos   integer,
  max_miembros    integer,
  plan            text not null default 'gratis' check (plan in ('gratis','pago')),
  notas           text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);
alter table public.limites add column if not exists max_miembros integer;
alter table public.limites enable row level security;
alter table public.limites force row level security;
revoke all on table public.limites from public, anon, authenticated;

insert into public.limites (empresa_id, plan, max_productos, max_miembros)
select e.id, 'gratis', d.max_productos, d.max_miembros
  from public.empresas e, private.plan_defaults('gratis') d
on conflict (empresa_id) do nothing;

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
  perform private.vencer_planes(new.empresa_id);
  if public.es_super() then return new; end if;

  select l.max_productos into v_max from public.limites l where l.empresa_id = new.empresa_id;
  if not found then
    select d.max_productos into v_max from private.plan_defaults('gratis') d;
  end if;
  if v_max is null then return new; end if;

  if not coalesce(new.activo, true) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.activo, true) = coalesce(new.activo, true) then
    return new;
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
  perform private.vencer_planes(new.empresa_id);
  if public.es_super() then return new; end if;

  select l.max_miembros into v_max from public.limites l where l.empresa_id = new.empresa_id;
  if not found then
    select d.max_miembros into v_max from private.plan_defaults('gratis') d;
  end if;
  if v_max is null then return new; end if;

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
        premium_hasta  = case when excluded.plan = 'pago' then limites.premium_hasta else null end,
        actualizado_en = now(),
        actualizado_por = excluded.actualizado_por;
  perform private.auditar(p_empresa, 'super_ajustar_cuota',
    jsonb_build_object('plan', v_plan, 'max_productos', v_prod, 'max_miembros', v_miem));
  return jsonb_build_object('plan', v_plan, 'max_productos', v_prod, 'max_miembros', v_miem);
end $fn$;
revoke all on function public.super_ajustar_empresa(uuid, integer, text, text, integer) from public, anon;
grant execute on function public.super_ajustar_empresa(uuid, integer, text, text, integer) to authenticated;

-- ## 3) MINIATURAS DE ARTÍCULOS

alter table public.productos add column if not exists imagen_path text;
alter table public.productos drop constraint if exists productos_imagen_path_fmt;
alter table public.productos add constraint productos_imagen_path_fmt check (
  imagen_path is null
  or imagen_path ~ '^productos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
);

insert into storage.buckets (id, name, public)
values ('pos-imagenes', 'pos-imagenes', true)
on conflict (id) do update set public = true;

do $do$ begin
  update storage.buckets
     set file_size_limit = 209715,
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

  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);

drop policy if exists "pos_imagenes_select" on storage.objects;

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

-- Comprobantes de pagos con QR (foto de la pantalla del cliente; opcional). Bucket PRIVADO: se ven con URL firmada.
-- Ruta: comprobantes/<empresa_id>/<uuid>.webp|jpg. Los miembros de la empresa pueden subir y ver; nadie edita ni borra desde la app.
insert into storage.buckets (id, name, public)
values ('pos-comprobantes', 'pos-comprobantes', false)
on conflict (id) do update set public = false;

do $do$ begin
  update storage.buckets
     set file_size_limit = 307200,
         allowed_mime_types = array['image/webp','image/jpeg']
   where id = 'pos-comprobantes';
exception when others then
  raise notice 'pos-comprobantes: file_size_limit/allowed_mime_types no aplicables (%)', sqlerrm;
end $do$;

drop policy if exists "pos_comprobantes_insert" on storage.objects;
create policy "pos_comprobantes_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pos-comprobantes'
  and name ~ '^comprobantes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);

drop policy if exists "pos_comprobantes_select" on storage.objects;
create policy "pos_comprobantes_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'pos-comprobantes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and private.es_miembro_de(e.id))
);

-- ## 4) THROTTLE ANTI-FUERZA-BRUTA de códigos de empresa

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
  if v_ip is null then v_ip := 'sin-ip'; end if;
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
    return;
  end if;
  if not private.throttle_ok('cod', 30) then
    return;
  end if;
  return query
    select e.id, e.nombre, e.moneda
      from public.empresas e
     where e.codigo is not null and lower(e.codigo) = lower(trim(p_codigo));
end $fn$;
revoke all on function public.empresa_por_codigo(text) from public;
grant execute on function public.empresa_por_codigo(text) to anon, authenticated;

-- ## 5) AUDITORÍA legible solo por el super

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

  v_n := coalesce(p_comensales, 0);
  if v_n < 1 or v_n > 99 then
    raise exception 'El número de comensales debe estar entre 1 y 99';
  end if;

  update public.cuentas set comensales = v_n
   where id = p_cuenta_id and empresa_id = v_emp and estado <> 'cerrada';
  if not found then
    raise exception 'No se pudo cambiar los comensales: la cuenta no está abierta en esta empresa';
  end if;

  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'comensales',
      jsonb_build_object('cuenta', p_cuenta_id::text, 'comensales', v_n));
  end if;

  return v_n;
end $fn$;

revoke all on function public.actualizar_comensales(uuid, integer, uuid) from public, anon;
grant execute on function public.actualizar_comensales(uuid, integer, uuid) to authenticated;

-- ## 1) Registro self-service: quien se da de alta con signUp + options.data.a

-- ## 2) RPCs de equipo

-- ## 3) RPC del dueño de la plataforma para resetear la clave de CUALQUIER usu

-- ## 1) ALTA SELF-SERVICE DE EMPRESA

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

  if coalesce(NEW.raw_user_meta_data ->> 'alta_empresa', '') <> 'true' then
    return NEW;
  end if;

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

  if exists (select 1 from public.empresas where lower(codigo) = v_codigo) then
    raise exception 'alta_codigo_tomado: el código % ya está en uso por otra empresa', v_codigo
      using errcode = '23505';
  end if;

  insert into public.empresas (nombre, codigo)
  values (v_nombre_emp, v_codigo)
  returning id into v_emp;

  insert into public.membresias (empresa_id, user_id, rol)
  values (v_emp, NEW.id, 'admin')
  on conflict (empresa_id, user_id) do nothing;

  insert into public.zonas (empresa_id, nombre, orden)
  values (v_emp, 'Salón', 1)
  returning id into v_zona;

  insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad)
  select v_emp, v_zona, gs.n::text,
         70 + ((gs.n - 1) % 4) * 250,
         95 + ((gs.n - 1) / 4) * 300,
         110, 110, 'cuadrada', 4
    from generate_series(1, 8) as gs(n);

  if to_regclass('public.auditoria') is not null then
    perform private.auditar(v_emp, 'alta_empresa',
      jsonb_build_object('usuario', NEW.id::text,
                         'correo',  coalesce(NEW.email, ''),
                         'codigo',  v_codigo),
      'empresa', (select e.nombre from public.empresas e where e.id = v_emp));
  end if;

  return NEW;
end $fn$;

revoke all on function private.registrar_empresa_del_registrado() from public, anon, authenticated;

drop trigger if exists trg_alta_empresa_registrado on auth.users;
create trigger trg_alta_empresa_registrado
  after insert on auth.users
  for each row execute function private.registrar_empresa_del_registrado();

-- ## 2) EQUIPO

drop function if exists public.equipo_listar();
create or replace function public.equipo_listar()
returns table (usuario_id uuid, nombre text, correo text, rol text, creado_en timestamptz, areas text[])
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

           coalesce(u.email::text, ''),
           m.rol,
           m.creada_en,
           m.areas
      from public.membresias m
      join auth.users u on u.id = m.user_id
      left join public.perfiles p on p.user_id = m.user_id
     where m.empresa_id = v_emp
     order by m.rol, coalesce(p.display_name, '');
end $fn$;

revoke all on function public.equipo_listar() from public, anon;
grant execute on function public.equipo_listar() to authenticated;

-- ## 3) EQUIPO

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

  if exists (select 1 from public.membresias m
                join auth.users u on u.id = m.user_id
               where m.empresa_id = v_emp and lower(u.email) = v_email) then
    raise exception 'equipo_correo_tomado: ese correo ya es miembro de esta empresa'
      using errcode = '23505';
  end if;

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
          jsonb_build_object('display_name', coalesce(p_nombre, '')),
          '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_new, v_new::text, 'email',
          jsonb_build_object('sub', v_new::text, 'email', v_email, 'email_verified', true),
          now(), now(), now());

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

-- ## 4) EQUIPO

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

-- ## 5) EQUIPO

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

  if to_regclass('public.supers') is not null
     and exists (select 1 from public.supers s where s.user_id = p_usuario_id) then
    raise exception 'No se puede revocar a un administrador de la plataforma';
  end if;

  if not exists (select 1 from public.membresias m
                  where m.empresa_id = v_emp and m.user_id = p_usuario_id) then
    raise exception 'El usuario no es miembro de la empresa activa';
  end if;

  select m.rol into v_rol from public.membresias m
   where m.empresa_id = v_emp and m.user_id = p_usuario_id;

  if v_rol = 'admin' then
    select count(*) into v_admins from public.membresias
     where empresa_id = v_emp and rol = 'admin';
    if v_admins <= 1 then
      raise exception 'Debe quedar al menos un administrador en la empresa';
    end if;
  end if;

  delete from public.membresias
   where empresa_id = v_emp and user_id = p_usuario_id;

  if not exists (select 1 from public.membresias m where m.user_id = p_usuario_id) then
    begin
      delete from auth.users where id = p_usuario_id;
    exception when foreign_key_violation then
      null;
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

-- ## 6) SUPER

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

create table if not exists public.trabajos_impresion (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  grupo        text not null check (char_length(grupo) between 1 and 60),
  titulo       text not null default '',
  payload      jsonb not null,
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

revoke all on public.trabajos_impresion from public, anon;
revoke insert, update, delete, truncate on public.trabajos_impresion from authenticated;
grant select on public.trabajos_impresion to authenticated;

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

  delete from public.trabajos_impresion
   where empresa_id = v_emp and creado_en < now() - interval '3 days';

  return v_n;
end $fn$;
revoke all on function public.encolar_impresion(jsonb, uuid) from public, anon;
grant execute on function public.encolar_impresion(jsonb, uuid) to authenticated;

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
  select count(*) into v_cuentas from b;

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

do $do$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('pos-purga-retencion', '30 4 * * *', 'select private.purgar_datos_antiguos()');
exception when others then
  raise notice 'pg_cron no disponible (%): la purga automática NO está programada.', sqlerrm;
end $do$;


begin;

-- ## A) ROL

alter table public.membresias drop constraint if exists membresias_rol_check;
alter table public.membresias add constraint membresias_rol_check
  check (rol in ('admin','cajero','mesero','cocina','barra'));

-- ## B) MULTI-ÁREA

alter table public.productos add column if not exists areas text[] not null default array['cocina']::text[];

create or replace function private.areas_validas(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(array_length(p, 1), 0) > 0
     and not exists (select 1 from unnest(p) a where a is null or a !~ '^[a-z0-9][a-z0-9_-]{0,39}$');
$fn$;
alter table public.productos drop constraint if exists productos_areas_chk;
alter table public.productos add constraint productos_areas_chk check (private.areas_validas(areas));

alter table public.cuenta_items add column if not exists areas text[] not null default array['cocina']::text[];

-- ## C) ESTADOS

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

create table if not exists public.cuenta_item_areas (
  item_id    uuid not null references public.cuenta_items(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  area       text not null check (length(area) between 1 and 40),
  listo_en   timestamptz not null default now(),
  listo_por  uuid references auth.users(id) on delete set null,
  primary key (item_id, area)
);
create index if not exists cuenta_item_areas_emp_idx on public.cuenta_item_areas (empresa_id);
alter table public.cuenta_item_areas enable row level security;
drop policy if exists cuenta_item_areas_select on public.cuenta_item_areas;
create policy cuenta_item_areas_select on public.cuenta_item_areas for select to authenticated
  using (empresa_id = (select private.empresa_activa()));

alter table public.cuenta_items add column if not exists areas_listas text[] not null default '{}'::text[];
alter table public.cuenta_items add column if not exists extras jsonb not null default '[]'::jsonb;

insert into public.cuenta_item_areas (item_id, empresa_id, area, listo_en)
select i.id, i.empresa_id, a, coalesce(i.listo_en, now())
  from public.cuenta_items i cross join lateral unnest(i.areas) as a
 where i.estado = 'listo'
on conflict (item_id, area) do nothing;
update public.cuenta_items i set areas_listas = i.areas
 where i.estado = 'listo' and i.areas_listas = '{}'::text[];

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'cuenta_item_areas') then
    alter publication supabase_realtime add table public.cuenta_item_areas;
  end if;
exception when others then
  raise notice 'No se pudo añadir cuenta_item_areas a supabase_realtime (%): la cocina usa el sondeo.', sqlerrm;
end $do$;

drop function if exists public.marcar_salida(jsonb, uuid);
create or replace function public.marcar_salida(
  p_item_ids   jsonb,
  p_area       text default null,
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
  v_ids uuid[];
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','cocina','barra']::text[]);

  if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array' then
    raise exception 'Debe enviar una lista de ítems';
  end if;
  if p_area is not null and (length(btrim(p_area)) = 0 or length(p_area) > 40) then
    raise exception 'Área inválida';
  end if;
  perform private.exigir_area(p_area);
  v_ids := array(select "value"::uuid from jsonb_array_elements_text(p_item_ids));

  -- ## 1) marca el ítem como sacado en el área pedida
  insert into public.cuenta_item_areas (item_id, empresa_id, area, listo_por)
  -- «Venta directa» (entrega en el mostrador): un plato cobrado ahí cuyo artículo no tiene esa área
  -- (sale de cocina o barra) se da por entregado en TODAS sus áreas; antes no marcaba nada y se quedaba
  -- eternamente en la pantalla de Despacho.
  select i.id, v_emp, a, auth.uid()
    from public.cuenta_items i
    join public.cuentas cu on cu.id = i.cuenta_id
    cross join lateral unnest(i.areas) as a
   where i.empresa_id = v_emp and i.estado = 'enviado' and i.id = any(v_ids)
     and (p_area is null or a = p_area
          or (p_area = 'directa' and cu.tipo = 'directa' and cu.canal is distinct from 'llevar'
              and not ('directa' = any(i.areas))))
  on conflict (item_id, area) do nothing;
  get diagnostics v_n = row_count;

  -- ## 2) areas_listas y estado agregado: 'listo' solo con TODAS las áreas sacad
  update public.cuenta_items i
     set areas_listas = array(select ia.area from public.cuenta_item_areas ia
                               where ia.item_id = i.id and ia.area = any(i.areas) order by ia.area)
   where i.empresa_id = v_emp and i.id = any(v_ids) and i.estado = 'enviado';
  update public.cuenta_items i
     set estado = 'listo', listo_en = now()
   where i.empresa_id = v_emp and i.id = any(v_ids) and i.estado = 'enviado'
     and not exists (select 1 from unnest(i.areas) a where a <> all(i.areas_listas));

  if v_n > 0 then
    perform private.auditar(v_emp, 'item_salida',
      jsonb_build_object('items', v_n, 'area', p_area),
      'cuenta_item',
      (select coalesce(string_agg(s.nombre_snapshot, ', '), (v_n)::text || ' ítems')
         from (select ci.nombre_snapshot
                 from public.cuenta_items ci
                where ci.empresa_id = v_emp and ci.id = any(v_ids)
                limit 6) s));
  end if;
  return v_n;
end $fn$;
revoke all on function public.marcar_salida(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.marcar_salida(jsonb, text, uuid) to authenticated;

drop function if exists public.deshacer_salida(jsonb, uuid);
create or replace function public.deshacer_salida(
  p_item_ids   jsonb,
  p_area       text default null,
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
  v_ids uuid[];
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','cocina','barra']::text[]);

  if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array' then
    raise exception 'Debe enviar una lista de ítems';
  end if;
  if p_area is not null and (length(btrim(p_area)) = 0 or length(p_area) > 40) then
    raise exception 'Área inválida';
  end if;
  perform private.exigir_area(p_area);
  v_ids := array(select "value"::uuid from jsonb_array_elements_text(p_item_ids));

  delete from public.cuenta_item_areas ia using public.cuenta_items i, public.cuentas cu
   where ia.item_id = i.id and cu.id = i.cuenta_id and i.empresa_id = v_emp and i.id = any(v_ids)
     and i.estado in ('enviado','listo')
     and (p_area is null or ia.area = p_area
          or (p_area = 'directa' and cu.tipo = 'directa' and cu.canal is distinct from 'llevar'
              and not ('directa' = any(i.areas))));

  update public.cuenta_items i
     set areas_listas = array(select ia.area from public.cuenta_item_areas ia
                               where ia.item_id = i.id and ia.area = any(i.areas) order by ia.area),
         estado   = case when i.estado = 'listo' then 'enviado' else i.estado end,
         listo_en = case when i.estado = 'listo' then null else i.listo_en end
   where i.empresa_id = v_emp and i.id = any(v_ids) and i.estado in ('enviado','listo');
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform private.auditar(v_emp, 'item_salida_deshacer',
      jsonb_build_object('items', v_n, 'area', p_area),
      'cuenta_item',
      (select coalesce(string_agg(s.nombre_snapshot, ', '), (v_n)::text || ' ítems')
         from (select ci.nombre_snapshot
                 from public.cuenta_items ci
                where ci.empresa_id = v_emp and ci.id = any(v_ids)
                limit 6) s));
  end if;
  return v_n;
end $fn$;
revoke all on function public.deshacer_salida(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.deshacer_salida(jsonb, text, uuid) to authenticated;

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

drop function if exists public.cola_de_area(text, uuid);
create or replace function public.cola_de_area(
  p_area       text default 'cocina',
  p_empresa_id uuid default null,
  p_validas    text[] default null
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

  if coalesce(p_area, '') <> '_sin_area' and coalesce(p_area, '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then
    raise exception 'Área inválida';
  end if;
  perform private.exigir_area(p_area);

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
               'canal',      case when cu.canal = 'llevar' then 'llevar'
                                  when exists (select 1 from public.cuenta_mesas cm
                                                where cm.cuenta_id = cu.id)
                                  then 'mesa' else 'mostrador' end,
               'numero',     cu.numero,
               'cliente',    cu.cliente_nombre,
               'mesero',     coalesce((select nullif(pf.display_name, '') from public.perfiles pf
                                        where pf.user_id = cu.abierta_por), ''),
               'comensales', cu.comensales,
               'etiqueta',   cu.etiqueta,
               'abierta_en', cu.abierta_en,
               'enviada_en', min(i.enviado_en),
               'items', coalesce(jsonb_agg(jsonb_build_object(
                          'id',               i.id,
                          'nombre',           i.nombre_snapshot,
                          'qty',              i.qty,
                          'nota',             i.nota,

                          'estado',           case when i.estado = 'anulacion' then 'anulacion'
                                                   when i.estado = 'listo' or exists (select 1 from public.cuenta_item_areas ia
                                                          where ia.item_id = i.id and ia.area = p_area) then 'listo'
                                                   else 'enviado' end,
                          'estado_item',      i.estado,
                          'areas',            i.areas,
                          'areas_listas',     i.areas_listas,
                          'enviada_en',       i.enviado_en,
                          'listo_en',         coalesce((select ia.listo_en from public.cuenta_item_areas ia
                                                         where ia.item_id = i.id and ia.area = p_area),
                                                       case when i.estado = 'listo' then i.listo_en end),
                          'anulacion_motivo', i.anulacion_motivo)
                        order by i.enviado_en), '[]'::jsonb)
             ) as cuenta_json
        from public.cuentas cu
        join public.cuenta_items i on i.cuenta_id = cu.id
       where cu.empresa_id = v_emp
         and cu.estado <> 'cerrada'
         and case when p_area = '_sin_area'
                  then not (i.areas && coalesce(p_validas, '{}'::text[]))
                  else i.areas @> array[p_area]::text[] end
         and i.estado in ('enviado','listo','anulacion')
       group by cu.id, cu.comensales, cu.abierta_en, cu.etiqueta, cu.canal, cu.numero, cu.cliente_nombre, cu.abierta_por
    ) t;
  return v_out;
end $fn$;
revoke all on function public.cola_de_area(text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.cola_de_area(text, uuid, text[]) to authenticated;

-- ## E) ÁREAS CONFIGURABLES

alter table public.membresias add column if not exists areas text[] not null default '{}'::text[];

create or replace function private.exigir_area(p_area text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rol   text;
  v_areas text[];
begin
  if public.es_super() then return; end if;
  select m.rol, m.areas into v_rol, v_areas
    from public.membresias m
   where m.empresa_id = private.empresa_activa() and m.user_id = auth.uid();
  if v_rol is null or v_rol not in ('cocina','barra') or coalesce(array_length(v_areas, 1), 0) = 0 then
    return;
  end if;
  if p_area is null or p_area = '_sin_area' or not (p_area = any(v_areas)) then
    raise exception 'Tu usuario no tiene asignada esa área';
  end if;
end $fn$;
revoke all on function private.exigir_area(text) from public, anon, authenticated;

create or replace function public.mis_areas(p_empresa_id uuid default null)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero','cocina','barra']::text[]);
  return coalesce((select m.areas from public.membresias m
                    where m.empresa_id = v_emp and m.user_id = auth.uid()), '{}'::text[]);
end $fn$;
revoke all on function public.mis_areas(uuid) from public, anon;
grant execute on function public.mis_areas(uuid) to authenticated;

create or replace function public.equipo_poner_areas(p_usuario_id uuid, p_areas text[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_ar  text[] := coalesce(p_areas, '{}'::text[]);
begin
  perform private.exigir_rol(array['admin']::text[]);
  v_emp := private.empresa_activa();
  if exists (select 1 from unnest(v_ar) a where a is null or a !~ '^[a-z0-9][a-z0-9_-]{0,39}$') then
    raise exception 'Área inválida';
  end if;
  update public.membresias set areas = v_ar
   where empresa_id = v_emp and user_id = p_usuario_id and rol in ('cocina','barra');
  if not found then
    raise exception 'Solo se asignan áreas a personas con rol cocina o barra';
  end if;
  perform private.auditar(v_emp, 'equipo_areas',
    jsonb_build_object('usuario', p_usuario_id::text, 'areas', to_jsonb(v_ar)));
end $fn$;
revoke all on function public.equipo_poner_areas(uuid, text[]) from public, anon;
grant execute on function public.equipo_poner_areas(uuid, text[]) to authenticated;

create or replace function public.retirar_area(
  p_area       text,
  p_reemplazo  text default 'cocina',
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
  perform private.exigir_rol(array['admin']::text[]);
  if coalesce(p_area, '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' or coalesce(p_reemplazo, '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then
    raise exception 'Área inválida';
  end if;
  -- Es un cambio en lote: se anota una sola fila 'area_retirada', no una por producto.
  perform set_config('pos.sin_bitacora', 'on', true);
  update public.productos
     set areas = case when coalesce(array_length(array_remove(areas, p_area), 1), 0) > 0
                      then array_remove(areas, p_area)
                      else array[p_reemplazo]::text[] end
   where empresa_id = v_emp and areas @> array[p_area]::text[];
  get diagnostics v_n = row_count;
  update public.membresias set areas = array_remove(areas, p_area)
   where empresa_id = v_emp and areas @> array[p_area]::text[];
  perform private.auditar(v_emp, 'area_retirada',
    jsonb_build_object('area', p_area, 'reemplazo', p_reemplazo, 'productos', v_n));
  return v_n;
end $fn$;
revoke all on function public.retirar_area(text, text, uuid) from public, anon;
grant execute on function public.retirar_area(text, text, uuid) to authenticated;

-- ## F) DEVOLUCIONES de platos ya servidos

create table if not exists public.devoluciones_item (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id) on delete cascade,
  cuenta_id         uuid references public.cuentas(id) on delete set null,
  item_id           uuid references public.cuenta_items(id) on delete set null,
  area              text not null,
  nombre            text not null,
  qty               integer not null,
  monto             numeric(12,2) not null default 0,
  motivo            text not null,
  mesa              text,
  pedida_por        uuid references auth.users(id) on delete set null,
  pedida_en         timestamptz not null default now(),
  confirmada_por    uuid references auth.users(id) on delete set null,
  confirmada_en     timestamptz,
  nota_confirmacion text,
  turno_id          uuid references public.turnos_caja(id) on delete set null
);
create index if not exists devoluciones_item_emp_idx on public.devoluciones_item (empresa_id, pedida_en desc);
create index if not exists devoluciones_item_pend_idx on public.devoluciones_item (empresa_id, area) where confirmada_en is null;
alter table public.devoluciones_item enable row level security;
alter table public.devoluciones_item force row level security;
drop policy if exists devoluciones_item_select on public.devoluciones_item;
create policy devoluciones_item_select on public.devoluciones_item for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
revoke all on table public.devoluciones_item from public, anon, authenticated;
grant select on table public.devoluciones_item to authenticated;

create or replace function private.crear_devoluciones(p_emp uuid, p_it public.cuenta_items, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_areas text[] := case when p_it.estado = 'listo' then p_it.areas else p_it.areas_listas end;
  v_n     integer := greatest(coalesce(array_length(v_areas, 1), 0), 1);
  v_total numeric := round(coalesce(p_it.precio_snapshot, 0) * coalesce(p_it.qty, 1), 2);
  v_parte numeric := round(v_total / v_n, 2);
  v_turno uuid;
  v_mesa  text;
  v_a     text;
  v_i     integer := 0;
begin
  v_turno := (private.turno_actual(p_emp)).id;
  select coalesce(string_agg(m.nombre, ', ' order by m.nombre), 'Mostrador') into v_mesa
    from public.cuenta_mesas cm join public.mesas m on m.id = cm.mesa_id
   where cm.cuenta_id = p_it.cuenta_id;

  foreach v_a in array v_areas loop
    v_i := v_i + 1;
    insert into public.devoluciones_item
      (empresa_id, cuenta_id, item_id, area, nombre, qty, monto, motivo, mesa, pedida_por, turno_id)
    values (p_emp, p_it.cuenta_id, p_it.id, v_a, p_it.nombre_snapshot, p_it.qty,
            case when v_i = 1 then v_total - v_parte * (v_n - 1) else v_parte end,
            p_motivo, v_mesa, auth.uid(), v_turno);
  end loop;
  perform private.auditar(p_emp, 'devolucion',
    jsonb_build_object('item', p_it.id::text, 'nombre', p_it.nombre_snapshot, 'qty', p_it.qty,
                       'areas', to_jsonb(v_areas), 'monto', v_total, 'motivo', p_motivo));
end $fn$;
revoke all on function private.crear_devoluciones(uuid, public.cuenta_items, text) from public, anon, authenticated;

create or replace function private.devoluciones_del_turno(p_emp uuid, p_turno uuid, p_desde timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'total',          coalesce(sum(d.monto), 0),
    'sin_confirmar',  count(*) filter (where d.confirmada_en is null),
    'filas', coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'nombre', d.nombre, 'qty', d.qty, 'monto', d.monto, 'mesa', d.mesa, 'area', d.area,
        'motivo', d.motivo, 'pedida_en', d.pedida_en,
        'pedida_por', coalesce((select pf.display_name from public.perfiles pf where pf.user_id = d.pedida_por), ''),
        'confirmada_en', d.confirmada_en, 'nota', d.nota_confirmacion,
        'confirmada_por', coalesce((select pf.display_name from public.perfiles pf where pf.user_id = d.confirmada_por), '')
      ) order by d.pedida_en), '[]'::jsonb))
    from public.devoluciones_item d
   where d.empresa_id = p_emp
     and (d.turno_id = p_turno or (d.turno_id is null and d.pedida_en >= p_desde));
$fn$;
revoke all on function private.devoluciones_del_turno(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.devoluciones_de_area(p_area text, p_empresa_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero','cocina','barra']::text[]);
  if coalesce(p_area, '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then raise exception 'Área inválida'; end if;
  perform private.exigir_area(p_area);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'nombre', d.nombre, 'qty', d.qty, 'mesa', d.mesa, 'motivo', d.motivo,
             'pedida_en', d.pedida_en,
             'pedida_por', coalesce((select pf.display_name from public.perfiles pf where pf.user_id = d.pedida_por), ''))
           order by d.pedida_en)
      from public.devoluciones_item d
     where d.empresa_id = v_emp and d.area = p_area and d.confirmada_en is null), '[]'::jsonb);
end $fn$;
revoke all on function public.devoluciones_de_area(text, uuid) from public, anon;
grant execute on function public.devoluciones_de_area(text, uuid) to authenticated;

create or replace function public.confirmar_devolucion(p_id uuid, p_nota text default null, p_empresa_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_d   public.devoluciones_item;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','cocina','barra']::text[]);
  select * into v_d from public.devoluciones_item where id = p_id and empresa_id = v_emp;
  if not found then raise exception 'devolución inexistente en la empresa activa'; end if;
  perform private.exigir_area(v_d.area);
  if v_d.confirmada_en is not null then return; end if;
  update public.devoluciones_item
     set confirmada_por = auth.uid(), confirmada_en = now(),
         nota_confirmacion = left(nullif(btrim(coalesce(p_nota, '')), ''), 300)
   where id = p_id;
  perform private.auditar(v_emp, 'devolucion_confirmada',
    jsonb_build_object('devolucion', p_id::text, 'area', v_d.area, 'nombre', v_d.nombre));
end $fn$;
revoke all on function public.confirmar_devolucion(uuid, text, uuid) from public, anon;
grant execute on function public.confirmar_devolucion(uuid, text, uuid) to authenticated;

-- ## D) AUDITORÍA local: el admin de la empresa ya puede leer su auditoria des

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

-- La salida del turno también queda en la bitácora: sin esto, el hilo de un mesero o un cajero
-- termina sin firma y el arqueo no puede decir quién cerró la sesión. No recibe parámetros:
-- el actor y la empresa se leen de la propia sesión, así nada del cliente se puede falsificar.
create or replace function public.registrar_salida()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    return;
  end if;
  perform private.auditar(private.empresa_activa(), 'salida', '{}'::jsonb);
end $fn$;
revoke all on function public.registrar_salida() from public, anon, authenticated;
grant execute on function public.registrar_salida() to authenticated;

-- ## E) INVENTARIO

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

  begin
    perform private.auditar(v_emp, 'insumo_guardar', jsonb_build_object(
      'insumo', v_out::text, 'nombre', v_nombre, 'unidad', v_unidad,
      'stock', v_stock, 'costo', v_costo, 'edicion', v_id is not null),
      'insumo', v_nombre);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_out;
end $fn$;
revoke all on function public.insumo_guardar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.insumo_guardar(jsonb, uuid) to authenticated;

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
                   else p_cantidad
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

-- ## G) AUDITORÍA LEGIBLE

-- ## 1) Columnas nuevas
alter table public.auditoria add column if not exists actor_nombre text;
alter table public.auditoria add column if not exists actor_rol    text;
alter table public.auditoria add column if not exists entity_type  text;
alter table public.auditoria add column if not exists entity_label text;

-- ## 3) Backfill idempotente de las filas ya existentes

update public.auditoria a
   set actor_nombre = nullif((select pf.display_name from public.perfiles pf
                              where pf.user_id = a.actor), '')
 where a.actor_nombre is null
   and a.actor is not null
   and exists (select 1 from public.perfiles pf where pf.user_id = a.actor);

update public.auditoria a
   set actor_rol = (select m.rol from public.membresias m
                    where m.empresa_id = a.empresa_id and m.user_id = a.actor
                    limit 1)
 where a.actor_rol is null
   and a.actor is not null
   and a.empresa_id is not null
   and exists (select 1 from public.membresias m
               where m.empresa_id = a.empresa_id and m.user_id = a.actor);

-- ## F) SUPER ADMIN FUSIONADO

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

    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email_verified}', 'true'),
           updated_at = now()
     where user_id = v_uid and provider = 'email';
  end if;

  insert into public.supers (user_id) values (v_uid) on conflict (user_id) do nothing;

  if to_regclass('public.auditoria') is not null then

    perform private.auditar(null::uuid, 'super_alta',
      jsonb_build_object('correo', v_email,
                         'cuenta_nueva', v_nuevo,
                         'clave_fijada', (v_nuevo or coalesce(p_reemplazar_clave, false))));
  end if;

  return v_uid;
end $fn$;

revoke all on function public.crear_super(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.crear_super(text, text, text, boolean) to service_role;

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

drop function if exists private.es_super_compat();

alter table public.cuentas add column if not exists etiqueta text;
alter table public.cuentas drop constraint if exists cuentas_etiqueta_chk;
alter table public.cuentas add constraint cuentas_etiqueta_chk check (etiqueta is null or etiqueta ~ '^[a-z]$');

alter table public.productos add column if not exists opciones text[] not null default '{}'::text[];
alter table public.productos drop constraint if exists productos_opciones_chk;
alter table public.productos add constraint productos_opciones_chk
  check (coalesce(array_length(opciones, 1), 0) <= 20);

create or replace function public.dividir_cuenta(
  p_cuenta_id  uuid,
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
  v_n      integer;
  v_max    integer;
  v_nueva  uuid;
begin
  v_emp    := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if v_cuenta.tipo <> 'mesa' then
    raise exception 'solo se puede dividir una cuenta de mesa';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  select count(*), coalesce(max(ascii(c.etiqueta)), 96)
    into v_n, v_max
    from public.cuentas c
   where c.empresa_id = v_emp and c.estado <> 'cerrada'
     and exists (select 1
                   from public.cuenta_mesas a
                   join public.cuenta_mesas b on b.mesa_id = a.mesa_id
                  where a.cuenta_id = v_cuenta.id and b.cuenta_id = c.id);
  if v_n >= 8 then
    raise exception 'una mesa admite como máximo 8 subcuentas';
  end if;

  if v_cuenta.etiqueta is null then
    update public.cuentas set etiqueta = 'a' where id = v_cuenta.id;
    v_max := greatest(v_max, 97);
  end if;

  insert into public.cuentas (empresa_id, tipo, estado, comensales, abierta_por, etiqueta)
  values (v_emp, 'mesa', 'abierta', 1, auth.uid(), chr(v_max + 1))
  returning id into v_nueva;

  insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id)
  select v_emp, v_nueva, cm.mesa_id from public.cuenta_mesas cm where cm.cuenta_id = v_cuenta.id;

  begin
    perform private.auditar(v_emp, 'cuenta_dividida', jsonb_build_object(
      'cuenta', v_cuenta.id::text, 'nueva', v_nueva::text, 'etiqueta', chr(v_max + 1)),
      'cuenta', 'cuenta ' || coalesce(v_cuenta.numero::text, left(v_cuenta.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;

  return v_nueva;
end $fn$;
revoke all on function public.dividir_cuenta(uuid, uuid) from public, anon;
grant execute on function public.dividir_cuenta(uuid, uuid) to authenticated;

-- ############################################################################
-- ## v0.21 · PREMIUM POR DÍAS O INDEFINIDO + HISTORIAL DE CIERRES POR TURNO/DÍA
-- ############################################################################

alter table public.limites add column if not exists premium_hasta timestamptz;

create or replace function private.vencer_planes(p_empresa uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare r record; n integer := 0;
begin
  for r in
    with u as (
      update public.limites l
         set plan = 'gratis', max_productos = d.max_productos, max_miembros = d.max_miembros,
             premium_hasta = null, actualizado_en = now()
        from private.plan_defaults('gratis') d
       where l.plan = 'pago' and l.premium_hasta is not null and l.premium_hasta <= now()
         and (p_empresa is null or l.empresa_id = p_empresa)
      returning l.empresa_id)
    select u.empresa_id from u
  loop
    n := n + 1;
    perform private.auditar(r.empresa_id, 'plan_vencido', '{}'::jsonb);
  end loop;
  return n;
end $fn$;
revoke all on function private.vencer_planes(uuid) from public, anon, authenticated;

drop function if exists public.super_cambiar_plan(uuid, text);
create or replace function public.super_cambiar_plan(p_empresa uuid, p_plan text, p_dias integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prod  integer;
  v_miem  integer;
  v_hasta timestamptz;
  v_base  timestamptz;
  v_plan_actual text;
  v_hasta_actual timestamptz;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if p_plan not in ('gratis', 'pago') then raise exception 'plan inválido (gratis | pago)'; end if;
  if p_empresa is null or not exists (select 1 from public.empresas e where e.id = p_empresa) then
    raise exception 'empresa inexistente';
  end if;
  if p_dias is not null and (p_dias < 1 or p_dias > 3650) then
    raise exception 'los días deben estar entre 1 y 3650 (vacío = indefinido)';
  end if;

  select l.plan, l.premium_hasta into v_plan_actual, v_hasta_actual from public.limites l where l.empresa_id = p_empresa;

  if p_plan = 'pago' and p_dias is not null then

    v_base  := case when v_plan_actual = 'pago' and v_hasta_actual is not null and v_hasta_actual > now()
                    then v_hasta_actual else now() end;
    v_hasta := v_base + make_interval(days => p_dias);
  else
    v_hasta := null;
  end if;

  select d.max_productos, d.max_miembros into v_prod, v_miem from private.plan_defaults(p_plan) d;

  insert into public.limites (empresa_id, plan, max_productos, max_miembros, premium_hasta, actualizado_en, actualizado_por)
  values (p_empresa, p_plan, v_prod, v_miem, v_hasta, now(), auth.uid())
  on conflict (empresa_id) do update
    set plan = excluded.plan,
        max_productos = excluded.max_productos,
        max_miembros  = excluded.max_miembros,
        premium_hasta = excluded.premium_hasta,
        actualizado_en = now(),
        actualizado_por = excluded.actualizado_por;

  perform private.auditar(p_empresa, 'super_cambio_plan',
    jsonb_build_object('plan', p_plan, 'dias', p_dias, 'premium_hasta', v_hasta));
  return jsonb_build_object('plan', p_plan, 'premium_hasta', v_hasta, 'max_productos', v_prod, 'max_miembros', v_miem);
end $fn$;
revoke all on function public.super_cambiar_plan(uuid, text, integer) from public, anon;
grant execute on function public.super_cambiar_plan(uuid, text, integer) to authenticated;

create or replace function public.super_ver_cuota(p_empresa uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  perform private.vencer_planes(p_empresa);
  return jsonb_build_object(
    'plan',               (select l.plan          from public.limites l where l.empresa_id = p_empresa),
    'premium_hasta',      (select l.premium_hasta from public.limites l where l.empresa_id = p_empresa),
    'max_productos',      (select l.max_productos from public.limites l where l.empresa_id = p_empresa),
    'max_miembros',       (select l.max_miembros  from public.limites l where l.empresa_id = p_empresa),
    'notas',              (select l.notas         from public.limites l where l.empresa_id = p_empresa),
    'productos_actuales', (select count(*) from public.productos p where p.empresa_id = p_empresa and p.activo),
    'miembros_actuales',  (select count(*) from public.membresias m where m.empresa_id = p_empresa)
  );
end $fn$;
revoke all on function public.super_ver_cuota(uuid) from public, anon;
grant execute on function public.super_ver_cuota(uuid) to authenticated;

drop function if exists public.super_listar_empresas();
create or replace function public.super_listar_empresas()
returns table (id uuid, nombre text, codigo text, moneda text,
               usuarios bigint, mesas bigint, productos bigint,
               cuentas bigint, creada_en timestamptz,
               plan text, premium_hasta timestamptz)
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
      e.creada_en,
      coalesce(l.plan, 'gratis'),
      l.premium_hasta
    from public.empresas e
    left join public.limites l on l.empresa_id = e.id
    order by e.creada_en;
end $$;
revoke all on function public.super_listar_empresas() from public, anon;
grant execute on function public.super_listar_empresas() to authenticated;

create or replace function public.mi_plan(p_empresa_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v jsonb;
  v_plan text;
  v_premium timestamptz;
  v_retencion integer;
  v_tope_a integer;
  v_tope_p integer;
  v_uso_a bigint;
  v_uso_p bigint;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  perform private.vencer_planes(v_emp);

  select l.plan, l.premium_hasta,
         case when l.plan = 'gratis' then l.retencion_meses end,
         l.max_productos, l.max_miembros
    into v_plan, v_premium, v_retencion, v_tope_a, v_tope_p
    from public.limites l where l.empresa_id = v_emp;
  if not found then
    v_plan := 'gratis'; v_retencion := 6;
    select d.max_productos, d.max_miembros into v_tope_a, v_tope_p
      from private.plan_defaults('gratis') d;
  end if;
  -- Topes y consumo con las mismas consultas que usan los triggers de cuota.
  -- Tope nulo significa «sin límite» (plan Premium), no se sustituye por el de gratis.
  select count(*) into v_uso_a from public.productos where empresa_id = v_emp and activo;
  select count(*) into v_uso_p from public.membresias where empresa_id = v_emp;

  v := jsonb_build_object(
         'plan', v_plan,
         'premium_hasta', v_premium,
         'retencion_meses', v_retencion,
         'tope_articulos', v_tope_a,
         'tope_personas', v_tope_p,
         'uso_articulos', v_uso_a,
         'uso_personas', v_uso_p,
         'es_super', public.es_super());
  return v;
end $fn$;
revoke all on function public.mi_plan(uuid) from public, anon;
grant execute on function public.mi_plan(uuid) to authenticated;

do $do$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('pos-vencer-planes', '5 * * * *', 'select private.vencer_planes()');
exception when others then
  raise notice 'pg_cron no disponible (%): el Premium por días solo vence al abrir la app.', sqlerrm;
end $do$;

create or replace function public.cierres_listar(
  p_desde      timestamptz,
  p_hasta      timestamptz,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_emp uuid; v jsonb; v_ve_todo boolean;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  v_ve_todo := coalesce((select m.rol = 'admin' from public.membresias m
                          where m.user_id = auth.uid() and m.empresa_id = v_emp), true);
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Rango de fechas inválido'; end if;
  if p_hasta - p_desde > interval '400 days' then raise exception 'Rango máximo: 400 días'; end if;

  select coalesce(jsonb_agg(q.x order by q.ab desc), '[]'::jsonb) into v
  from (
    select t.abierto_en as ab,
           jsonb_build_object(
             'id', t.id,
             'abierto_en', t.abierto_en,
             'cerrado_en', t.cerrado_en,
             'abierto_por', coalesce(nullif(pa.display_name, ''), ua.email::text, ''),
             'cerrado_por', coalesce(nullif(pc.display_name, ''), uc.email::text, ''),
             'fondo', t.fondo,
             'esperado', t.esperado,
             'contado', t.contado,
             'diferencia', case when t.contado is not null and t.esperado is not null
                                then round(t.contado - t.esperado, 2) end,
             'cuentas', coalesce(s.cuentas, 0),
             'cobrado', coalesce(s.total, 0),
             'efectivo', coalesce(s.efectivo, 0),
             'qr', coalesce(s.qr, 0),
             'tarjeta', coalesce(s.tarjeta, 0),
             'otros', coalesce(s.otros, 0),
             'ingresos', coalesce(mv.ingresos, 0),
             'egresos', coalesce(mv.egresos, 0),
             'dev_n', coalesce(dv.n, 0),
             'dev_monto', coalesce(dv.monto, 0),
             'dev_sin_confirmar', coalesce(dv.sin, 0)
           ) as x
      from public.turnos_caja t
      left join auth.users ua on ua.id = t.abierto_por
      left join public.perfiles pa on pa.user_id = t.abierto_por
      left join auth.users uc on uc.id = t.cerrado_por
      left join public.perfiles pc on pc.user_id = t.cerrado_por
      left join lateral (
        select count(distinct c.id) as cuentas,
               sum(p.monto) as total,
               sum(p.monto) filter (where p.metodo = 'efectivo') as efectivo,
               sum(p.monto) filter (where p.metodo = 'qr') as qr,
               sum(p.monto) filter (where p.metodo = 'tarjeta') as tarjeta,
               sum(p.monto) filter (where p.metodo not in ('efectivo','qr','tarjeta')) as otros
          from public.cuentas c
          join public.pagos p on p.cuenta_id = c.id
         where c.empresa_id = v_emp and c.estado = 'cerrada'
           and c.cerrada_en >= t.abierto_en and c.cerrada_en <= coalesce(t.cerrado_en, now())
           and (t.modo <> 'por_cajero' or p.creada_por = t.abierto_por)
      ) s on true
      left join lateral (
        select sum(coalesce(nullif(m->>'monto', '')::numeric, 0)) filter (where m->>'tipo' = 'ingreso') as ingresos,
               sum(coalesce(nullif(m->>'monto', '')::numeric, 0)) filter (where m->>'tipo' = 'egreso') as egresos
          from jsonb_array_elements(coalesce(t.movimientos->'movimientos', '[]'::jsonb)) m
      ) mv on true
      left join lateral (
        select count(*) as n, sum(d.monto) as monto, count(*) filter (where d.confirmada_en is null) as sin
          from public.devoluciones_item d
         where d.empresa_id = v_emp and d.turno_id = t.id
      ) dv on true
     where t.empresa_id = v_emp
       and t.abierto_en <= p_hasta
       and coalesce(t.cerrado_en, now()) >= p_desde
       and (v_ve_todo or t.modo <> 'por_cajero' or t.abierto_por = auth.uid())
     order by t.abierto_en desc
     limit 500
  ) q;
  return v;
end $fn$;
revoke all on function public.cierres_listar(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.cierres_listar(timestamptz, timestamptz, uuid) to authenticated;

-- ############################################################################
-- ## v0.22 · MODO DE CAJA POR EMPRESA (empresas.config.cajaModo)

-- ############################################################################
alter table public.turnos_caja add column if not exists modo text not null default 'compartida';
alter table public.turnos_caja drop constraint if exists turnos_modo_chk;
alter table public.turnos_caja add constraint turnos_modo_chk check (modo in ('compartida','por_cajero'));

create or replace function private.caja_modo(p_emp uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case when e.config->>'cajaModo' = 'por_cajero' then 'por_cajero' else 'compartida' end
    from public.empresas e where e.id = p_emp
$f$;
revoke all on function private.caja_modo(uuid) from public, anon, authenticated;

create or replace function private.turno_actual(p_emp uuid, p_turno_id uuid default null)
returns public.turnos_caja
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v public.turnos_caja;
begin
  if p_turno_id is not null then
    select * into v from public.turnos_caja t
     where t.empresa_id = p_emp and t.cerrado_en is null and t.id = p_turno_id;
    return v;
  end if;
  if private.caja_modo(p_emp) = 'por_cajero' then
    select * into v from public.turnos_caja t
     where t.empresa_id = p_emp and t.cerrado_en is null and t.modo = 'por_cajero' and t.abierto_por = auth.uid()
     order by t.abierto_en desc limit 1;
    if v.id is not null then return v; end if;
  end if;
  select * into v from public.turnos_caja t
   where t.empresa_id = p_emp and t.cerrado_en is null and t.modo = 'compartida'
   order by t.abierto_en desc limit 1;
  return v;
end $fn$;
revoke all on function private.turno_actual(uuid, uuid) from public, anon, authenticated;

alter table public.cuentas add column if not exists detalle text;
alter table public.cuentas drop constraint if exists cuentas_detalle_largo;
alter table public.cuentas add constraint cuentas_detalle_largo check (detalle is null or length(detalle) <= 500);

create or replace function public.poner_detalle_cuenta(
  p_cuenta_id  uuid,
  p_detalle    text,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  c     public.cuentas;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  c := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  update public.cuentas
     set detalle = left(nullif(btrim(coalesce(p_detalle, '')), ''), 500)
   where id = p_cuenta_id and empresa_id = v_emp;
  begin
    perform private.auditar(v_emp, 'cuenta_detalle', jsonb_build_object(
      'cuenta', c.id::text, 'detalle', left(coalesce(nullif(btrim(coalesce(p_detalle, '')), ''), ''), 120)),
      'cuenta', 'cuenta ' || coalesce(c.numero::text, left(c.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;
revoke all on function public.poner_detalle_cuenta(uuid, text, uuid) from public, anon;
grant execute on function public.poner_detalle_cuenta(uuid, text, uuid) to authenticated;

create index if not exists cuenta_items_producto_idx on public.cuenta_items (producto_id);
create index if not exists recetas_insumo_idx on public.recetas (insumo_id);
create index if not exists insumos_mov_insumo_idx on public.insumos_movimientos (insumo_id, en desc);
create index if not exists devoluciones_item_cuenta_idx on public.devoluciones_item (cuenta_id);
create index if not exists devoluciones_item_item_idx on public.devoluciones_item (item_id);
create index if not exists eau_empresa_idx on public.empresa_activa_usuario (empresa_id);


-- ############################################################################
-- ## v0.25 · NÚMERO DE ÍTEM DE PRODUCTO (consecutivo por negocio, nunca se reutiliza)
-- ############################################################################
alter table public.productos add column if not exists numero integer;
alter table public.empresas  add column if not exists contador_productos integer not null default 0;

-- Numera los que aún no tienen (por orden de creación) y deja el contador al día.
with n as (
  select p.id,
         row_number() over (partition by p.empresa_id order by p.creada_en, p.id)
           + coalesce((select max(x.numero) from public.productos x where x.empresa_id = p.empresa_id), 0) as rn
    from public.productos p
   where p.numero is null)
update public.productos p set numero = n.rn from n where n.id = p.id;
update public.empresas e
   set contador_productos = greatest(e.contador_productos,
                                     coalesce((select max(p.numero) from public.productos p where p.empresa_id = e.id), 0));
create unique index if not exists productos_numero_uq on public.productos (empresa_id, numero);

create or replace function private.productos_numerar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.numero is null then
    update public.empresas set contador_productos = contador_productos + 1
     where id = new.empresa_id
    returning contador_productos into new.numero;
  end if;
  return new;
end $fn$;
revoke all on function private.productos_numerar() from public, anon, authenticated;
drop trigger if exists productos_numerar on public.productos;
create trigger productos_numerar before insert on public.productos
  for each row execute function private.productos_numerar();

-- ############################################################################
-- ## v0.30 · PARA LLEVAR (Salón) + EXPORTACIÓN COMPLETA (inventario, devoluciones, fotos)
-- ############################################################################

-- ## A) PARA LLEVAR: cuenta tipo 'directa' con canal 'llevar', cliente y número propio por día
alter table public.cuentas add column if not exists canal text;
alter table public.cuentas drop constraint if exists cuentas_canal_chk;
alter table public.cuentas add constraint cuentas_canal_chk check (canal is null or canal = 'llevar');
alter table public.cuentas add column if not exists cliente_nombre text;
alter table public.cuentas add column if not exists cliente_tel text;
alter table public.cuentas drop constraint if exists cuentas_cliente_largo;
alter table public.cuentas add constraint cuentas_cliente_largo check (
  (cliente_nombre is null or length(cliente_nombre) <= 80) and (cliente_tel is null or length(cliente_tel) <= 40));
create index if not exists idx_cuentas_llevar on public.cuentas (empresa_id, abierta_en desc) where canal = 'llevar';

create or replace function public.abrir_para_llevar(
  p_nombre     text,
  p_telefono   text default null,
  p_empresa_id uuid default null
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
  v_nom text := left(btrim(coalesce(p_nombre, '')), 80);
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  -- El nombre del cliente es OPCIONAL: el pedido para llevar se abre primero y el nombre se
  -- escribe después (o nunca, si el cliente no lo da). Sin nombre se ve «Pedido N».

  perform pg_advisory_xact_lock(hashtextextended('llevar:' || v_emp::text || ':' || to_char(now(), 'YYYY-MM-DD'), 0));
  select coalesce(max(c.numero), 0) + 1 into v_num
    from public.cuentas c
   where c.empresa_id = v_emp and c.tipo = 'directa' and c.canal = 'llevar'
     and c.abierta_en::date = current_date;

  insert into public.cuentas (empresa_id, tipo, canal, numero, estado, abierta_por, cliente_nombre, cliente_tel)
  values (v_emp, 'directa', 'llevar', v_num, 'abierta', auth.uid(), nullif(v_nom, ''),
          left(nullif(btrim(coalesce(p_telefono, '')), ''), 40))
  returning id into v_id;
  begin
    perform private.auditar(v_emp, 'cuenta_abierta', jsonb_build_object(
      'cuenta', v_id::text, 'numero', v_num, 'canal', 'llevar', 'cliente', nullif(v_nom, '')),
      'cuenta', 'Para llevar ' || v_num);
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
  return v_id;
end $fn$;
revoke all on function public.abrir_para_llevar(text, text, uuid) from public, anon;
grant execute on function public.abrir_para_llevar(text, text, uuid) to authenticated;

create or replace function public.editar_cliente_llevar(
  p_cuenta_id  uuid,
  p_nombre     text,
  p_telefono   text default null,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  c     public.cuentas;
  v_nom text := left(btrim(coalesce(p_nombre, '')), 80);
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  c := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if c.canal is distinct from 'llevar' then raise exception 'la cuenta no es para llevar'; end if;
  update public.cuentas
     set cliente_nombre = nullif(v_nom, ''),
         cliente_tel    = left(nullif(btrim(coalesce(p_telefono, '')), ''), 40)
   where id = p_cuenta_id and empresa_id = v_emp;
  begin
    perform private.auditar(v_emp, 'llevar_edicion', jsonb_build_object(
      'cuenta', c.id::text, 'cliente', nullif(v_nom, ''),
      'telefono', nullif(left(btrim(coalesce(p_telefono, '')), 40), '')),
      'cuenta', 'Para llevar ' || coalesce(c.numero::text, left(c.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;
revoke all on function public.editar_cliente_llevar(uuid, text, text, uuid) from public, anon;
grant execute on function public.editar_cliente_llevar(uuid, text, text, uuid) to authenticated;

-- Si el cliente cambia de opinión: la cuenta (con sus ítems y lo ya enviado a cocina) pasa a una mesa libre.
create or replace function public.pasar_llevar_a_mesa(
  p_cuenta_id  uuid,
  p_mesa_id    uuid,
  p_comensales integer default 1,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  c     public.cuentas;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  c := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if c.canal is distinct from 'llevar' then raise exception 'la cuenta no es para llevar'; end if;
  if not exists (select 1 from public.mesas m where m.id = p_mesa_id and m.empresa_id = v_emp and m.activa) then
    raise exception 'mesa inexistente o inactiva';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mesa:' || p_mesa_id::text, 0));
  if exists (select 1 from public.cuentas x join public.cuenta_mesas cm on cm.cuenta_id = x.id
              where cm.mesa_id = p_mesa_id and x.empresa_id = v_emp and x.estado <> 'cerrada') then
    raise exception 'la mesa ya tiene una cuenta abierta';
  end if;
  insert into public.cuenta_mesas (empresa_id, cuenta_id, mesa_id) values (v_emp, p_cuenta_id, p_mesa_id);
  update public.cuentas
     set tipo = 'mesa', canal = null, numero = null,
         comensales = least(99, greatest(coalesce(p_comensales, 1), 1))
   where id = p_cuenta_id and empresa_id = v_emp;
  perform private.auditar(v_emp, 'llevar_a_mesa', jsonb_build_object('cuenta', p_cuenta_id::text, 'mesa', p_mesa_id::text, 'cliente', c.cliente_nombre));
end $fn$;
revoke all on function public.pasar_llevar_a_mesa(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.pasar_llevar_a_mesa(uuid, uuid, integer, uuid) to authenticated;

-- ## B) EXPORTACIÓN COMPLETA (versión 3): se añaden inventario, recetas, movimientos, devoluciones y áreas listas
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
  v := private.snapshot_empresa(p_empresa);
  if v->'empresa' is null or v->'empresa' = 'null'::jsonb then raise exception 'empresa inexistente'; end if;
  return v;
end $fn$;
revoke all on function public.super_exportar_empresa(uuid) from public, anon;
grant execute on function public.super_exportar_empresa(uuid) to authenticated;

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
  v := private.snapshot_empresa(v_emp);
  perform private.auditar(v_emp, 'exportar_datos', '{}'::jsonb);
  return v;
end $fn$;
revoke all on function public.exportar_mi_empresa(uuid) from public, anon;
grant execute on function public.exportar_mi_empresa(uuid) to authenticated;

-- ## C) IMPORTACIÓN COMPLETA: ahora devuelve jsonb {empresa_id, fotos:[{bucket,de,a}]} para que la app suba las fotos del .zip
drop function if exists public.super_importar_empresa(jsonb, text, text);
drop function if exists public.super_importar_empresa(jsonb, text, text, boolean);
-- ############################################################################
-- ## v0.31 · COSTO Y MARGEN POR PRODUCTO, PROVEEDORES CON CUENTAS POR PAGAR,
-- ##          PEDIDO (etapas visibles, sin bloquear el cobro), ALERTAS, REPORTES Y QR DEL NEGOCIO
-- ############################################################################

-- ## A) PROVEEDORES: antes eran solo texto suelto en una nota de inventario.
create table if not exists public.proveedores (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  telefono   text not null default '',
  email      text not null default '',
  direccion  text not null default '',
  nota       text not null default '',
  activo     boolean not null default true,
  creada_en  timestamptz not null default now()
);
create index if not exists proveedores_empresa_idx on public.proveedores (empresa_id);
create unique index if not exists proveedores_empresa_nombre_ux on public.proveedores (empresa_id, lower(nombre));

alter table public.proveedores enable row level security;
alter table public.proveedores force row level security;
drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores for select to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
-- Nadie escribe la tabla a mano: todo pasa por las RPCs, que además auditan.
revoke all on public.proveedores from public, anon, authenticated;
grant select on public.proveedores to authenticated;

create or replace function public.proveedor_guardar(
  p_proveedor  jsonb,
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
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  if p_proveedor is null or jsonb_typeof(p_proveedor) <> 'object' then
    raise exception 'Los datos del proveedor son inválidos';
  end if;
  v_id     := nullif(p_proveedor->>'id', '')::uuid;
  v_nombre := trim(coalesce(p_proveedor->>'nombre', ''));
  if v_nombre = '' then
    raise exception 'El nombre del proveedor es obligatorio';
  end if;

  if v_id is not null then
    begin
      update public.proveedores
         set nombre = v_nombre,
             telefono = left(trim(coalesce(p_proveedor->>'telefono','')), 40),
             email = left(lower(trim(coalesce(p_proveedor->>'email',''))), 120),
             direccion = left(trim(coalesce(p_proveedor->>'direccion','')), 160),
             nota = left(trim(coalesce(p_proveedor->>'nota','')), 240),
             activo = coalesce((p_proveedor->>'activo')::boolean, true)
       where id = v_id and empresa_id = v_emp
      returning id into v_out;
    exception when unique_violation then
      raise exception 'Ya existe otro proveedor con ese nombre';
    end;
    if v_out is null then
      raise exception 'El proveedor no existe en la empresa activa';
    end if;
  else
    insert into public.proveedores (empresa_id, nombre, telefono, email, direccion, nota, activo)
    values (v_emp, v_nombre,
            left(trim(coalesce(p_proveedor->>'telefono','')), 40),
            left(lower(trim(coalesce(p_proveedor->>'email',''))), 120),
            left(trim(coalesce(p_proveedor->>'direccion','')), 160),
            left(trim(coalesce(p_proveedor->>'nota','')), 240),
            coalesce((p_proveedor->>'activo')::boolean, true))
    on conflict (empresa_id, lower(nombre)) do update
       set telefono = excluded.telefono,
           email = excluded.email,
           direccion = excluded.direccion,
           nota = excluded.nota,
           activo = excluded.activo
    returning id into v_out;
  end if;

  perform private.auditar(v_emp, 'proveedor_guardo',
    jsonb_build_object('id', v_out::text, 'nombre', v_nombre));
  return v_out;
end $fn$;
revoke all on function public.proveedor_guardar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.proveedor_guardar(jsonb, uuid) to authenticated;

-- Borrar solo si no debe nada: si tiene saldo, se desactiva (histórico intacto).
create or replace function public.proveedor_borrar(
  p_proveedor_id uuid,
  p_empresa_id   uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_saldo numeric;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);

  select coalesce(sum(c.monto - c.pagado), 0) into v_saldo
    from public.cuentas_por_pagar c
   where c.proveedor_id = p_proveedor_id and c.empresa_id = v_emp;
  if v_saldo > 0 then
    update public.proveedores set activo = false
     where id = p_proveedor_id and empresa_id = v_emp;
    perform private.auditar(v_emp, 'proveedor_desactivo',
      jsonb_build_object('id', p_proveedor_id::text, 'saldo', v_saldo));
    return 'desactivado';
  end if;

  delete from public.proveedores where id = p_proveedor_id and empresa_id = v_emp;
  if not found then
    raise exception 'El proveedor no existe en la empresa activa';
  end if;
  perform private.auditar(v_emp, 'proveedor_borro', jsonb_build_object('id', p_proveedor_id::text));
  return 'borrado';
end $fn$;
revoke all on function public.proveedor_borrar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.proveedor_borrar(uuid, uuid) to authenticated;

-- ## B) COSTO Y PROVEEDOR POR PRODUCTO
-- Va en tabla aparte (no en productos) porque productos lo leen todos los roles
-- para tomar pedido: aquí el costo solo lo ve el admin, por RLS.
create table if not exists public.costos_producto (
  producto_id     uuid primary key references public.productos(id) on delete cascade,
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  costo           numeric(12,2) not null default 0 check (costo >= 0),
  proveedor_id    uuid references public.proveedores(id) on delete set null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);
create index if not exists costos_producto_empresa_idx on public.costos_producto (empresa_id);
create index if not exists costos_producto_proveedor_idx on public.costos_producto (proveedor_id);

alter table public.costos_producto enable row level security;
alter table public.costos_producto force row level security;
drop policy if exists costos_producto_select on public.costos_producto;
create policy costos_producto_select on public.costos_producto for select to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
revoke all on public.costos_producto from public, anon, authenticated;
grant select on public.costos_producto to authenticated;

create or replace function public.costo_guardar(
  p_producto_id  uuid,
  p_costo        numeric,
  p_proveedor_id uuid default null,
  p_empresa_id   uuid default null
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
  perform private.exigir_rol(array['admin']::text[]);
  if not exists (select 1 from public.productos p where p.id = p_producto_id and p.empresa_id = v_emp) then
    raise exception 'El producto no existe en la empresa activa';
  end if;
  if coalesce(p_costo, 0) < 0 then
    raise exception 'el costo no puede ser negativo';
  end if;

  insert into public.costos_producto (producto_id, empresa_id, costo, proveedor_id, actualizado_por)
  values (p_producto_id, v_emp, round(p_costo, 2), p_proveedor_id, auth.uid())
  on conflict (producto_id) do update
     set costo = excluded.costo,
         proveedor_id = excluded.proveedor_id,
         actualizado_en = now(),
         actualizado_por = excluded.actualizado_por;
  begin
    perform private.auditar(v_emp, 'costo_guardado', jsonb_build_object(
      'costo', round(p_costo, 2),
      'proveedor', (select pr.nombre from public.proveedores pr where pr.id = p_proveedor_id)),
      'producto', (select p.nombre from public.productos p where p.id = p_producto_id));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;
revoke all on function public.costo_guardar(uuid, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.costo_guardar(uuid, numeric, uuid, uuid) to authenticated;

-- Margen aplicado en masa: margen % sobre el precio (utilidad / precio), no markup.
-- precio = costo / (1 - margen/100). Con p_aplicar=false solo hace la simulación.
create or replace function public.costos_margen_aplicar(
  p_margen_pct   numeric,
  p_producto_ids uuid[]   default null,
  p_aplicar      boolean  default false,
  p_empresa_id   uuid     default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_lista uuid[];
  v_n     integer := 0;
  v_muestra jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);
  if p_margen_pct is null or p_margen_pct <= 0 or p_margen_pct >= 100 then
    raise exception 'El margen debe estar entre 1 y 99 %%';
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[]) into v_lista
    from public.productos p
    join public.costos_producto c on c.producto_id = p.id
   where p.empresa_id = v_emp
     and c.costo > 0
     and p.precio > 0
     and (p_producto_ids is null or cardinality(p_producto_ids) = 0 or p.id = any (p_producto_ids));

  v_n := coalesce(array_length(v_lista, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('sin_costo', true, 'afectados', 0, 'muestra', '[]'::jsonb);
  end if;

  if p_aplicar then
    -- Reajuste en lote: la fila 'margen_aplicado' de abajo resume los N precios, el trigger
    -- no debe escribir una por producto.
    perform set_config('pos.sin_bitacora', 'on', true);
    update public.productos p
       set precio = round((select c.costo from public.costos_producto c where c.producto_id = p.id)
                          / (1 - p_margen_pct / 100), 2)
     where p.id = any (v_lista) and p.empresa_id = v_emp;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', x.id, 'nombre', x.nombre, 'costo', x.costo,
           'antes', x.antes, 'despues', x.despues) order by x.costo desc), '[]'::jsonb)
    into v_muestra
    from (select p.id, p.nombre, c.costo, p.precio as antes,
                 round(c.costo / (1 - p_margen_pct / 100), 2) as despues
            from public.productos p
            join public.costos_producto c on c.producto_id = p.id
           where p.id = any (v_lista)
           order by c.costo desc limit 30) x;

  if p_aplicar then
    perform private.auditar(v_emp, 'margen_aplicado',
      jsonb_build_object('margen_pct', p_margen_pct, 'productos', v_n));
  end if;
  return jsonb_build_object('sin_costo', false, 'afectados', v_n,
                            'margen_pct', p_margen_pct, 'aplico', p_aplicar, 'muestra', v_muestra);
end $fn$;
revoke all on function public.costos_margen_aplicar(numeric, uuid[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.costos_margen_aplicar(numeric, uuid[], boolean, uuid) to authenticated;

-- Costo en masa como % del precio de venta («¿qué porcentaje del precio será el costo?», p. ej. 40 = 40 %).
-- Por defecto solo toca los platos que aún NO tienen costo; con p_reemplazar = true pisa también los que ya lo tienen.
-- Conserva el proveedor que ya tuviera cada plato.
create or replace function public.costos_pct_aplicar(
  p_pct          numeric,
  p_producto_ids uuid[]   default null,
  p_reemplazar   boolean  default false,
  p_empresa_id   uuid     default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_n   integer := 0;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);
  if p_pct is null or p_pct <= 0 or p_pct > 100 then
    raise exception 'El porcentaje del costo debe estar entre 1 y 100';
  end if;

  with objetivo as (
    select p.id, round(p.precio * p_pct / 100, 2) as costo
      from public.productos p
      left join public.costos_producto c on c.producto_id = p.id
     where p.empresa_id = v_emp
       and p.precio > 0
       and (p_producto_ids is null or cardinality(p_producto_ids) = 0 or p.id = any (p_producto_ids))
       and (p_reemplazar or c.producto_id is null or c.costo = 0)
  ), aplicado as (
    insert into public.costos_producto (producto_id, empresa_id, costo, actualizado_por)
    select o.id, v_emp, o.costo, auth.uid() from objetivo o
    on conflict (producto_id) do update
       set costo = excluded.costo, actualizado_en = now(), actualizado_por = excluded.actualizado_por
    returning producto_id
  )
  select count(*) into v_n from aplicado;

  perform private.auditar(v_emp, 'costo_pct_aplicado',
    jsonb_build_object('pct', p_pct, 'productos', v_n, 'reemplazar', p_reemplazar));
  return jsonb_build_object('afectados', v_n, 'pct', p_pct);
end $fn$;
revoke all on function public.costos_pct_aplicar(numeric, uuid[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.costos_pct_aplicar(numeric, uuid[], boolean, uuid) to authenticated;

-- Costo teórico del plato a partir de su receta (insumo.costo x receta.cantidad).
create or replace function public.costos_desde_receta(
  p_producto_ids uuid[] default null,
  p_aplicar      boolean default true,
  p_empresa_id   uuid default null
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
  perform private.exigir_rol(array['admin']::text[]);

  with calculado as (
    select p.id as producto_id, p.nombre,
           round(sum(coalesce(i.costo, 0) * r.cantidad), 2) as costo
      from public.productos p
      join public.recetas r on r.producto_id = p.id
      join public.insumos i on i.id = r.insumo_id
     where p.empresa_id = v_emp
       and (p_producto_ids is null or cardinality(p_producto_ids) = 0 or p.id = any (p_producto_ids))
     group by p.id, p.nombre
     having round(sum(coalesce(i.costo, 0) * r.cantidad), 2) > 0
  ), aplicado as (
    insert into public.costos_producto (producto_id, empresa_id, costo, actualizado_por)
    select c.producto_id, v_emp, c.costo, auth.uid() from calculado c
     where p_aplicar
    on conflict (producto_id) do update
       set costo = excluded.costo, actualizado_en = now(), actualizado_por = excluded.actualizado_por
    returning producto_id
  )
  select jsonb_build_object(
    'aplico', p_aplicar,
    'total', (select count(*) from calculado),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('producto_id', c.producto_id, 'nombre', c.nombre,
                                                            'costo', c.costo) order by c.costo desc)
                         from (select producto_id, nombre, costo from calculado
                                order by costo desc limit 30) c), '[]'::jsonb)
  ) into v_out;

  if p_aplicar then
    perform private.auditar(v_emp, 'costo_desde_receta',
      jsonb_build_object('productos', coalesce((select count(*) from public.recetas r
                                                  join public.productos p on p.id = r.producto_id
                                                 where p.empresa_id = v_emp), 0)));
  end if;
  return v_out;
end $fn$;
revoke all on function public.costos_desde_receta(uuid[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.costos_desde_receta(uuid[], boolean, uuid) to authenticated;

-- ## C) CUENTAS POR PAGAR A PROVEEDORES (lo que el negocio debe, con sus abonos)
create table if not exists public.cuentas_por_pagar (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  fecha        date not null default current_date,
  vencimiento  date,
  concepto     text not null check (length(trim(concepto)) between 1 and 120),
  monto        numeric(12,2) not null check (monto > 0),
  pagado       numeric(12,2) not null default 0 check (pagado >= 0),
  nota         text not null default '',
  creada_por   uuid references auth.users(id),
  creada_en    timestamptz not null default now(),
  pagada_en    timestamptz,
  constraint cuentas_por_pagar_tope_chk check (pagado <= monto + 0.01)
);
create index if not exists cpp_empresa_idx on public.cuentas_por_pagar (empresa_id, fecha desc);
create index if not exists cpp_proveedor_idx on public.cuentas_por_pagar (proveedor_id);
create index if not exists cpp_abierta_idx on public.cuentas_por_pagar (empresa_id) where pagado < monto;

alter table public.cuentas_por_pagar enable row level security;
alter table public.cuentas_por_pagar force row level security;
drop policy if exists cpp_select on public.cuentas_por_pagar;
create policy cpp_select on public.cuentas_por_pagar for select to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));
revoke all on public.cuentas_por_pagar from public, anon, authenticated;
grant select on public.cuentas_por_pagar to authenticated;

create or replace function public.cpp_guardar(
  p_deuda      jsonb,
  p_empresa_id uuid default null
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
  perform private.exigir_rol(array['admin']::text[]);

  if p_deuda is null or jsonb_typeof(p_deuda) <> 'object' then
    raise exception 'Los datos de la deuda son inválidos';
  end if;
  if nullif(p_deuda->>'proveedor_id','') is null or not exists (
       select 1 from public.proveedores pr
        where pr.id = (p_deuda->>'proveedor_id')::uuid and pr.empresa_id = v_emp) then
    raise exception 'Falta elegir un proveedor';
  end if;
  if trim(coalesce(p_deuda->>'concepto','')) = '' then
    raise exception 'El concepto es obligatorio';
  end if;
  if coalesce((p_deuda->>'monto')::numeric, 0) <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;

  v_id := nullif(p_deuda->>'id','')::uuid;
  if v_id is null then
    insert into public.cuentas_por_pagar (empresa_id, proveedor_id, fecha, vencimiento, concepto, monto, nota, creada_por)
    values (v_emp, (p_deuda->>'proveedor_id')::uuid,
            coalesce((p_deuda->>'fecha')::date, current_date),
            nullif(p_deuda->>'vencimiento','')::date,
            left(trim(p_deuda->>'concepto'), 120),
            round((p_deuda->>'monto')::numeric, 2),
            left(trim(coalesce(p_deuda->>'nota','')), 240),
            auth.uid())
    returning id into v_id;
    perform private.auditar(v_emp, 'deuda_alta',
      jsonb_build_object('id', v_id::text, 'monto', round((p_deuda->>'monto')::numeric, 2)));
  else
    update public.cuentas_por_pagar
       set proveedor_id = (p_deuda->>'proveedor_id')::uuid,
           fecha = coalesce((p_deuda->>'fecha')::date, fecha),
           vencimiento = nullif(p_deuda->>'vencimiento','')::date,
           concepto = left(trim(p_deuda->>'concepto'), 120),
           monto = round((p_deuda->>'monto')::numeric, 2),
           nota = left(trim(coalesce(p_deuda->>'nota','')), 240),
           pagada_en = case when pagado >= round((p_deuda->>'monto')::numeric, 2) then coalesce(pagada_en, now()) else null end
     where id = v_id and empresa_id = v_emp
       and pagado <= round((p_deuda->>'monto')::numeric, 2);
    if not found then
      raise exception 'La deuda no existe o el nuevo monto es menor a lo ya abonado';
    end if;
    perform private.auditar(v_emp, 'deuda_edicion', jsonb_build_object('id', v_id::text));
  end if;
  return v_id;
end $fn$;
revoke all on function public.cpp_guardar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.cpp_guardar(jsonb, uuid) to authenticated;

create or replace function public.cpp_abonar(
  p_deuda_id   uuid,
  p_monto      numeric,
  p_nota       text default null,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_saldo numeric;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  select round(monto - pagado, 2) into v_saldo
    from public.cuentas_por_pagar
   where id = p_deuda_id and empresa_id = v_emp
   for update;
  if v_saldo is null then
    raise exception 'La deuda no existe en la empresa activa';
  end if;
  if coalesce(p_monto, 0) <= 0 then
    raise exception 'El abono debe ser mayor que cero';
  end if;
  if p_monto > v_saldo + 0.01 then
    raise exception 'El abono (% Bs) pasa el saldo pendiente (% Bs)', p_monto, v_saldo;
  end if;

  update public.cuentas_por_pagar
     set pagado = round(pagado + p_monto, 2),
         nota = case when nullif(trim(coalesce(p_nota,'')),'') is null then nota
                     else left(trim(nota || case when nota = '' then '' else ' · ' end) || p_nota, 240) end,
         pagada_en = case when round(pagado + p_monto, 2) >= monto then now() else pagada_en end
   where id = p_deuda_id and empresa_id = v_emp;

  select round(monto - pagado, 2) into v_saldo
    from public.cuentas_por_pagar where id = p_deuda_id and empresa_id = v_emp;
  perform private.auditar(v_emp, 'deuda_abono',
    jsonb_build_object('id', p_deuda_id::text, 'monto', round(p_monto, 2), 'saldo', v_saldo));
  return jsonb_build_object('saldo', v_saldo, 'abono', round(p_monto, 2));
end $fn$;
revoke all on function public.cpp_abonar(uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.cpp_abonar(uuid, numeric, text, uuid) to authenticated;

create or replace function public.cpp_borrar(
  p_deuda_id   uuid,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_pagado numeric;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);
  select pagado into v_pagado from public.cuentas_por_pagar where id = p_deuda_id and empresa_id = v_emp;
  if v_pagado is null then
    raise exception 'La deuda no existe en la empresa activa';
  end if;
  if v_pagado > 0 then
    raise exception 'La deuda ya tiene abonos: no se puede borrar';
  end if;
  delete from public.cuentas_por_pagar where id = p_deuda_id and empresa_id = v_emp;
  perform private.auditar(v_emp, 'deuda_borra', jsonb_build_object('id', p_deuda_id::text));
end $fn$;
revoke all on function public.cpp_borrar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cpp_borrar(uuid, uuid) to authenticated;

-- ## D) PEDIDO LISTO: marca en qué paso va la cuenta (Prep · Parcial · Listo). Es informativo:
--         cobrar no depende de esto, se puede cerrar la cuenta con platos aún en cocina.
create or replace function public.marcar_pedido_listo(
  p_cuenta_id  uuid,
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
  v_n integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  insert into public.cuenta_item_areas (item_id, empresa_id, area, listo_en, listo_por)
  select i.id, v_emp, a.area, now(), auth.uid()
    from public.cuenta_items i
    cross join lateral unnest(coalesce(nullif(i.areas, '{}'::text[]), array['cocina']::text[])) as a(area)
   where i.cuenta_id = v_cuenta.id and i.empresa_id = v_emp and i.estado = 'enviado'
  on conflict (item_id, area) do nothing;

  update public.cuenta_items
     set estado = 'listo',
         listo_en = now(),
         areas_listas = coalesce(nullif(areas, '{}'::text[]), array['cocina']::text[])
   where cuenta_id = v_cuenta.id and empresa_id = v_emp and estado = 'enviado';
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform private.auditar(v_emp, 'pedido_listo',
      jsonb_build_object('cuenta', v_cuenta.id::text, 'items', v_n));
  end if;
  return v_n;
end $fn$;
revoke all on function public.marcar_pedido_listo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.marcar_pedido_listo(uuid, uuid) to authenticated;

-- Deshacer: vuelve los ítems listos de la cuenta a 'enviado' (por si se marcó por error).
create or replace function public.deshacer_pedido_listo(
  p_cuenta_id  uuid,
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
  v_n integer;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  v_cuenta := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);

  perform pg_advisory_xact_lock(hashtextextended('cuenta:' || v_cuenta.id::text, 0));

  delete from public.cuenta_item_areas ca
   using public.cuenta_items i
   where ca.item_id = i.id and i.cuenta_id = v_cuenta.id and i.empresa_id = v_emp
     and i.estado = 'listo';

  update public.cuenta_items
     set estado = 'enviado', listo_en = null, areas_listas = '{}'::text[]
   where cuenta_id = v_cuenta.id and empresa_id = v_emp and estado = 'listo';
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform private.auditar(v_emp, 'pedido_deshace_listo',
      jsonb_build_object('cuenta', v_cuenta.id::text, 'items', v_n));
  end if;
  return v_n;
end $fn$;
revoke all on function public.deshacer_pedido_listo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.deshacer_pedido_listo(uuid, uuid) to authenticated;

-- ## E) ALERTAS: bandeja común del negocio, atada a la mesa/cuenta que haga falta
create table if not exists public.alertas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  tipo          text not null default 'general'
                check (tipo in ('general','cocina','cobro','inventario','mesa')),
  titulo        text not null check (length(trim(titulo)) between 1 and 80),
  mensaje       text not null default '' check (length(mensaje) <= 240),
  cuenta_id     uuid references public.cuentas(id) on delete cascade,
  mesa_id       uuid references public.mesas(id) on delete set null,
  prioridad     smallint not null default 5 check (prioridad between 1 and 9),
  creada_por    uuid references auth.users(id),
  creada_en     timestamptz not null default now(),
  resuelta_por  uuid references auth.users(id),
  resuelta_en   timestamptz
);
create index if not exists alertas_empresa_en_idx on public.alertas (empresa_id, creada_en desc);
create index if not exists alertas_abiertas_idx on public.alertas (empresa_id) where resuelta_en is null;

alter table public.alertas enable row level security;
alter table public.alertas force row level security;
drop policy if exists alertas_select on public.alertas;
create policy alertas_select on public.alertas for select to authenticated
  using (empresa_id = (select private.empresa_activa()));
-- Todo el equipo levanta alertas; nadie las borra (queda el rastro).
drop policy if exists alertas_insert on public.alertas;
create policy alertas_insert on public.alertas for insert to authenticated
  with check (empresa_id = (select private.empresa_activa())
              and resuelta_en is null
              and (select private.es_miembro_de(empresa_id)));
drop policy if exists alertas_update on public.alertas;
create policy alertas_update on public.alertas for update to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_miembro_de(empresa_id)))
  with check (empresa_id = (select private.empresa_activa()));
drop policy if exists alertas_delete on public.alertas;
create policy alertas_delete on public.alertas for delete to authenticated
  using (empresa_id = (select private.empresa_activa()) and (select private.es_admin()));

revoke all on public.alertas from public, anon;
revoke truncate on public.alertas from authenticated;
grant select, insert, update, delete on public.alertas to authenticated;

-- Quien resuelve queda registrado aunque el navegador no mande el usuario.
create or replace function private.alertas_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.resuelta_en is not null and old.resuelta_en is null and new.resuelta_por is null then
    new.resuelta_por := auth.uid();
  end if;
  if new.resuelta_en is null and old.resuelta_en is not null then
    new.resuelta_por := null;
  end if;
  return new;
end $fn$;
revoke all on function private.alertas_stamp() from public, anon, authenticated;
drop trigger if exists alertas_stamp on public.alertas;
create trigger alertas_stamp before update on public.alertas
  for each row execute function private.alertas_stamp();

-- Y quien levanta la alerta tampoco puede fingir ser otro.
create or replace function private.alertas_stamp_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.creada_por is null then
    new.creada_por := auth.uid();
  end if;
  return new;
end $fn$;
revoke all on function private.alertas_stamp_new() from public, anon, authenticated;
drop trigger if exists alertas_stamp_new on public.alertas;
create trigger alertas_stamp_new before insert on public.alertas
  for each row execute function private.alertas_stamp_new();

-- ## F) REPORTES: un solo viaje al servidor con todo el resumen del periodo.
-- Base del criterio: las cuentas CERRADAS dentro del periodo (lo cobrado en esos días).
-- Las cuentas abiertas salen aparte en 'pendientes', con su saldo real.
create or replace function public.reportes_resumen(
  p_desde      timestamptz,
  p_hasta      timestamptz,
  p_empresa_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp   uuid;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_out   jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);

  v_hasta := coalesce(p_hasta, now());
  v_desde := coalesce(p_desde, date_trunc('month', v_hasta));
  if v_desde >= v_hasta then
    raise exception 'El rango de fechas no es válido';
  end if;
  if v_hasta - v_desde > interval '400 days' then
    raise exception 'El periodo no puede pasar de 400 días';
  end if;

  with base as (
    select c.id, c.tipo, c.canal, c.comensales, c.propina, c.descuento,
           c.cerrada_en, c.cerrada_por, c.mesas_texto, c.numero,
           private.total_items(c.id) as bruto,
           greatest(private.total_items(c.id) - c.descuento, 0) + c.propina as total
      from public.cuentas c
     where c.empresa_id = v_emp
       and c.estado = 'cerrada'
       and c.cerrada_en >= v_desde and c.cerrada_en < v_hasta
  ), por_metodo as (
    select p.metodo, sum(p.monto) as monto, count(distinct p.cuenta_id) as n
      from public.pagos p join base b on b.id = p.cuenta_id
     group by p.metodo
  ), por_dia as (
    select date_trunc('day', b.cerrada_en)::date as dia, sum(b.total) as monto, count(*) as n
      from base b group by 1
  ), por_usuario as (
    select coalesce(nullif(pr.display_name,''), '—') as usuario, count(*) as n, sum(b.total) as monto
      from base b left join public.perfiles pr on pr.user_id = b.cerrada_por
     group by 1
  ), por_mesa as (
    select case when b.tipo = 'directa'
                then (case when b.canal = 'llevar' then 'Para llevar' else 'Mostrador' end)
                else coalesce(nullif(b.mesas_texto,''), 'Mesa')
           end as mesa,
           count(distinct b.id) as n, sum(b.total) as monto
      from base b group by 1
  ), por_area as (
    select a.area as area, sum(i.qty) as qty
      from public.cuenta_items i
      join base b on b.id = i.cuenta_id
      cross join lateral unnest(coalesce(nullif(i.areas,'{}'::text[]), array['cocina']::text[])) as a(area)
     where i.estado <> 'anulado'
     group by 1
  ), productos as (
    select i.nombre_snapshot as nombre, sum(i.qty)::integer as qty,
           round(sum(i.qty * i.precio_snapshot), 2) as importe
      from public.cuenta_items i join base b on b.id = i.cuenta_id
     where i.estado <> 'anulado'
     group by 1
  ), devoluciones as (
    select d.nombre, sum(d.qty)::integer as qty, round(sum(d.monto), 2) as monto
      from public.devoluciones_item d
     where d.empresa_id = v_emp
       and d.pedida_en >= v_desde and d.pedida_en < v_hasta
     group by 1
  ), pendientes as (
    select c.id as cuenta_id,
           case when c.tipo = 'directa'
                then (case when c.canal = 'llevar'
                           then coalesce(nullif(c.cliente_nombre,''), 'Para llevar')
                           else 'Mostrador' end)
                else coalesce((select string_agg(m.nombre, ', ' order by m.nombre)
                                 from public.cuenta_mesas cm
                                 join public.mesas m on m.id = cm.mesa_id
                                where cm.cuenta_id = c.id), 'Mesa')
           end as mesa,
           greatest(private.total_items(c.id) - c.descuento, 0) + c.propina as total,
           coalesce((select sum(p.monto) from public.pagos p where p.cuenta_id = c.id), 0) as pagado,
           c.abierta_en,
           coalesce(nullif(pr.display_name,''), '—') as mesero
      from public.cuentas c
      left join public.perfiles pr on pr.user_id = c.abierta_por
     where c.empresa_id = v_emp and c.estado <> 'cerrada'
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'moneda',
      (select e.moneda from public.empresas e where e.id = v_emp),
    'totales', (select jsonb_build_object(
        'cuentas',    count(*),
        'personas',   coalesce(sum(b.comensales), 0),
        'bruto',      round(coalesce(sum(b.bruto), 0), 2),
        'descuentos', round(coalesce(sum(b.descuento), 0), 2),
        'propinas',   round(coalesce(sum(b.propina), 0), 2),
        'total',      round(coalesce(sum(b.total), 0), 2),
        'ticket',     round(coalesce(avg(b.total), 0), 2),
        'por_persona', round(coalesce(sum(b.total) / nullif(sum(b.comensales), 0), 0), 2)
      ) from base b),
    'por_metodo', coalesce((select jsonb_agg(jsonb_build_object('metodo', m.metodo,
                                       'monto', round(m.monto, 2), 'cuentas', m.n) order by m.monto desc)
                   from por_metodo m), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', to_char(d.dia,'YYYY-MM-DD'),
                                    'monto', round(d.monto, 2), 'cuentas', d.n) order by d.dia)
                  from por_dia d), '[]'::jsonb),
    'por_usuario', coalesce((select jsonb_agg(jsonb_build_object('usuario', u.usuario,
                                       'monto', round(u.monto, 2), 'cuentas', u.n) order by u.monto desc)
                     from por_usuario u), '[]'::jsonb),
    'por_mesa', coalesce((select jsonb_agg(jsonb_build_object('mesa', me.mesa,
                                     'monto', round(me.monto, 2), 'cuentas', me.n) order by me.monto desc)
                   from por_mesa me), '[]'::jsonb),
    'por_area', coalesce((select jsonb_agg(jsonb_build_object('area', ar.area, 'qty', ar.qty::integer)
                                 order by ar.qty desc) from por_area ar), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'qty', p.qty,
                                     'importe', p.importe) order by p.qty desc, p.importe desc)
                    from productos p), '[]'::jsonb),
    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('nombre', d.nombre, 'qty', d.qty,
                                        'monto', d.monto) order by d.monto desc) from devoluciones d), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('cuenta_id', x.cuenta_id, 'mesa', x.mesa,
                                      'total', round(x.total, 2), 'pagado', round(x.pagado, 2),
                                      'saldo', round(greatest(x.total - x.pagado, 0), 2),
                                      'abierta_en', x.abierta_en, 'mesero', x.mesero)
                                      order by greatest(x.total - x.pagado, 0) desc)
                    from pendientes x where x.total - x.pagado > 0.01), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $fn$;
revoke all on function public.reportes_resumen(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.reportes_resumen(timestamptz, timestamptz, uuid) to authenticated;

-- ## G) Cuentas cerradas: queda constancia de las mesas que tenía (se borraban al cobrar)
alter table public.cuentas add column if not exists mesas_texto text;

-- ## H) QR y logo del negocio: mismos bucket y reglas que las fotos de productos
--     (se redefinen las 4 políticas: la carpeta puede ser productos|logos|qr y el super admin
--      necesita leerlas para bajar el respaldo .zip y subirlas al restaurar en otra base)
drop policy if exists "pos_imagenes_insert" on storage.objects;
create policy "pos_imagenes_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pos-imagenes'
  and name ~ '^(productos|logos|qr)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and (public.es_super() or private.es_miembro_de(e.id) or private.es_admin()))
);

drop policy if exists "pos_imagenes_select" on storage.objects;
create policy "pos_imagenes_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'pos-imagenes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and (public.es_super() or private.es_miembro_de(e.id) or private.es_admin()))
);

drop policy if exists "pos_imagenes_update" on storage.objects;
create policy "pos_imagenes_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'pos-imagenes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and (public.es_super() or private.es_miembro_de(e.id) or private.es_admin()))
)
with check (
  bucket_id = 'pos-imagenes'
  and name ~ '^(productos|logos|qr)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and (public.es_super() or private.es_miembro_de(e.id) or private.es_admin()))
);

drop policy if exists "pos_imagenes_delete" on storage.objects;
create policy "pos_imagenes_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'pos-imagenes'
  and exists (select 1 from public.empresas e
               where e.id::text = (storage.foldername(name))[2]
                 and (public.es_super()
                      or exists (select 1 from public.membresias m
                                  where m.empresa_id = e.id
                                    and m.user_id = auth.uid()
                                    and m.rol = 'admin')))
);

-- ## v0.31 · I) RESPALDO POR EMPRESA VERSIÓN 4: añade proveedores, costos, cuentas por pagar y alertas
--    (se redefine al final del archivo porque las tablas nuevas se crean más arriba)
create or replace function private.snapshot_empresa(p_emp uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'version', 4,
    'exportado_en', now(),
    'empresa', (select to_jsonb(e) from public.empresas e where e.id = p_emp),
    'zonas',       coalesce((select jsonb_agg(to_jsonb(z) order by z.orden) from public.zonas z where z.empresa_id = p_emp), '[]'),
    'mesas',       coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('zona_nombre',
                                      (select z.nombre from public.zonas z where z.id = m.zona_id)))
                                 from public.mesas m where m.empresa_id = p_emp), '[]'),
    'secciones',   coalesce((select jsonb_agg(to_jsonb(s) order by s.orden) from public.secciones_menu s where s.empresa_id = p_emp), '[]'),
    'productos',   coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('seccion_nombre', s.nombre)) from public.productos p
                             left join public.secciones_menu s on s.id = p.seccion_id where p.empresa_id = p_emp), '[]'),
    'cuentas',     coalesce((select jsonb_agg(to_jsonb(c)) from public.cuentas c where c.empresa_id = p_emp), '[]'),
    'cuenta_mesas',coalesce((select jsonb_agg(to_jsonb(cm)) from public.cuenta_mesas cm
                             join public.cuentas c on c.id = cm.cuenta_id where c.empresa_id = p_emp), '[]'),
    'cuenta_items',coalesce((select jsonb_agg(to_jsonb(ci)) from public.cuenta_items ci
                             join public.cuentas c on c.id = ci.cuenta_id where c.empresa_id = p_emp), '[]'),
    'cuenta_item_areas', coalesce((select jsonb_agg(to_jsonb(a)) from public.cuenta_item_areas a where a.empresa_id = p_emp), '[]'),
    'pagos',       coalesce((select jsonb_agg(to_jsonb(pg)) from public.pagos pg
                             join public.cuentas c on c.id = pg.cuenta_id where c.empresa_id = p_emp), '[]'),
    'turnos',      coalesce((select jsonb_agg(to_jsonb(t)) from public.turnos_caja t where t.empresa_id = p_emp), '[]'),
    'devoluciones',coalesce((select jsonb_agg(to_jsonb(d)) from public.devoluciones_item d where d.empresa_id = p_emp), '[]'),
    'insumos',     coalesce((select jsonb_agg(to_jsonb(i)) from public.insumos i where i.empresa_id = p_emp), '[]'),
    'recetas',     coalesce((select jsonb_agg(to_jsonb(r)) from public.recetas r where r.empresa_id = p_emp), '[]'),
    'insumos_movimientos', coalesce((select jsonb_agg(to_jsonb(mv) order by mv.en) from public.insumos_movimientos mv where mv.empresa_id = p_emp), '[]'),
    'proveedores', coalesce((select jsonb_agg(to_jsonb(pv) order by pv.nombre) from public.proveedores pv where pv.empresa_id = p_emp), '[]'),
    'costos_producto', coalesce((select jsonb_agg(to_jsonb(cp)) from public.costos_producto cp where cp.empresa_id = p_emp), '[]'),
    'cuentas_por_pagar', coalesce((select jsonb_agg(to_jsonb(dd) order by dd.fecha desc) from public.cuentas_por_pagar dd where dd.empresa_id = p_emp), '[]'),
    'alertas',     coalesce((select jsonb_agg(to_jsonb(al)) from public.alertas al where al.empresa_id = p_emp), '[]'),
    'equipo',      coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'correo', u.email,
                                                                 'rol', m.rol, 'areas', to_jsonb(m.areas),
                                                                 'nombre', coalesce(p.display_name,'')))
                             from public.membresias m
                             join auth.users u on u.id = m.user_id
                             left join public.perfiles p on p.user_id = m.user_id
                             where m.empresa_id = p_emp), '[]')
  );
$fn$;
revoke all on function private.snapshot_empresa(uuid) from public, anon, authenticated;

--    Importación v4: mismo contrato, tolera snapshots versión 2 y 3 (los arrays nuevos llegan vacíos)
drop function if exists public.super_importar_empresa(jsonb, text, text, boolean);
create or replace function public.super_importar_empresa(
  p_datos         jsonb,
  p_codigo        text,
  p_clave_inicial text    default 'pos12345',
  p_con_fotos     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  r        jsonb;
  v_new    uuid;
  v_rol    text;
  v_cuenta uuid;
  v_mesa   uuid;
  v_prod   uuid;
  v_ext    text;
  v_old    text;
  v_areas  text[];
  v_fotos  jsonb := '[]'::jsonb;
  v_map_zonas     jsonb := '{}'::jsonb;
  v_map_secciones jsonb := '{}'::jsonb;
  v_map_mesas     jsonb := '{}'::jsonb;
  v_map_productos jsonb := '{}'::jsonb;
  v_map_cuentas   jsonb := '{}'::jsonb;
  v_map_items     jsonb := '{}'::jsonb;
  v_map_turnos    jsonb := '{}'::jsonb;
  v_map_insumos   jsonb := '{}'::jsonb;
  v_map_users     jsonb := '{}'::jsonb;
  v_map_prov      jsonb := '{}'::jsonb;
  v_carpeta       text;
  v_clave_cfg     text;
  v_ruta_nueva    text;
  c_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
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

  -- Un respaldo son cientos de filas: los triggers de bitácora las duplicarían contra la fila
  -- de resumen 'super_importo' que se anota al final del import.
  perform set_config('pos.sin_bitacora', 'on', true);

  insert into public.empresas (nombre, codigo, moneda, iva_pct, propina_pct, config)
  values (p_datos->'empresa'->>'nombre', lower(p_codigo),
          coalesce(p_datos->'empresa'->>'moneda','Bs'),
          coalesce((p_datos->'empresa'->>'iva_pct')::numeric, 0),
          coalesce((p_datos->'empresa'->>'propina_pct')::numeric, 10),
          coalesce(p_datos->'empresa'->'config', '{}'::jsonb))
  returning id into v_emp;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'zonas','[]'::jsonb)) loop
    insert into public.zonas (empresa_id, nombre, orden)
    values (v_emp, coalesce(nullif(r->>'nombre',''),'Zona'), coalesce((r->>'orden')::int, 0))
    returning id into v_new;
    if (r->>'id') is not null then v_map_zonas := jsonb_set(v_map_zonas, array[r->>'id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'secciones','[]'::jsonb)) loop
    insert into public.secciones_menu (empresa_id, nombre, orden)
    values (v_emp, coalesce(nullif(r->>'nombre',''),'Sección'), coalesce((r->>'orden')::int, 0))
    returning id into v_new;
    if (r->>'id') is not null then v_map_secciones := jsonb_set(v_map_secciones, array[r->>'id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'productos','[]'::jsonb)) loop
    v_new := nullif(v_map_secciones->>(r->>'seccion_id'), '')::uuid;
    if v_new is null then
      select s.id into v_new from public.secciones_menu s
       where s.empresa_id = v_emp and s.nombre = (r->>'seccion_nombre') limit 1;
    end if;
    v_areas := case when jsonb_typeof(r->'areas') = 'array'
                    then array(select jsonb_array_elements_text(r->'areas')) else array['cocina']::text[] end;
    if coalesce(array_length(v_areas, 1), 0) = 0 then v_areas := array['cocina']::text[]; end if;
    insert into public.productos (empresa_id, seccion_id, nombre, precio, activo, areas, opciones, numero)
    values (v_emp, v_new, coalesce(nullif(r->>'nombre',''),'Artículo'),
            coalesce((r->>'precio')::numeric, 0), coalesce((r->>'activo')::boolean, true), v_areas,
            case when jsonb_typeof(r->'opciones') = 'array' then array(select jsonb_array_elements_text(r->'opciones')) else '{}'::text[] end,
            nullif(r->>'numero','')::int)
    returning id into v_prod;
    if (r->>'id') is not null then v_map_productos := jsonb_set(v_map_productos, array[r->>'id'], to_jsonb(v_prod)); end if;
    v_old := r->>'imagen_path';
    if p_con_fotos and v_old ~ ('^productos/' || c_uuid || '/' || c_uuid || '\.(webp|jpg)$') then
      v_ext := substring(v_old from '\.(webp|jpg)$');
      update public.productos set imagen_path = 'productos/' || v_emp::text || '/' || v_prod::text || '.' || v_ext where id = v_prod;
      v_fotos := v_fotos || jsonb_build_object('bucket', 'pos-imagenes', 'de', v_old,
                   'a', 'productos/' || v_emp::text || '/' || v_prod::text || '.' || v_ext);
    end if;
  end loop;
  update public.empresas e
     set contador_productos = greatest(e.contador_productos, coalesce((select max(p.numero) from public.productos p where p.empresa_id = v_emp), 0))
   where e.id = v_emp;

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
    if (r->>'id') is not null then v_map_mesas := jsonb_set(v_map_mesas, array[r->>'id'], to_jsonb(v_mesa)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'equipo','[]'::jsonb)) loop
    if coalesce(nullif(r->>'correo',''),'') = '' then continue; end if;
    select u.id into v_new from auth.users u where lower(u.email) = lower(r->>'correo') limit 1;
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
              extensions.crypt(coalesce(nullif(p_clave_inicial,''), 'pos12345'), extensions.gen_salt('bf', 10)),
              now(), now(), now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('display_name', coalesce(r->>'nombre','')),
              '', '', '', '', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_new, v_new::text, 'email',
              jsonb_build_object('sub', v_new::text, 'email', lower(r->>'correo'), 'email_verified', true),
              now(), now(), now());
      insert into public.perfiles (user_id, display_name)
      values (v_new, coalesce(r->>'nombre','')) on conflict (user_id) do nothing;
    end if;
    v_rol := case when r->>'rol' in ('admin','cajero','mesero','cocina','barra') then r->>'rol' else 'cajero' end;
    v_areas := case when jsonb_typeof(r->'areas') = 'array'
                    then array(select a from jsonb_array_elements_text(r->'areas') a where a ~ '^[a-z0-9][a-z0-9_-]{0,39}$')
                    else '{}'::text[] end;
    insert into public.membresias (empresa_id, user_id, rol, areas)
    values (v_emp, v_new, v_rol, v_areas)
    on conflict (empresa_id, user_id) do nothing;
    if (r->>'user_id') is not null then v_map_users := jsonb_set(v_map_users, array[r->>'user_id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'turnos','[]'::jsonb)) loop
    insert into public.turnos_caja (empresa_id, abierto_por, abierto_en, fondo, cerrado_en, cerrado_por, contado, esperado, movimientos, modo)
    values (v_emp, nullif(v_map_users->>(r->>'abierto_por'), '')::uuid,
            coalesce((r->>'abierto_en')::timestamptz, now()), coalesce((r->>'fondo')::numeric, 0),
            (r->>'cerrado_en')::timestamptz, nullif(v_map_users->>(r->>'cerrado_por'), '')::uuid,
            (r->>'contado')::numeric, (r->>'esperado')::numeric,
            coalesce(r->'movimientos', '{"movimientos":[]}'::jsonb),
            case when r->>'modo' in ('compartida','por_cajero') then r->>'modo' else 'compartida' end)
    returning id into v_new;
    if (r->>'id') is not null then v_map_turnos := jsonb_set(v_map_turnos, array[r->>'id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuentas','[]'::jsonb)) loop
    if not coalesce(r->>'tipo','') in ('mesa','directa') then continue; end if;
    insert into public.cuentas (empresa_id, tipo, canal, numero, estado, comensales, propina, descuento, nota, detalle, etiqueta,
                                cliente_nombre, cliente_tel, fiscal_nombre, fiscal_numero, fiscal_correo,
                                abierta_por, abierta_en, cerrada_por, cerrada_en)
    values (v_emp, r->>'tipo', case when r->>'canal' = 'llevar' then 'llevar' else null end, (r->>'numero')::int,
            case when coalesce(r->>'estado','abierta') in ('abierta','precuenta','cerrada') then r->>'estado' else 'cerrada' end,
            least(99, greatest(1, coalesce((r->>'comensales')::int, 1))),
            coalesce((r->>'propina')::numeric, 0), coalesce((r->>'descuento')::numeric, 0), r->>'nota',
            left(r->>'detalle', 500), case when r->>'etiqueta' ~ '^[a-z]$' then r->>'etiqueta' else null end,
            left(r->>'cliente_nombre', 80), left(r->>'cliente_tel', 40),
            left(r->>'fiscal_nombre', 80), left(r->>'fiscal_numero', 30), left(r->>'fiscal_correo', 120),
            nullif(v_map_users->>(r->>'abierta_por'), '')::uuid, coalesce((r->>'abierta_en')::timestamptz, now()),
            nullif(v_map_users->>(r->>'cerrada_por'), '')::uuid, (r->>'cerrada_en')::timestamptz)
    returning id into v_cuenta;
    if (r->>'id') is not null then v_map_cuentas := jsonb_set(v_map_cuentas, array[r->>'id'], to_jsonb(v_cuenta)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuenta_mesas','[]'::jsonb)) loop
    v_cuenta := nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid;
    v_mesa   := nullif(v_map_mesas->>(r->>'mesa_id'), '')::uuid;
    if v_cuenta is null or v_mesa is null then continue; end if;
    insert into public.cuenta_mesas (cuenta_id, mesa_id, empresa_id) values (v_cuenta, v_mesa, v_emp) on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuenta_items','[]'::jsonb)) loop
    v_cuenta := nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid;
    if v_cuenta is null then continue; end if;
    v_prod := nullif(v_map_productos->>(r->>'producto_id'), '')::uuid;
    v_areas := case when jsonb_typeof(r->'areas') = 'array' then array(select jsonb_array_elements_text(r->'areas')) else null end;
    if v_areas is null or coalesce(array_length(v_areas, 1), 0) = 0 then
      v_areas := coalesce((select p.areas from public.productos p where p.id = v_prod), array['cocina']::text[]);
    end if;
    insert into public.cuenta_items (empresa_id, cuenta_id, producto_id, nombre_snapshot, precio_snapshot, qty, estado, nota, indicaciones,
                                     motivo_anulacion, enviado_en, areas, areas_listas, extras, listo_en,
                                     anulacion_motivo, anulacion_por, anulacion_pedida_en, anulacion_estado_previo,
                                     anulacion_resuelta_por, anulacion_resuelta_en, creada_en)
    values (v_emp, v_cuenta, v_prod, coalesce(nullif(r->>'nombre_snapshot',''),'(importado)'),
            coalesce((r->>'precio_snapshot')::numeric, 0), greatest(1, coalesce((r->>'qty')::int, 1)),
            case when coalesce(r->>'estado','pendiente') in ('pendiente','enviado','listo','anulacion','anulado') then r->>'estado' else 'pendiente' end,
            coalesce(r->>'nota',''), coalesce(r->>'indicaciones',''), r->>'motivo_anulacion', (r->>'enviado_en')::timestamptz, v_areas,
            case when jsonb_typeof(r->'areas_listas') = 'array' then array(select jsonb_array_elements_text(r->'areas_listas')) else '{}'::text[] end,
            case when jsonb_typeof(r->'extras') = 'array' then r->'extras' else '[]'::jsonb end,
            (r->>'listo_en')::timestamptz, r->>'anulacion_motivo', nullif(v_map_users->>(r->>'anulacion_por'), '')::uuid,
            (r->>'anulacion_pedida_en')::timestamptz, r->>'anulacion_estado_previo',
            nullif(v_map_users->>(r->>'anulacion_resuelta_por'), '')::uuid, (r->>'anulacion_resuelta_en')::timestamptz,
            coalesce((r->>'creada_en')::timestamptz, now()))
    returning id into v_new;
    if (r->>'id') is not null then v_map_items := jsonb_set(v_map_items, array[r->>'id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuenta_item_areas','[]'::jsonb)) loop
    v_new := nullif(v_map_items->>(r->>'item_id'), '')::uuid;
    if v_new is null or coalesce(r->>'area','') = '' then continue; end if;
    insert into public.cuenta_item_areas (item_id, empresa_id, area, listo_en, listo_por)
    values (v_new, v_emp, r->>'area', coalesce((r->>'listo_en')::timestamptz, now()),
            nullif(v_map_users->>(r->>'listo_por'), '')::uuid)
    on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'pagos','[]'::jsonb)) loop
    v_cuenta := nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid;
    if v_cuenta is null then continue; end if;
    if not coalesce(r->>'metodo','') in ('efectivo','qr','tarjeta','mixed','cheque','vale','cxc','otro') then continue; end if;
    r := jsonb_set(r, '{detalle}', coalesce(r->'detalle', '{}'::jsonb));
    v_old := r->'detalle'->>'comprobante';
    if v_old is not null then
      if p_con_fotos and v_old ~ ('^comprobantes/' || c_uuid || '/' || c_uuid || '\.(webp|jpg)$') then
        v_ext := 'comprobantes/' || v_emp::text || '/' || substring(v_old from '[^/]+$');
        r := jsonb_set(r, '{detalle,comprobante}', to_jsonb(v_ext));
        v_fotos := v_fotos || jsonb_build_object('bucket', 'pos-comprobantes', 'de', v_old, 'a', v_ext);
      else
        r := jsonb_set(r, '{detalle}', (r->'detalle') - 'comprobante');
      end if;
    end if;
    insert into public.pagos (empresa_id, cuenta_id, metodo, monto, detalle, creada_por, creada_en)
    values (v_emp, v_cuenta, r->>'metodo', coalesce((r->>'monto')::numeric, 0), r->'detalle',
            nullif(v_map_users->>(r->>'creada_por'), '')::uuid, coalesce((r->>'creada_en')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'devoluciones','[]'::jsonb)) loop
    insert into public.devoluciones_item (empresa_id, cuenta_id, item_id, area, nombre, qty, monto, motivo, mesa,
                                          pedida_por, pedida_en, confirmada_por, confirmada_en, nota_confirmacion, turno_id)
    values (v_emp, nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid, nullif(v_map_items->>(r->>'item_id'), '')::uuid,
            coalesce(nullif(r->>'area',''),'cocina'), coalesce(nullif(r->>'nombre',''),'(importado)'),
            coalesce((r->>'qty')::int, 1), coalesce((r->>'monto')::numeric, 0), coalesce(nullif(r->>'motivo',''),'otro'), r->>'mesa',
            nullif(v_map_users->>(r->>'pedida_por'), '')::uuid, coalesce((r->>'pedida_en')::timestamptz, now()),
            nullif(v_map_users->>(r->>'confirmada_por'), '')::uuid, (r->>'confirmada_en')::timestamptz,
            r->>'nota_confirmacion', nullif(v_map_turnos->>(r->>'turno_id'), '')::uuid);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'insumos','[]'::jsonb)) loop
    insert into public.insumos (empresa_id, nombre, unidad, stock, stock_min, costo, activo, creada_en, actualizado_en,
                                presentaciones, con_merma, rendimiento_esp)
    values (v_emp, coalesce(nullif(r->>'nombre',''),'Insumo'), coalesce(nullif(r->>'unidad',''),'unidad'),
            coalesce((r->>'stock')::numeric, 0), coalesce((r->>'stock_min')::numeric, 0), coalesce((r->>'costo')::numeric, 0),
            coalesce((r->>'activo')::boolean, true), coalesce((r->>'creada_en')::timestamptz, now()), (r->>'actualizado_en')::timestamptz,
            case when jsonb_typeof(r->'presentaciones') = 'array' then r->'presentaciones' else '[]'::jsonb end,
            coalesce((r->>'con_merma')::boolean, false), (r->>'rendimiento_esp')::numeric)
    returning id into v_new;
    if (r->>'id') is not null then v_map_insumos := jsonb_set(v_map_insumos, array[r->>'id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'recetas','[]'::jsonb)) loop
    v_prod := nullif(v_map_productos->>(r->>'producto_id'), '')::uuid;
    v_new  := nullif(v_map_insumos->>(r->>'insumo_id'), '')::uuid;
    if v_prod is null or v_new is null or coalesce((r->>'cantidad')::numeric, 0) <= 0 then continue; end if;
    insert into public.recetas (empresa_id, producto_id, insumo_id, cantidad)
    values (v_emp, v_prod, v_new, (r->>'cantidad')::numeric) on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'insumos_movimientos','[]'::jsonb)) loop
    v_new := nullif(v_map_insumos->>(r->>'insumo_id'), '')::uuid;
    if v_new is null or r->>'tipo' not in ('entrada','salida','venta','ajuste','merma') then continue; end if;
    insert into public.insumos_movimientos (empresa_id, insumo_id, tipo, cantidad, stock_after, nota, usuario, usuario_nombre, en, detalle)
    values (v_emp, v_new, r->>'tipo', coalesce((r->>'cantidad')::numeric, 0), (r->>'stock_after')::numeric, r->>'nota',
            nullif(v_map_users->>(r->>'usuario'), '')::uuid, r->>'usuario_nombre', coalesce((r->>'en')::timestamptz, now()),
            case when jsonb_typeof(r->'detalle') = 'object' then r->'detalle' else null end);
  end loop;

  -- v0.31: el logo y el QR del negocio viajan en el respaldo; se renombran a la carpeta de la empresa nueva
  foreach v_carpeta in array array['logos','qr'] loop
    v_clave_cfg := case when v_carpeta = 'qr' then 'qrPath' else 'logoPath' end;
    v_old := p_datos->'empresa'->'config'->>v_clave_cfg;
    if v_old is null or v_old !~ ('^' || v_carpeta || '/' || c_uuid || '/' || c_uuid || '\.(webp|jpg)$') then continue; end if;
    v_ruta_nueva := v_carpeta || '/' || v_emp::text || '/' || v_emp::text || '.' || substring(v_old from '\.(webp|jpg)$');
    update public.empresas
       set config = jsonb_set(config, array[v_clave_cfg], to_jsonb(v_ruta_nueva), true)
     where id = v_emp;
    v_fotos := v_fotos || jsonb_build_object('bucket', 'pos-imagenes', 'de', v_old, 'a', v_ruta_nueva);
  end loop;

  -- v0.31: proveedores, costo por producto, cuentas por pagar y alertas
  for r in select * from jsonb_array_elements(coalesce(p_datos->'proveedores','[]'::jsonb)) loop
    if coalesce(nullif(r->>'nombre',''),'') = '' then continue; end if;
    insert into public.proveedores (empresa_id, nombre, telefono, email, direccion, nota, activo, creada_en)
    values (v_emp, left(btrim(r->>'nombre'), 80), coalesce(r->>'telefono',''), coalesce(r->>'email',''),
            coalesce(r->>'direccion',''), coalesce(r->>'nota',''), coalesce((r->>'activo')::boolean, true),
            coalesce((r->>'creada_en')::timestamptz, now()))
    returning id into v_new;
    if (r->>'id') is not null then v_map_prov := jsonb_set(v_map_prov, array[r->>'id'], to_jsonb(v_new)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'costos_producto','[]'::jsonb)) loop
    v_prod := nullif(v_map_productos->>(r->>'producto_id'), '')::uuid;
    if v_prod is null then continue; end if;
    insert into public.costos_producto (producto_id, empresa_id, costo, proveedor_id, actualizado_en, actualizado_por)
    values (v_prod, v_emp, greatest(0, coalesce((r->>'costo')::numeric, 0)),
            nullif(v_map_prov->>(r->>'proveedor_id'), '')::uuid,
            coalesce((r->>'actualizado_en')::timestamptz, now()),
            nullif(v_map_users->>(r->>'actualizado_por'), '')::uuid)
    on conflict (producto_id) do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'cuentas_por_pagar','[]'::jsonb)) loop
    v_new := nullif(v_map_prov->>(r->>'proveedor_id'), '')::uuid;
    if v_new is null or coalesce(nullif(r->>'concepto',''),'') = '' then continue; end if;
    insert into public.cuentas_por_pagar (empresa_id, proveedor_id, fecha, vencimiento, concepto, monto, pagado, nota,
                                         creada_por, creada_en, pagada_en)
    values (v_emp, v_new, coalesce((r->>'fecha')::date, current_date), (r->>'vencimiento')::date,
            left(btrim(r->>'concepto'), 120), greatest(0.01, coalesce((r->>'monto')::numeric, 0)),
            least(greatest(0, coalesce((r->>'pagado')::numeric, 0)), greatest(0.01, coalesce((r->>'monto')::numeric, 0))),
            coalesce(r->>'nota',''), nullif(v_map_users->>(r->>'creada_por'), '')::uuid,
            coalesce((r->>'creada_en')::timestamptz, now()), (r->>'pagada_en')::timestamptz);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_datos->'alertas','[]'::jsonb)) loop
    if coalesce(nullif(r->>'titulo',''),'') = '' then continue; end if;
    insert into public.alertas (empresa_id, tipo, titulo, mensaje, cuenta_id, mesa_id, prioridad,
                               creada_por, creada_en, resuelta_por, resuelta_en)
    values (v_emp, case when r->>'tipo' in ('general','cocina','cobro','inventario','mesa') then r->>'tipo' else 'general' end,
            left(btrim(r->>'titulo'), 80), left(coalesce(r->>'mensaje',''), 240),
            nullif(v_map_cuentas->>(r->>'cuenta_id'), '')::uuid, nullif(v_map_mesas->>(r->>'mesa_id'), '')::uuid,
            least(9, greatest(1, coalesce((r->>'prioridad')::int, 5))),
            nullif(v_map_users->>(r->>'creada_por'), '')::uuid, coalesce((r->>'creada_en')::timestamptz, now()),
            nullif(v_map_users->>(r->>'resuelta_por'), '')::uuid, (r->>'resuelta_en')::timestamptz);
  end loop;

  perform private.auditar(v_emp, 'super_importo', jsonb_build_object(
    'codigo', lower(p_codigo), 'origen', p_datos->'empresa'->>'id',
    'articulos', jsonb_array_length(coalesce(p_datos->'productos','[]'::jsonb)),
    'cuentas',   jsonb_array_length(coalesce(p_datos->'cuentas','[]'::jsonb)),
    'insumos',   jsonb_array_length(coalesce(p_datos->'insumos','[]'::jsonb)),
    'equipo',    jsonb_array_length(coalesce(p_datos->'equipo','[]'::jsonb)),
    'fotos',       jsonb_array_length(v_fotos),
    'proveedores', jsonb_array_length(coalesce(p_datos->'proveedores','[]'::jsonb)),
    'deudas',      jsonb_array_length(coalesce(p_datos->'cuentas_por_pagar','[]'::jsonb)),
    'alertas',     jsonb_array_length(coalesce(p_datos->'alertas','[]'::jsonb))));
  return jsonb_build_object('empresa_id', v_emp, 'fotos', v_fotos);
end $fn$;
revoke all on function public.super_importar_empresa(jsonb, text, text, boolean) from public, anon;
grant execute on function public.super_importar_empresa(jsonb, text, text, boolean) to authenticated;

-- ############################################################################
-- ## v0.34 · Abrir mesa con un toque: descartar la cuenta si se tocó por error
-- ############################################################################
create or replace function public.descartar_cuenta_vacia(
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
  c     public.cuentas;
  v_mesas text;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  select * into c from public.cuentas where id = p_cuenta_id and empresa_id = v_emp for update;
  if not found then return; end if;
  if c.tipo <> 'mesa' or c.estado <> 'abierta' then return; end if;
  -- Solo se descarta si de verdad está vacía: sin ítems y sin pagos (otro aparato pudo haberle agregado algo).
  if exists (select 1 from public.cuenta_items i where i.cuenta_id = c.id) then return; end if;
  if exists (select 1 from public.pagos p where p.cuenta_id = c.id) then return; end if;
  -- El nombre de la mesa se guarda antes de borrar: la cascada de cuenta_mesas lo borra con la cuenta.
  select string_agg(m.nombre, ', ') into v_mesas
    from public.cuenta_mesas cm join public.mesas m on m.id = cm.mesa_id
   where cm.cuenta_id = c.id;
  delete from public.cuentas where id = c.id and empresa_id = v_emp;
  begin
    perform private.auditar(v_emp, 'cuenta_descartada', jsonb_build_object(
      'cuenta', c.id::text, 'numero', c.numero, 'mesa', v_mesas),
      'cuenta', coalesce(v_mesas, 'cuenta ' || left(c.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;
revoke all on function public.descartar_cuenta_vacia(uuid, uuid) from public, anon;
grant execute on function public.descartar_cuenta_vacia(uuid, uuid) to authenticated;

-- ############################################################################
-- ## v0.41 · BITÁCORA POR TRIGGER: lo que la app escribe directo, sin RPC
-- ############################################################################
-- mesas, zonas, secciones de la carta, productos, alertas y empresas.config se
-- salvan por PostgREST sin pasar por una RPC, así que no dejaban ninguna fila en
-- auditoría: el negocio leía su bitácora y el salón o la carta aparecían intactos
-- aunque alguien hubiera borrado diez mesas. Un trigger genérico los anota con los
-- mismos nombres de acción que ya usa el modo demo, para que se lea igual en ambos.
create or replace function private.auditar_fila()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp    uuid;
  v_old    jsonb;
  v_new    jsonb;
  v_diff   jsonb := '{}'::jsonb;
  v_accion text;
  v_tipo   text;
  v_label  text;
  v_op     text := case when tg_op = 'INSERT' then 'alta'
                        when tg_op = 'UPDATE'  then 'edicion' else 'baja' end;
begin
  -- Sin usuario no hay nada que anotar: ni quien pega este SQL en el dashboard, ni un seed manual.
  if auth.uid() is null then return null; end if;
  -- Escrito desde dentro de otro trigger (el contador de productos, el alta de una empresa nueva).
  if pg_trigger_depth() > 1 then return null; end if;
  -- Caminos que ya anotan una sola fila de resumen: import de respaldo, margen en masa, retirar área.
  if coalesce(current_setting('pos.sin_bitacora', true), '') = 'on' then return null; end if;

  v_new := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;

  v_emp := coalesce(nullif(v_new->>'empresa_id', '')::uuid,
                    nullif(v_old->>'empresa_id', '')::uuid,
                    -- empresas no tiene empresa_id: la empresa es su propia fila
                    case when tg_table_name = 'empresas'
                         then coalesce(nullif(v_new->>'id', '')::uuid, nullif(v_old->>'id', '')::uuid)
                    end);
  if v_emp is null then return null; end if;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k)), '{}'::jsonb)
      into v_diff
      from jsonb_object_keys(v_new) k
     where v_new->k is distinct from v_old->k
       and k not in ('id', 'empresa_id', 'creada_en');

    if tg_table_name = 'empresas' then
      -- config es un jsonb grande: se anota clave por clave, no el blob entero.
      select coalesce(v_diff || jsonb_object_agg('config.' || k, jsonb_build_object(
               'antes',  left((v_old->'config'->k)::text, 200),
               'despues', left((v_new->'config'->k)::text, 200))), v_diff)
        into v_diff
        from jsonb_object_keys(coalesce(v_new->'config', '{}'::jsonb)) k
       where (v_new->'config'->k) is distinct from (v_old->'config'->k);
      v_diff := v_diff - 'contador_productos' - 'config';
    end if;

    if v_diff = '{}'::jsonb then return null; end if; -- no cambió nada que le importe al dueño
  elsif tg_op = 'INSERT' then
    v_diff := v_new - 'id' - 'empresa_id' - 'creada_en' - 'contador_productos' - 'config';
  else
    v_diff := jsonb_build_object('id', v_old->>'id');
  end if;

  v_tipo := case tg_table_name
    when 'mesas'          then 'mesa'
    when 'zonas'          then 'zona'
    when 'secciones_menu' then 'grupo'
    when 'productos'      then 'producto'
    when 'alertas'        then 'alerta'
    else 'config' end;

  v_accion := case tg_table_name
    when 'empresas' then case when tg_op = 'INSERT' then 'alta_empresa' else 'config_cambio' end
    when 'alertas' then case
      when tg_op = 'INSERT' then 'alerta_creado'
      when tg_op = 'DELETE' then 'alerta_baja'
      when coalesce(v_new->>'resuelta_en', '') is distinct from coalesce(v_old->>'resuelta_en', '') then 'alerta_resuelta'
      when coalesce(v_new->>'mesa_id', '')     is distinct from coalesce(v_old->>'mesa_id', '')     then 'alerta_movida'
      else 'alerta_edicion' end
    else case tg_table_name
      when 'mesas'          then 'salon_mesa_'
      when 'zonas'          then 'salon_zona_'
      when 'secciones_menu' then 'menu_grupo_'
      else 'menu_item_' end || v_op
  end;

  v_label := coalesce(
    nullif(btrim(coalesce(v_new->>'nombre', v_old->>'nombre', '')), ''),
    nullif(btrim(coalesce(v_new->>'titulo', v_old->>'titulo', '')), ''),
    nullif(coalesce(v_new->>'numero', v_old->>'numero'), ''),
    left(coalesce(v_new->>'id', v_old->>'id', ''), 8));

  perform private.auditar(v_emp, v_accion, v_diff, v_tipo, v_label);
  return null;
exception when others then
  -- Un trigger que falla revierte el guardado del usuario: la bitácora jamás interrumpe la operación.
  return null;
end $fn$;
revoke all on function private.auditar_fila() from public, anon, authenticated;

drop trigger if exists trg_bitacora_mesas          on public.mesas;
drop trigger if exists trg_bitacora_zonas          on public.zonas;
drop trigger if exists trg_bitacora_secciones_menu on public.secciones_menu;
drop trigger if exists trg_bitacora_productos      on public.productos;
drop trigger if exists trg_bitacora_alertas        on public.alertas;
drop trigger if exists trg_bitacora_empresas       on public.empresas;

create trigger trg_bitacora_mesas          after insert or update or delete on public.mesas          for each row execute function private.auditar_fila();
create trigger trg_bitacora_zonas          after insert or update or delete on public.zonas          for each row execute function private.auditar_fila();
create trigger trg_bitacora_secciones_menu after insert or update or delete on public.secciones_menu for each row execute function private.auditar_fila();
create trigger trg_bitacora_productos      after insert or update or delete on public.productos      for each row execute function private.auditar_fila();
create trigger trg_bitacora_alertas        after insert or update or delete on public.alertas        for each row execute function private.auditar_fila();
create trigger trg_bitacora_empresas       after insert or update on public.empresas                 for each row execute function private.auditar_fila();

commit;

select case
  when (select count(*) from information_schema.routine_privileges rp
         where rp.routine_name in ('crear_super','quitar_super')
           and rp.grantee in ('anon','authenticated')) = 0
  then 'success'
  else 'ERROR: crear_super / quitar_super quedaron abiertas a anon o authenticated'
end as resultado;

-- ############################################################################
-- ## v0.43 · Cerrar un pedido «para llevar» que quedó en blanco
-- ############################################################################
-- Igual que una mesa abierta por error: sin ítems y sin pagos se descarta con un toque.
create or replace function public.descartar_cuenta_vacia(
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
  c     public.cuentas;
  v_mesas text;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  select * into c from public.cuentas where id = p_cuenta_id and empresa_id = v_emp for update;
  if not found then return; end if;
  if c.estado <> 'abierta' then return; end if;
  if c.tipo <> 'mesa' and c.canal is distinct from 'llevar' then return; end if;
  if exists (select 1 from public.cuenta_items i where i.cuenta_id = c.id) then return; end if;
  if exists (select 1 from public.pagos p where p.cuenta_id = c.id) then return; end if;
  select string_agg(m.nombre, ', ') into v_mesas
    from public.cuenta_mesas cm join public.mesas m on m.id = cm.mesa_id
   where cm.cuenta_id = c.id;
  delete from public.cuentas where id = c.id and empresa_id = v_emp;
  begin
    perform private.auditar(v_emp, 'cuenta_descartada', jsonb_build_object(
      'cuenta', c.id::text, 'numero', c.numero, 'mesa', v_mesas),
      'cuenta', coalesce(v_mesas, 'cuenta ' || left(c.id::text, 8)));
  exception when others then
    null;
  end;
end $fn$;
revoke all on function public.descartar_cuenta_vacia(uuid, uuid) from public, anon;
grant execute on function public.descartar_cuenta_vacia(uuid, uuid) to authenticated;

-- ## I) INVENTARIO v0.44.0: presentaciones, merma y permiso gestionar_inventario
-- Todo idempotente: se puede volver a ejecutar sin romper nada. Los insumos viejos quedan con su
-- unidad como unidad base y SIN presentaciones.

-- Presentaciones: lista jsonb dentro del propio insumo (misma RLS que insumos, se guarda y se lee
-- en la misma RPC, sin tabla extra). Cada elemento: {id, nombre, cantidad (en unidad base),
-- costo (referencia por presentación, opcional), activo, principal}.
alter table public.insumos add column if not exists presentaciones jsonb not null default '[]'::jsonb;
alter table public.insumos add column if not exists con_merma boolean not null default false;
alter table public.insumos add column if not exists rendimiento_esp numeric(6,2);
-- El costo por unidad base puede ser muy pequeño (Bs 0,0425 por g): necesita más decimales.
alter table public.insumos alter column costo type numeric(14,4);

alter table public.insumos_movimientos add column if not exists detalle jsonb;
do $mig$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.insumos_movimientos'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table public.insumos_movimientos drop constraint %I', c.conname);
  end loop;
end $mig$;
alter table public.insumos_movimientos add constraint insumos_movimientos_tipo_check
  check (tipo in ('entrada','salida','venta','ajuste','merma'));

-- Permisos extra por persona (admin siempre los tiene todos). Hoy: ver_inventario y gestionar_inventario.
alter table public.membresias add column if not exists permisos text[] not null default '{}'::text[];

create or replace function private.tiene_permiso(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when private.mi_rol() = 'admin' then true
    else coalesce((select p_perm = any (m.permisos)
                     from public.membresias m
                    where m.empresa_id = private.empresa_activa()
                      and m.user_id = auth.uid()), false)
  end;
$fn$;
revoke all on function private.tiene_permiso(text) from public, anon, authenticated;

create or replace function private.exigir_permiso(p_perm text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if private.tiene_permiso(p_perm) then return; end if;
  if p_perm = 'ver_inventario' and private.tiene_permiso('gestionar_inventario') then return; end if;
  raise exception 'acción no permitida: falta el permiso %', p_perm;
end $fn$;
revoke all on function private.exigir_permiso(text) from public, anon, authenticated;

create or replace function public.mis_permisos(p_empresa_id uuid default null)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero','cocina','barra']::text[]);
  if private.mi_rol() = 'admin' then
    return array['ver_inventario','gestionar_inventario']::text[];
  end if;
  return coalesce((select m.permisos from public.membresias m
                    where m.empresa_id = v_emp and m.user_id = auth.uid()), '{}'::text[]);
end $fn$;
revoke all on function public.mis_permisos(uuid) from public, anon;
grant execute on function public.mis_permisos(uuid) to authenticated;

create or replace function public.equipo_poner_permisos(p_usuario_id uuid, p_permisos text[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_pe  text[] := coalesce(p_permisos, '{}'::text[]);
begin
  perform private.exigir_rol(array['admin']::text[]);
  v_emp := private.empresa_activa();
  if exists (select 1 from unnest(v_pe) x where x is null or x not in ('ver_inventario','gestionar_inventario')) then
    raise exception 'Permiso inválido';
  end if;
  update public.membresias set permisos = v_pe
   where empresa_id = v_emp and user_id = p_usuario_id and rol <> 'admin';
  if not found then
    raise exception 'Solo se asignan permisos a personas que no son administradoras';
  end if;
  perform private.auditar(v_emp, 'equipo_permisos',
    jsonb_build_object('usuario', p_usuario_id::text, 'permisos', to_jsonb(v_pe)));
end $fn$;
revoke all on function public.equipo_poner_permisos(uuid, text[]) from public, anon;
grant execute on function public.equipo_poner_permisos(uuid, text[]) to authenticated;

drop function if exists public.equipo_listar();
create or replace function public.equipo_listar()
returns table (usuario_id uuid, nombre text, correo text, rol text, creado_en timestamptz, areas text[], permisos text[])
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
    select m.user_id, coalesce(p.display_name, ''), coalesce(u.email::text, ''),
           m.rol, m.creada_en, m.areas, m.permisos
      from public.membresias m
      join auth.users u on u.id = m.user_id
      left join public.perfiles p on p.user_id = m.user_id
     where m.empresa_id = v_emp
     order by m.rol, coalesce(p.display_name, '');
end $fn$;
revoke all on function public.equipo_listar() from public, anon;
grant execute on function public.equipo_listar() to authenticated;

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
  perform private.exigir_permiso('ver_inventario');
  return jsonb_build_object(
    'insumos', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', i.id, 'nombre', i.nombre, 'unidad', i.unidad,
                   'stock', i.stock, 'stock_min', i.stock_min,
                   'costo', i.costo, 'activo', i.activo,
                   'presentaciones', i.presentaciones, 'con_merma', i.con_merma,
                   'rendimiento_esp', i.rendimiento_esp)
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
  v_cm     boolean;
  v_rend   numeric;
  v_tiene  boolean;
  v_pres   jsonb := '[]'::jsonb;
  v_el     jsonb;
  v_pn     text;
  v_pc     numeric;
  v_hay_pr boolean := false;
  v_princ  boolean;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_permiso('gestionar_inventario');

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
  v_cm     := coalesce((p_insumo->>'con_merma')::boolean, false);
  v_rend   := nullif(p_insumo->>'rendimiento_esp', '')::numeric;
  if v_rend is not null and (v_rend <= 0 or v_rend > 100) then
    raise exception 'El rendimiento esperado debe estar entre 0 y 100';
  end if;

  v_tiene := p_insumo ? 'presentaciones';
  if v_tiene then
    if jsonb_typeof(p_insumo->'presentaciones') <> 'array' then
      raise exception 'Las presentaciones deben ser una lista';
    end if;
    for v_el in select * from jsonb_array_elements(p_insumo->'presentaciones') loop
      v_pn := trim(coalesce(v_el->>'nombre', ''));
      v_pc := coalesce((v_el->>'cantidad')::numeric, 0);
      if v_pn = '' or v_pc <= 0 then
        raise exception 'Cada presentación necesita nombre y una cantidad mayor que cero';
      end if;
      v_princ := coalesce((v_el->>'principal')::boolean, false)
                 and coalesce((v_el->>'activo')::boolean, true) and not v_hay_pr;
      if v_princ then v_hay_pr := true; end if;
      v_pres := v_pres || jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(v_el->>'id', ''), gen_random_uuid()::text),
        'nombre', v_pn,
        'cantidad', round(v_pc, 3),
        'costo', case when nullif(v_el->>'costo', '') is null then null
                      else round((v_el->>'costo')::numeric, 2) end,
        'activo', coalesce((v_el->>'activo')::boolean, true),
        'principal', v_princ));
    end loop;
  end if;

  if v_id is not null then
    begin
      update public.insumos
         set nombre = v_nombre, unidad = v_unidad, stock = v_stock,
             stock_min = v_min, costo = v_costo, activo = v_activo,
             con_merma = v_cm, rendimiento_esp = v_rend,
             presentaciones = case when v_tiene then v_pres else presentaciones end,
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
    insert into public.insumos (empresa_id, nombre, unidad, stock, stock_min, costo, activo,
                                con_merma, rendimiento_esp, presentaciones)
    values (v_emp, v_nombre, v_unidad, v_stock, v_min, v_costo, v_activo,
            v_cm, v_rend, v_pres)
    on conflict (empresa_id, lower(nombre)) do update
       set unidad = excluded.unidad,
           stock = excluded.stock,
           stock_min = excluded.stock_min,
           costo = excluded.costo,
           activo = excluded.activo,
           con_merma = excluded.con_merma,
           rendimiento_esp = excluded.rendimiento_esp,
           presentaciones = excluded.presentaciones,
           actualizado_en = now()
    returning id into v_out;
  end if;

  begin
    perform private.auditar(v_emp, 'insumo_guardar', jsonb_build_object(
      'insumo', v_out::text, 'nombre', v_nombre, 'unidad', v_unidad,
      'stock', v_stock, 'costo', v_costo, 'edicion', v_id is not null,
      'presentaciones', jsonb_array_length(v_pres)),
      'insumo', v_nombre);
  exception when others then
    null;
  end;

  return v_out;
end $fn$;
revoke all on function public.insumo_guardar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.insumo_guardar(jsonb, uuid) to authenticated;

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
  perform private.exigir_permiso('gestionar_inventario');

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

-- Movimiento de inventario (lógica única; la usan insumo_movimiento y insumo_mermas_registrar).
-- Todas las cantidades van en UNIDAD BASE, salvo cuando se manda presentación + cantidad grande:
-- entonces la conversión la hace el servidor con las presentaciones guardadas del insumo.
create or replace function private.insumo_mover(
  p_emp              uuid,
  p_insumo_id        uuid,
  p_tipo             text,
  p_cantidad         numeric,
  p_nota             text,
  p_presentacion_id  text,
  p_cant_pres        numeric,
  p_limpio           numeric,
  p_costo_total      numeric,
  p_motivo           text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  i        public.insumos;
  v_pres   jsonb;
  v_cant   numeric;
  v_add    numeric;
  v_costo  numeric;
  v_ctot   numeric;
  v_new    numeric;
  v_stk0   numeric;
  v_det    jsonb := '{}'::jsonb;
  v_nota   text := nullif(trim(coalesce(p_nota, '')), '');
  v_mot    text;
  v_mov    numeric;
begin
  if coalesce(p_tipo, '') not in ('entrada','salida','ajuste','merma') then
    raise exception 'El tipo de movimiento debe ser entrada, salida, ajuste o merma';
  end if;

  select * into i from public.insumos
   where id = p_insumo_id and empresa_id = p_emp for update;
  if not found then
    raise exception 'El insumo no existe en la empresa activa';
  end if;

  v_cant := p_cantidad;
  if nullif(p_presentacion_id, '') is not null then
    select e into v_pres from jsonb_array_elements(i.presentaciones) e
     where e->>'id' = p_presentacion_id limit 1;
    if v_pres is null then
      raise exception 'La presentación no existe en este insumo';
    end if;
    if coalesce(p_cant_pres, 0) <= 0 then
      raise exception 'La cantidad de presentaciones debe ser mayor que cero';
    end if;
    v_cant := round(p_cant_pres * (v_pres->>'cantidad')::numeric, 3);
    v_det := jsonb_build_object('presentacion', v_pres->>'nombre', 'presentacion_id', p_presentacion_id,
                                'cant_pres', round(p_cant_pres, 3), 'factor', (v_pres->>'cantidad')::numeric);
    v_nota := trim(trim_scale(round(p_cant_pres, 3))::text || ' × ' || (v_pres->>'nombre')
                   || coalesce(' — ' || v_nota, ''));
  end if;

  v_cant := round(coalesce(v_cant, 0), 3);
  if p_tipo = 'ajuste' then
    if v_cant < 0 then raise exception 'El stock del ajuste no puede ser negativo'; end if;
  elsif v_cant <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  v_stk0  := i.stock;
  v_costo := i.costo;
  v_mov   := v_cant;

  if p_tipo = 'entrada' then
    v_add := v_cant;
    if i.con_merma and p_limpio is not null then
      if p_limpio <= 0 or round(p_limpio, 3) > v_cant then
        raise exception 'El peso limpio debe ser mayor que cero y no superar lo recibido';
      end if;
      v_add := round(p_limpio, 3);
      v_det := v_det || jsonb_build_object('bruto', v_cant, 'limpio', v_add,
                 'merma_limpieza', round(v_cant - v_add, 3),
                 'rendimiento', round(v_add / v_cant * 100, 2));
      v_mov := v_add;
    end if;
    v_ctot := p_costo_total;
    if v_ctot is null and v_pres is not null and nullif(v_pres->>'costo', '') is not null then
      v_ctot := round(p_cant_pres * (v_pres->>'costo')::numeric, 2);
    end if;
    if v_ctot is not null and v_ctot > 0 then
      v_costo := round((greatest(v_stk0, 0) * i.costo + v_ctot) / (greatest(v_stk0, 0) + v_add), 4);
      v_det := v_det || jsonb_build_object('costo_total', v_ctot);
    end if;
    v_new := v_stk0 + v_add;
  elsif p_tipo in ('salida','merma') then
    v_new := v_stk0 - v_cant;
  else
    v_new := v_cant;
  end if;

  if p_tipo = 'merma' then
    v_mot := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'otro');
    if v_mot not in ('limpieza','desecho','vencido','derrame','otro') then v_mot := 'otro'; end if;
    v_det := v_det || jsonb_build_object('motivo', v_mot);
  end if;
  v_det := v_det || jsonb_build_object('costo_unit', v_costo);

  update public.insumos
     set stock = v_new, costo = v_costo, actualizado_en = now()
   where id = p_insumo_id and empresa_id = p_emp;

  insert into public.insumos_movimientos
    (empresa_id, insumo_id, tipo, cantidad, stock_after, nota, detalle, usuario, usuario_nombre)
  values (p_emp, p_insumo_id, p_tipo, v_mov, v_new, v_nota, v_det, auth.uid(),
          coalesce((select p.display_name from public.perfiles p where p.user_id = auth.uid()), ''));

  perform private.auditar(p_emp, case when p_tipo = 'merma' then 'insumo_merma' else 'insumo_movimiento' end,
    jsonb_build_object('insumo', p_insumo_id::text, 'nombre', i.nombre, 'tipo', p_tipo,
                       'cantidad', v_mov, 'stock_after', v_new, 'detalle', v_det),
    'insumo', i.nombre);
  return v_new;
end $fn$;
revoke all on function private.insumo_mover(uuid, uuid, text, numeric, text, text, numeric, numeric, numeric, text) from public, anon, authenticated;

drop function if exists public.insumo_movimiento(uuid, text, numeric, text, uuid);
create or replace function public.insumo_movimiento(
  p_insumo_id       uuid,
  p_tipo            text,
  p_cantidad        numeric default null,
  p_nota            text    default null,
  p_empresa_id      uuid    default null,
  p_presentacion_id text    default null,
  p_cant_pres       numeric default null,
  p_limpio          numeric default null,
  p_costo_total     numeric default null,
  p_motivo          text    default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_permiso('gestionar_inventario');
  return private.insumo_mover(v_emp, p_insumo_id, p_tipo, p_cantidad, p_nota,
                              p_presentacion_id, p_cant_pres, p_limpio, p_costo_total, p_motivo);
end $fn$;
revoke all on function public.insumo_movimiento(uuid, text, numeric, text, uuid, text, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.insumo_movimiento(uuid, text, numeric, text, uuid, text, numeric, numeric, numeric, text) to authenticated;

-- Registro rápido de varias mermas del día en una sola operación (todo o nada).
-- p_lineas: [{insumo_id, cantidad | presentacion_id + cant_pres, motivo, nota}]
create or replace function public.insumo_mermas_registrar(
  p_lineas     jsonb,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  v_l   jsonb;
  v_n   integer := 0;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_permiso('gestionar_inventario');
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos una merma';
  end if;
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    perform private.insumo_mover(v_emp, nullif(v_l->>'insumo_id', '')::uuid, 'merma',
      nullif(v_l->>'cantidad', '')::numeric, v_l->>'nota',
      v_l->>'presentacion_id', nullif(v_l->>'cant_pres', '')::numeric,
      null, null, v_l->>'motivo');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;
revoke all on function public.insumo_mermas_registrar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.insumo_mermas_registrar(jsonb, uuid) to authenticated;

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
  perform private.exigir_permiso('gestionar_inventario');

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
  perform private.exigir_permiso('ver_inventario');

  v_dias := least(greatest(coalesce(p_dias, 7), 1), 90);
  v_lim  := least(greatest(coalesce(p_limite, 200), 1), 500);

  select coalesce(jsonb_agg(q.r order by (q.r->>'en') desc), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object('en', m.en,
                                'insumo_nombre', coalesce(i.nombre, '(insumo eliminado)'),
                                'unidad', i.unidad,
                                'tipo', m.tipo, 'cantidad', m.cantidad,
                                'stock_after', m.stock_after, 'nota', m.nota,
                                'detalle', m.detalle,
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

-- Filas para el reporte de merma: mermas manuales + mermas de limpieza (entradas con rendimiento).
create or replace function public.merma_listar(
  p_dias       integer default 30,
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
  v_out  jsonb;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_permiso('ver_inventario');
  v_dias := least(greatest(coalesce(p_dias, 30), 1), 365);
  select coalesce(jsonb_agg(q.r order by (q.r->>'en') desc), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object('en', m.en, 'insumo_id', m.insumo_id,
                                'insumo_nombre', coalesce(i.nombre, '(insumo eliminado)'),
                                'unidad', i.unidad, 'costo', i.costo,
                                'tipo', m.tipo, 'cantidad', m.cantidad,
                                'detalle', m.detalle) as r
        from public.insumos_movimientos m
        left join public.insumos i on i.id = m.insumo_id
       where m.empresa_id = v_emp
         and m.en >= now() - make_interval(days => v_dias)
         and (m.tipo = 'merma' or (m.tipo = 'entrada' and m.detalle ? 'merma_limpieza'))
       order by m.en desc
       limit 5000
    ) q;
  return v_out;
end $fn$;
revoke all on function public.merma_listar(integer, uuid) from public, anon, authenticated;
grant execute on function public.merma_listar(integer, uuid) to authenticated;


-- ############################################################################
-- ## J) DATOS FISCALES DEL CLIENTE v0.45.0 (nombre, NIT/RUT/RFC y correo; todo opcional)
-- ## Es solo un dato de la cuenta: no emite factura. Idempotente.
-- ############################################################################
alter table public.cuentas add column if not exists fiscal_nombre text;
alter table public.cuentas add column if not exists fiscal_numero text;
alter table public.cuentas add column if not exists fiscal_correo text;
alter table public.cuentas drop constraint if exists cuentas_fiscal_largo_chk;
alter table public.cuentas add constraint cuentas_fiscal_largo_chk check (
  (fiscal_nombre is null or length(fiscal_nombre) <= 80) and
  (fiscal_numero is null or length(fiscal_numero) <= 30) and
  (fiscal_correo is null or length(fiscal_correo) <= 120));

create or replace function public.poner_datos_fiscales(
  p_cuenta_id  uuid,
  p_nombre     text default null,
  p_numero     text default null,
  p_correo     text default null,
  p_empresa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
  c     public.cuentas;
  v_nom text := left(nullif(btrim(coalesce(p_nombre, '')), ''), 80);
  v_num text := left(nullif(btrim(coalesce(p_numero, '')), ''), 30);
  v_cor text := left(nullif(btrim(coalesce(p_correo, '')), ''), 120);
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero','mesero']::text[]);
  c := private.load_cuenta(p_cuenta_id, array['abierta','precuenta']::text[]);
  if v_cor is not null and v_cor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;
  update public.cuentas
     set fiscal_nombre = v_nom, fiscal_numero = v_num, fiscal_correo = v_cor
   where id = p_cuenta_id and empresa_id = v_emp;
  begin
    perform private.auditar(v_emp, 'cuenta_fiscal', jsonb_build_object(
      'cuenta', c.id::text, 'nombre', v_nom, 'numero', v_num),
      'cuenta', 'cuenta ' || coalesce(c.numero::text, left(c.id::text, 8)));
  exception when others then
    null; -- una falla de la bitácora nunca revierte la operación
  end;
end $fn$;
revoke all on function public.poner_datos_fiscales(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.poner_datos_fiscales(uuid, text, text, text, uuid) to authenticated;

-- ## Tiempo real de las cuentas (v0.50.2)
-- Para que, al cobrar una mesa en un dispositivo, los demás lo vean en ~1 segundo.
begin;

do $do$
declare
  v_tabla text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_tabla in array array['cuentas', 'cuenta_items', 'cuenta_mesas', 'pagos'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabla) then
        execute format('alter publication supabase_realtime add table public.%I', v_tabla);
      end if;
    end loop;
  end if;
exception when others then
  raise notice 'No se pudieron añadir las cuentas a supabase_realtime (%): la app usa el sondeo.', sqlerrm;
end $do$;

-- Para que los DELETE (separar/unir mesas, anular ítems) también lleguen filtrados por empresa.
alter table public.cuenta_items replica identity full;
alter table public.cuenta_mesas replica identity full;

commit;

-- ## v0.51 · Más formas de pago (cheque, vale, cuenta por cobrar, otro) y trabajadores para «cuenta por cobrar»
begin;

alter table public.pagos drop constraint if exists pagos_metodo_check;
alter table public.pagos add constraint pagos_metodo_check
  check (metodo in ('efectivo','qr','tarjeta','mixed','cheque','vale','cxc','otro'));


commit;

-- ## v0.52 · Personal sin acceso al sistema (limpieza, ayudantes…): pueden recibir cuentas por cobrar
begin;

-- Las personas con correo y clave son «membresías»; esta tabla es para quienes son parte de la empresa
-- pero no usan la app. Solo se toca a través de las funciones de abajo (sin acceso directo).
create table if not exists public.personal (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null check (length(btrim(nombre)) between 1 and 80),
  cargo      text not null default '' check (length(cargo) <= 60),
  activo     boolean not null default true,
  creada_en  timestamptz not null default now()
);
create index if not exists idx_personal_empresa on public.personal (empresa_id);
alter table public.personal enable row level security;
revoke all on public.personal from public, anon, authenticated;

-- Antes se llamaba sin parámetros y la app siempre manda p_empresa_id: la llamada fallaba en silencio
-- y la lista de «Cargar a» salía vacía. Ahora recibe la empresa y suma al personal sin acceso.
drop function if exists public.trabajadores_cobro();
create or replace function public.trabajadores_cobro(p_empresa_id uuid default null)
returns table (usuario_id uuid, nombre text, rol text, acceso boolean)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin','cajero']::text[]);
  return query
    select x.usuario_id, x.nombre, x.rol, x.acceso
      from (
        select m.user_id as usuario_id,
               coalesce(nullif(p.display_name, ''), split_part(u.email::text, '@', 1)) as nombre,
               m.rol as rol, true as acceso
          from public.membresias m
          join auth.users u on u.id = m.user_id
          left join public.perfiles p on p.user_id = m.user_id
         where m.empresa_id = v_emp
        union all
        select pe.id, pe.nombre, coalesce(nullif(pe.cargo, ''), 'personal'), false
          from public.personal pe
         where pe.empresa_id = v_emp and pe.activo
      ) x
     order by x.acceso desc, lower(x.nombre);
end $fn$;
revoke all on function public.trabajadores_cobro(uuid) from public, anon;
grant execute on function public.trabajadores_cobro(uuid) to authenticated;

create or replace function public.personal_listar(p_empresa_id uuid default null)
returns table (id uuid, nombre text, cargo text, creada_en timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_emp uuid;
begin
  v_emp := private.fijar_empresa(p_empresa_id);
  perform private.exigir_rol(array['admin']::text[]);
  return query
    select pe.id, pe.nombre, pe.cargo, pe.creada_en
      from public.personal pe
     where pe.empresa_id = v_emp and pe.activo
     order by lower(pe.nombre);
end $fn$;
revoke all on function public.personal_listar(uuid) from public, anon;
grant execute on function public.personal_listar(uuid) to authenticated;

-- Alta (p_id nulo) o edición. Quitar a alguien lo oculta (activo = false) y así su historial de
-- cuentas por cobrar sigue intacto.
create or replace function public.personal_guardar(
  p_nombre     text,
  p_cargo      text default '',
  p_id         uuid default null,
  p_activo     boolean default true,
  p_empresa_id uuid default null
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
  perform private.exigir_rol(array['admin']::text[]);
  if p_nombre is null or length(btrim(p_nombre)) = 0 or length(btrim(p_nombre)) > 80 then
    raise exception 'Escribe el nombre de la persona (máximo 80 letras)';
  end if;
  if p_id is null then
    insert into public.personal (empresa_id, nombre, cargo)
    values (v_emp, btrim(p_nombre), left(btrim(coalesce(p_cargo, '')), 60))
    returning id into v_id;
  else
    update public.personal
       set nombre = btrim(p_nombre), cargo = left(btrim(coalesce(p_cargo, '')), 60), activo = coalesce(p_activo, true)
     where id = p_id and empresa_id = v_emp
    returning id into v_id;
    if v_id is null then raise exception 'Esa persona no existe en tu empresa'; end if;
  end if;
  return v_id;
end $fn$;
revoke all on function public.personal_guardar(text, text, uuid, boolean, uuid) from public, anon;
grant execute on function public.personal_guardar(text, text, uuid, boolean, uuid) to authenticated;

-- ## Super: eliminar una empresa entera (pide la contraseña del propio super)
-- La clave se comprueba AQUÍ, en la base, contra auth.users: el navegador no puede saltarse la confirmación.
-- Todo lo de la empresa cae en cascada (mesas, cuentas, carta, equipo...). Queda una fila en auditoria,
-- que no tiene FK a empresas, con quién la borró y cuántas cosas tenía.
drop function if exists public.super_eliminar_empresa(uuid, text);
create or replace function public.super_eliminar_empresa(p_empresa uuid, p_clave text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ok     boolean;
  v_nombre text;
  v_codigo text;
  v_resumen jsonb;
  r record;
begin
  if not public.es_super() then raise exception 'requiere super'; end if;
  if coalesce(p_clave, '') = '' then raise exception 'Escribe tu contraseña para confirmar'; end if;

  select (u.encrypted_password = extensions.crypt(p_clave, u.encrypted_password))
    into v_ok
    from auth.users u
   where u.id = auth.uid();
  if not coalesce(v_ok, false) then raise exception 'Contraseña incorrecta'; end if;

  select e.nombre, e.codigo into v_nombre, v_codigo from public.empresas e where e.id = p_empresa;
  if not found then raise exception 'empresa inexistente'; end if;

  if exists (select 1 from public.membresias m where m.empresa_id = p_empresa and m.user_id = auth.uid()) then
    raise exception 'Esa es tu propia empresa: no se puede eliminar desde aquí';
  end if;

  v_resumen := jsonb_build_object(
    'nombre', v_nombre, 'codigo', v_codigo,
    'usuarios', (select count(*) from public.membresias m where m.empresa_id = p_empresa),
    'mesas',    (select count(*) from public.mesas x where x.empresa_id = p_empresa),
    'productos',(select count(*) from public.productos p where p.empresa_id = p_empresa),
    'cuentas',  (select count(*) from public.cuentas c where c.empresa_id = p_empresa));

  perform set_config('pos.sin_bitacora', 'on', true);
  delete from public.empresas where id = p_empresa;

  -- Por si alguna tabla con empresa_id no tuviera FK en cascada: barrido de lo que quede suelto.
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'empresa_id'
       and c.table_name not in ('auditoria', 'empresas')
  loop
    execute format('delete from public.%I where empresa_id = $1', r.table_name) using p_empresa;
  end loop;

  perform private.auditar(p_empresa, 'super_eliminar_empresa', v_resumen);
  return true;
end $fn$;

revoke all on function public.super_eliminar_empresa(uuid, text) from public, anon;
grant execute on function public.super_eliminar_empresa(uuid, text) to authenticated;

commit;
