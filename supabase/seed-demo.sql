-- seed-demo.sql · ejecutado 2026-10-16 sobre el proyecto oeyrnenclklmczlfoxzy
-- Idempotente. Agrega codigo de empresa (necesario para el login multiempresa),
-- función de búsqueda pública y datos demo de una empresa.

-- 1) columna codigo (código corto que el usuario escribe en el login)
alter table public.empresas add column if not exists codigo text;
create unique index if not exists empresas_codigo_uniq on public.empresas (lower(codigo)) where codigo is not null;

-- 2) búsqueda pre-login: devuelve empresa por código (solo datos públicos)
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

-- 3) empresa demo + admin (usuario ya creado en auth) + datos iniciales
with e as (
  insert into public.empresas (nombre, codigo, moneda, iva_pct, propina_pct)
  select 'Mi negocio', 'demo', 'Bs', 0, 10
  where not exists (select 1 from public.empresas where lower(codigo)='demo')
  returning id
)
insert into public.membresias (empresa_id, user_id, rol, pin_descuento_hash)
select e.id, '85201957-cdfb-4235-acfe-dd1a54e348d0'::uuid, 'admin',
       extensions.crypt('1234', extensions.gen_salt('bf'))
from e
where not exists (select 1 from public.membresias m where m.user_id='85201957-cdfb-4235-acfe-dd1a54e348d0'::uuid);

-- zonas
insert into public.zonas (empresa_id, nombre, orden)
select e.id, v.nombre, v.orden
from (select id from public.empresas where lower(codigo)='demo' limit 1) e,
     (values ('Salón',1),('Terraza',2)) v(nombre, orden)
where not exists (select 1 from public.zonas z where z.empresa_id=e.id);

-- mesas (coordenadas 1000x600, mismas que el canvas del cliente)
insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad)
select e.id, z.id, v.nombre, v.x, v.y, v.w, v.h, v.forma, v.cap
from (select id from public.empresas where lower(codigo)='demo' limit 1) e
join lateral (select id, orden from public.zonas where empresa_id=e.id and orden=1) z on true
cross join (values
  ('Mesa 1',120,150,110,110,'cuadrada'::text,4),
  ('Mesa 2',320,150,110,110,'redonda',4),
  ('Mesa 3',520,150,110,110,'cuadrada',4),
  ('Mesa 4',720,150,110,110,'redonda',4)
) v(nombre,x,y,w,h,forma,cap)
where not exists (select 1 from public.mesas m where m.empresa_id=e.id);

insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad)
select e.id, z.id, 'Mesa 5', 300, 250, 150, 100, 'rect', 6
from (select id from public.empresas where lower(codigo)='demo' limit 1) e
join lateral (select id, orden from public.zonas where empresa_id=e.id and orden=2) z on true
where not exists (select 1 from public.mesas m where m.empresa_id=e.id and m.nombre='Mesa 5');

-- secciones + productos
with e as (select id from public.empresas where lower(codigo)='demo' limit 1),
s as (
  insert into public.secciones_menu (empresa_id, nombre, orden)
  select e.id, v.nombre, v.orden from e, (values ('Desayunos',1),('Comida',2),('Bebidas',3)) v(nombre,orden)
  where not exists (select 1 from public.secciones_menu x where x.empresa_id=e.id)
  returning id, nombre, empresa_id
)
insert into public.productos (empresa_id, seccion_id, nombre, precio)
select s.empresa_id, s.id, v.nombre, v.precio
from s join (values
  ('Desayunos','Café',10),('Desayunos','Api con pastel',12),('Desayunos','Sándwich',18),
  ('Comida','Milanesa',45),('Comida','Pique macho',60),('Comida','Sopa del día',20),
  ('Bebidas','Jugo de naranja',14),('Bebidas','Refresco',10),('Bebidas','Cerveza',25)
) v(seccion,nombre,precio) on v.seccion = s.nombre;

-- 4) verificación
select
  (select count(*) from public.empresas) as empresas,
  (select count(*) from public.membresias) as membresias,
  (select count(*) from public.mesas) as mesas,
  (select count(*) from public.productos) as productos,
  (select count(*) from public.perfiles) as perfiles;
