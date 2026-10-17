// Mapa rol -> acciones. Debe coincidir con CONTRATO.md (IA-1); la validación real irá en RLS/RPC.
const P = {
  admin: ['editar_mapa', 'gestionar_menu', 'abrir_turno', 'cerrar_turno', 'movimiento_caja', 'cobrar',
    'propina', 'descuento', 'anular_pendiente', 'anular_enviado', 'borrar_producto', 'mover_items', 'unir_mesas',
    'abrir_mesa', 'pedir', 'venta_directa', 'ver_reportes', 'gestionar_personal',
    'ver_cocina', 'autorizar_anulacion', 'ver_auditoria', 'ver_inventario'],
  cajero: ['abrir_turno', 'cerrar_turno', 'movimiento_caja', 'cobrar', 'propina', 'descuento_pin',
    'anular_pendiente', 'anular_enviado', 'borrar_producto', 'mover_items', 'abrir_mesa', 'pedir', 'venta_directa',
    'ver_reportes', 'ver_cocina', 'autorizar_anulacion'],
  mesero: ['abrir_mesa', 'pedir', 'precuenta', 'mover_items', 'anular_pendiente', 'ver_cocina'],
  // Cocina y barra: solo su pantalla de área. No tocan caja, menú ni equipo (ni hacia arriba).
  cocina: ['ver_cocina'],
  barra: ['ver_cocina'],
}
export const puede = (rol, accion) => (P[rol] || []).includes(accion)
export const ROLES = Object.keys(P)
// El descuento sin PIN es solo admin; el cajero puede aplicar descuento con PIN de admin (accion 'descuento_pin').
