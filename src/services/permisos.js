// Mapa rol -> acciones. Debe coincidir con CONTRATO.md (IA-1); la validación real irá en RLS/RPC.
const P = {
  admin: ['editar_mapa', 'gestionar_menu', 'abrir_turno', 'cerrar_turno', 'movimiento_caja', 'cobrar',
    'propina', 'descuento', 'anular_pendiente', 'anular_enviado', 'mover_items', 'unir_mesas',
    'abrir_mesa', 'pedir', 'venta_directa', 'ver_reportes', 'gestionar_personal'],
  cajero: ['abrir_turno', 'cerrar_turno', 'movimiento_caja', 'cobrar', 'propina', 'descuento_pin',
    'anular_pendiente', 'mover_items', 'abrir_mesa', 'pedir', 'venta_directa', 'ver_reportes'],
  mesero: ['abrir_mesa', 'pedir', 'precuenta', 'mover_items', 'anular_pendiente'],
}
export const puede = (rol, accion) => (P[rol] || []).includes(accion)
export const ROLES = Object.keys(P)
// El descuento sin PIN es solo admin; el cajero puede aplicar descuento con PIN de admin (accion 'descuento_pin').
