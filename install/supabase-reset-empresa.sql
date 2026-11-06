-- ============================================================================
--  POS Control · BORRAR LOS DATOS DE UNA EMPRESA y dejarla como nueva (Supabase)
-- ============================================================================
--  ⚠️  ESTO NO SE PUEDE DESHACER. Borra cuentas, pagos, turnos, devoluciones, inventario, proveedores, costos, alertas,
--      impresiones, auditoría, mesas, salones, carta (grupos y productos) y la configuración de la empresa.
--
--  LA FORMA FÁCIL: doble clic en «borrar-empresa.bat» (esta misma carpeta). Te pregunta qué empresa y genera un SQL
--  «reset-<codigo>-<fecha>.sql» ya relleno (y lo copia al portapapeles). Lo de abajo es la forma manual con este archivo.
--
--  CÓMO USARLO A MANO
--    1) Cambia los 3 valores de la sección «PARÁMETROS» (código de la empresa, confirmación y si se borra el equipo).
--    2) Supabase → SQL Editor → pega TODO este archivo → Run.
--    3) Al terminar muestra una tabla: «estado» debe decir «OK» y «detalle» cuántas filas se borraron por tabla.
--
--  QUÉ QUEDA (igual que una empresa recién registrada)
--    · La empresa con su nombre, código y moneda (la configuración, IVA y propina vuelven a los valores de fábrica).
--    · Las personas que entran (membresías y usuarios) y su plan/límites. Con v_borrar_equipo = true se quitan de la
--      empresa todos los que no son admin (sus usuarios de acceso siguen existiendo en Supabase, solo dejan la empresa).
--    · Un salón llamado «Salón» con 8 mesas (1 a 8), como al registrarse.
--  QUÉ NO TOCA: otras empresas, los usuarios de Supabase Auth, ni las fotos guardadas en Storage (bórralas aparte si
--  quieres liberar espacio: Storage → carpeta de la empresa).
--
--  Es seguro ejecutarlo: si algo falla (código inexistente, falta la confirmación…) no se borra nada.
-- ============================================================================

-- ============================================================================
-- PARÁMETROS (lo único que editas)
-- ============================================================================
drop table if exists _reset_param;
drop table if exists _reset_resumen;
create temp table _reset_param as
select
  'CAMBIA-ESTE-CODIGO'::text as codigo,          -- código de la empresa (el que se usa para entrar), sin importar mayúsculas
  'NO'::text                 as confirmar,       -- escribe BORRAR TODO (en mayúsculas) para que se ejecute
  false                      as borrar_equipo;   -- true = quita de la empresa a todos los que no son admin

create temp table _reset_resumen (orden int, tabla text, filas bigint);

-- ============================================================================
-- Borrado
-- ============================================================================
do $reset$
declare
  p          record;
  v_emp      uuid;
  v_zona     uuid;
  v_t        text;
  v_pend     text[];
  v_sig      text[];
  v_pasada   int := 0;
  v_n        bigint;
  v_orden    int := 0;
begin
  select * into p from _reset_param;
  select id into v_emp from public.empresas where lower(codigo) = lower(p.codigo);
  if v_emp is null then
    raise exception 'No existe una empresa con el código «%». Revisa el valor de PARÁMETROS.', p.codigo;
  end if;
  if p.confirmar is distinct from 'BORRAR TODO' then
    raise exception 'Para borrar los datos de la empresa «%» escribe BORRAR TODO en la confirmación (PARÁMETROS).', p.codigo;
  end if;

  -- Los triggers de bitácora no deben anotar cada fila borrada.
  perform set_config('pos.sin_bitacora', 'on', true);

  -- Tablas con datos de la empresa (todas las que tienen empresa_id) menos las que se conservan.
  select coalesce(array_agg(c.table_name order by c.table_name), '{}') into v_pend
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'empresa_id'
     and c.table_name not in ('empresas', 'membresias', 'limites', 'empresa_activa_usuario', 'supers');

  -- El orden de borrado no se conoce de antemano (claves foráneas): se reintenta lo que quedó pendiente.
  while coalesce(array_length(v_pend, 1), 0) > 0 and v_pasada < 15 loop
    v_pasada := v_pasada + 1;
    v_sig := '{}';
    foreach v_t in array v_pend loop
      begin
        execute format('delete from public.%I where empresa_id = $1', v_t) using v_emp;
        get diagnostics v_n = row_count;
        v_orden := v_orden + 1;
        insert into _reset_resumen values (v_orden, v_t, v_n);
      exception when foreign_key_violation then
        v_sig := v_sig || v_t;
      end;
    end loop;
    exit when v_sig = v_pend;   -- sin progreso: se deja de insistir (se avisa abajo)
    v_pend := v_sig;
  end loop;
  if coalesce(array_length(v_pend, 1), 0) > 0 then
    raise exception 'No se pudo borrar por claves foráneas: %', array_to_string(v_pend, ', ');
  end if;

  if p.borrar_equipo then
    delete from public.membresias where empresa_id = v_emp and rol <> 'admin';
    get diagnostics v_n = row_count;
    insert into _reset_resumen values (v_orden + 1, 'membresias (no admin)', v_n);
  end if;

  -- Como una empresa recién registrada: configuración de fábrica + un salón con 8 mesas.
  update public.empresas set config = '{}'::jsonb, iva_pct = 0, propina_pct = 10 where id = v_emp;

  insert into public.zonas (empresa_id, nombre, orden) values (v_emp, 'Salón', 1) returning id into v_zona;
  insert into public.mesas (empresa_id, zona_id, nombre, x, y, w, h, forma, capacidad)
  select v_emp, v_zona, gs.n::text,
         70 + ((gs.n - 1) % 4) * 250,
         95 + ((gs.n - 1) / 4) * 300,
         110, 110, 'cuadrada', 4
    from generate_series(1, 8) as gs(n);
end
$reset$;

-- ============================================================================
-- Resultado (esta tabla es lo que verás al terminar)
-- ============================================================================
select
  '✅ OK'::text as estado,
  ('Empresa «' || (select codigo from _reset_param) || '» lista como nueva · ' ||
   coalesce((select sum(filas) from _reset_resumen), 0) || ' filas borradas')::text as detalle,
  coalesce((select string_agg(tabla || ': ' || filas, ' · ' order by orden) from _reset_resumen where filas > 0), '—') as por_tabla;
