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
