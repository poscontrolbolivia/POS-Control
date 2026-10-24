import { rpc, sb, obtenerEmpresaActiva } from './supabaseClient.js'

// Personas a las que se puede cargar una cuenta por cobrar: el equipo con acceso y el personal sin acceso
// (limpieza, ayudantes...). Se piden una vez por empresa; una respuesta vacía o con error NO se guarda,
// así la lista nunca se queda «pegada» en vacío.
let cache = null
let cacheEmpresa = null

export const olvidarTrabajadores = () => { cache = null }

export async function cargarTrabajadores() {
  if (!sb) return []
  const emp = obtenerEmpresaActiva()
  if (cache && cacheEmpresa === emp) return cache
  const filas = await rpc('trabajadores_cobro', {})
  const lista = (Array.isArray(filas) ? filas : []).map(f => ({ id: f.usuario_id, nombre: f.nombre, rol: f.rol, acceso: f.acceso !== false }))
  if (lista.length) { cache = lista; cacheEmpresa = emp }
  return lista
}

export const trabajadoresEnCache = () => cache || []
