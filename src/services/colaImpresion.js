// Cola de impresión en Supabase (tabla trabajos_impresion, solo vía RPC).
// Los equipos de meseros/cajeros dejan aquí el trabajo y la "estación de impresión" (la PC del local)
// lo reclama e imprime. Ver services/estacion.js y supabase/setup.sql (sección 007).
import { rpc } from './supabase.js'

/** 'estacion' → todo se envía a la PC del local; cualquier otro valor → cada equipo imprime directo. */
export const modoImpresion = config => (config?.modoImpresion === 'estacion' ? 'estacion' : 'local')

/** trabajos: [{ grupo, titulo, payload: { lineas, ancho, corte, beep } }] (1..20). */
export const encolarImpresion = trabajos => rpc('encolar_impresion', { p_trabajos: trabajos })

export const reclamarImpresion = (grupos, limite = 8) => rpc('reclamar_impresion', { p_grupos: grupos, p_limite: limite })
export const finalizarImpresion = (id, ok, error = null) => rpc('finalizar_impresion', { p_id: id, p_ok: ok, p_error: error })
export const listarImpresion = (limite = 30) => rpc('listar_impresion', { p_limite: limite })
export const gestionarImpresion = (accion, id = null) => rpc('gestionar_impresion', { p_accion: accion, p_id: id })
