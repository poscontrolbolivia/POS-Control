const P = {
  admin: ['editar_mapa', 'gestionar_menu', 'abrir_turno', 'cerrar_turno', 'movimiento_caja', 'cobrar',
    'propina', 'descuento', 'anular_pendiente', 'anular_enviado', 'borrar_producto', 'mover_items', 'unir_mesas',
    'abrir_mesa', 'pedir', 'venta_directa', 'ver_reportes', 'gestionar_personal',
    'ver_cocina', 'autorizar_anulacion', 'ver_auditoria', 'ver_inventario', 'gestionar_inventario', 'ver_alertas', 'marcar_listo'],
  cajero: ['abrir_turno', 'cerrar_turno', 'movimiento_caja', 'cobrar', 'propina', 'descuento_pin',
    'anular_pendiente', 'anular_enviado', 'borrar_producto', 'mover_items', 'abrir_mesa', 'pedir', 'venta_directa',
    'ver_reportes', 'ver_cocina', 'autorizar_anulacion', 'ver_alertas', 'marcar_listo'],
  mesero: ['abrir_mesa', 'pedir', 'precuenta', 'mover_items', 'anular_pendiente', 'ver_cocina', 'ver_alertas', 'marcar_listo'],

  cocina: ['ver_cocina'],
  barra: ['ver_cocina'],
}
// Permisos que el admin puede otorgar a otras personas (se guardan en membresias.permisos).
// gestionar_inventario incluye ver_inventario.
export const PERMISOS_ASIGNABLES = ['ver_inventario', 'gestionar_inventario']
let extras = []
export const fijarPermisosExtra = lista => { extras = Array.isArray(lista) ? lista.filter(x => PERMISOS_ASIGNABLES.includes(x)) : [] }
export const puede = (rol, accion) => {
  if ((P[rol] || []).includes(accion)) return true
  if (rol === 'admin') return false
  if (extras.includes(accion)) return true
  return accion === 'ver_inventario' && extras.includes('gestionar_inventario')
}
export const ROLES = Object.keys(P)

