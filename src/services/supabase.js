// Cliente Supabase + política de "empresa activa" según docs/CONTRATO.md §2.
// El contrato NO expone una RPC publica.fijar_empresa (es private.fijar_empresa, invocada
// por cada RPC de negocio): el mecanismo es pasar p_empresa_id en CADA llamada rpc().
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, USAR_SUPABASE } from '../config.js'

// X-Session-Id: sin este header PostgREST reparte las llamadas entre conexiones de la
// pgbouncer y el GUC de sesión que fija public.fijar_empresa() se pierde entre peticiones
// (los SELECT directos de mesas/cuentas volverían vacíos). Fijado con id estable en
// localStorage para que toda la sesión HTTP caiga en la misma conexión de Postgres.
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
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { 'X-Session-Id': sessionId } } })
  : null

const KEY_EMPRESA = 'pos-empresa-activa-id'
let empresaActivaId = (() => { try { return localStorage.getItem(KEY_EMPRESA) } catch { return null } })()

// Guarda la empresa activa en el cliente (y localStorage para sobrevivir recargas).
// A partir de aquí, toda rpc() inyectará p_empresa_id automáticamente.
export function fijarEmpresa(empresaId) {
  empresaActivaId = empresaId || null
  try {
    if (empresaActivaId) localStorage.setItem(KEY_EMPRESA, empresaActivaId)
    else localStorage.removeItem(KEY_EMPRESA)
  } catch { /* modo privado: sigue en memoria */ }
  return empresaActivaId
}

export const obtenerEmpresaActiva = () => empresaActivaId

// Fija ADEMÁS el GUC de sesión (public.fijar_empresa, migración 001/002: acepta miembro o
// super). Lo necesitan los SELECT directos de tiendaSupabase; las RPCs de negocio siguen
// usando private.fijar_empresa transaccional con p_empresa_id. Falla en voz alta: si no se
// fija, el salón saldría vacío y el usuario no entendería por qué.
export async function fijarEmpresaSesion(empresaId) {
  const id = fijarEmpresa(empresaId)
  if (!sb || !id) return id
  const { error } = await sb.rpc('fijar_empresa', { p_empresa: id })
  if (error) throw new Error(error.message || 'No se pudo fijar la empresa activa')
  return id
}

// Llamada RPC normalizada: siempre pasa p_empresa_id (norma del CONTRATO §2) salvo que
// el llamador lo indique explícitamente (conEmpresa:false, p. ej. empresa_por_codigo).
// Los `raise exception` del schema llegan en error.message (en español, listos para toast).
export async function rpc(nombre, params = {}, { conEmpresa = true } = {}) {
  if (!sb) throw new Error('Supabase no está configurado')
  const cuerpo = conEmpresa ? { p_empresa_id: empresaActivaId, ...params } : { ...params }
  if (conEmpresa && !cuerpo.p_empresa_id) throw new Error('No hay empresa activa seleccionada')
  const { data, error } = await sb.rpc(nombre, cuerpo)
  if (error) throw new Error(error.message || `Error en ${nombre}`)
  return data
}

// Error legible desde cualquier fallo supabase-js.
export const mensajeError = e => (e && (e.message || e.error_description || String(e))) || 'Error inesperado'
