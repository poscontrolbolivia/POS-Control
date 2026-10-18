import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, USAR_SUPABASE } from './config.js'

const KEY_SESION = 'pos-sesion-id'
const sessionId = (() => {
  const nuevo = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))
  try {
    let v = localStorage.getItem(KEY_SESION)
    if (!v) { v = nuevo(); localStorage.setItem(KEY_SESION, v) }
    return v
  } catch { return nuevo() }
})()

export const sb = USAR_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {

    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { headers: { 'X-Session-Id': sessionId } },
  })
  : null

const KEY_EMPRESA = 'pos-empresa-activa-id'
let empresaActivaId = (() => { try { return localStorage.getItem(KEY_EMPRESA) } catch { return null } })()

export function fijarEmpresa(empresaId) {
  empresaActivaId = empresaId || null
  try {
    if (empresaActivaId) localStorage.setItem(KEY_EMPRESA, empresaActivaId)
    else localStorage.removeItem(KEY_EMPRESA)
  } catch {  }
  return empresaActivaId
}

export const obtenerEmpresaActiva = () => empresaActivaId

export async function fijarEmpresaSesion(empresaId) {
  const id = fijarEmpresa(empresaId)
  if (!sb || !id) return id
  const { error } = await sb.rpc('fijar_empresa', { p_empresa: id })
  if (error) throw new Error(error.message || 'No se pudo fijar la empresa activa')
  return id
}

export async function rpc(nombre, params = {}, { conEmpresa = true } = {}) {
  if (!sb) throw new Error('Supabase no está configurado')
  const cuerpo = conEmpresa ? { p_empresa_id: empresaActivaId, ...params } : { ...params }
  if (conEmpresa && !cuerpo.p_empresa_id) throw new Error('No hay empresa activa seleccionada')
  const { data, error } = await sb.rpc(nombre, cuerpo)
  if (error) throw new Error(error.message || `Error en ${nombre}`)
  return data
}

export const mensajeError = e => (e && (e.message || e.error_description || String(e))) || 'Error inesperado'
