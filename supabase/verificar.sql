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
