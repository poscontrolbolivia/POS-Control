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

-- semilla: el dueño de la plataforma (ajustar uid si cambia)
insert into public.supers (user_id)
values ('85201957-cdfb-4235-acfe-dd1a54e348d0')
on conflict do nothing;

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
