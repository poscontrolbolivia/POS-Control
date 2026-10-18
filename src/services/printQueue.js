import { rpc } from './supabaseClient.js'

export const modoImpresion = config => (config?.modoImpresion === 'estacion' ? 'estacion' : 'local')

export const encolarImpresion = trabajos => rpc('encolar_impresion', { p_trabajos: trabajos })

export const reclamarImpresion = (grupos, limite = 8) => rpc('reclamar_impresion', { p_grupos: grupos, p_limite: limite })
export const finalizarImpresion = (id, ok, error = null) => rpc('finalizar_impresion', { p_id: id, p_ok: ok, p_error: error })
export const listarImpresion = (limite = 30) => rpc('listar_impresion', { p_limite: limite })
export const gestionarImpresion = (accion, id = null) => rpc('gestionar_impresion', { p_accion: accion, p_id: id })
