-- Parche v0.38 · Unir subcuentas hermanas (2A + 2B) y mover solo parte de un ítem.
-- Pegar UNA vez en el SQL editor de Supabase. Es idempotente: vuelve a salir igual si se re-ejecuta.
-- No borra ni altera datos; solo crea/actualiza las dos funciones y sus permisos.
-- Ya está incluido en supabase-setup-final.sql: si pegas el setup completo, esto no hace falta.

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

    update public.cuentas
       set estado = 'cerrada', cerrada_por = auth.uid(),
           cerrada_en = now(), nota = 'unida a otra cuenta'
     where id = v_otra and empresa_id = v_emp;

    delete from public.cuenta_mesas where cuenta_id = v_otra;

    v_absorb := v_absorb || jsonb_build_array(v_otra);
  end loop;

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

  return v_nuevo;
end $fn$;
revoke all on function public.mover_item_parcial(uuid, integer, uuid, uuid, uuid) from public, anon;
grant execute on function public.mover_item_parcial(uuid, integer, uuid, uuid, uuid) to authenticated;
