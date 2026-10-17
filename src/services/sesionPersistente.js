// Sesión que NO se pierde al bloquear el teléfono o cambiar de app.
// La sesión de Supabase y 'pos-sesion' ya viven en localStorage; este guardia se encarga de lo que
// fallaba al volver: el token vencido mientras el equipo dormía, el candado de refresco atascado y
// los datos viejos en pantalla.
//   · al desbloquear / volver a la app / recuperar internet → renueva el token si le queda poco,
//     vuelve a fijar la empresa en la conexión y pide al store que se re-sincronice;
//   · solo se considera «sesión vencida» si Supabase confirma que el refresh token ya no sirve
//     (no por una falta de red momentánea): entonces se avisa en el login y se pide entrar de nuevo;
//   · pide al navegador almacenamiento persistente para que no le borre la sesión.
import { sb, fijarEmpresaSesion, obtenerEmpresaActiva } from './supabase.js'
import { leerSesionSup } from './store.jsx'

const AVISO_LOGIN = 'pos-aviso-login'
const RENOVAR_ANTES_S = 10 * 60   // renovar si faltan menos de 10 min
const REVISAR_CADA_MS = 5 * 60 * 1000

let alVencer = null
let enCurso = false
let ultimaRevision = 0

const esFalloDeSesion = e => {
  const m = String(e?.message || e || '')
  const st = Number(e?.status) || 0
  return st === 400 || st === 401 || st === 403 || /refresh.?token|invalid.?grant|not.?found|already.?used|session.?(not|missing|expired)|jwt/i.test(m)
}

export const leerAvisoLogin = () => {
  try { const v = sessionStorage.getItem(AVISO_LOGIN); if (v) sessionStorage.removeItem(AVISO_LOGIN); return v || '' } catch { return '' }
}

function vencida() {
  try { sessionStorage.setItem(AVISO_LOGIN, 'vencida') } catch { /* ignore */ }
  alVencer?.()
}

/** Revisa y renueva la sesión. Devuelve true si sigue válida (o no se pudo comprobar por falta de red). */
export async function revisarSesion({ forzar = false } = {}) {
  const guardada = leerSesionSup()
  if (!sb || !guardada?.supabase) return true            // demo o sin sesión: nada que cuidar
  if (enCurso) return true
  if (!forzar && Date.now() - ultimaRevision < 4000) return true
  enCurso = true
  ultimaRevision = Date.now()
  try {
    const { data, error } = await sb.auth.getSession()
    if (error && esFalloDeSesion(error)) { vencida(); return false }
    let ses = data?.session
    if (!ses) { vencida(); return false }                 // había 'pos-sesion' pero Supabase ya no tiene token
    const faltan = (ses.expires_at || 0) - Math.floor(Date.now() / 1000)
    if (faltan < RENOVAR_ANTES_S) {
      const r = await sb.auth.refreshSession()
      if (r.error) {
        if (esFalloDeSesion(r.error) && navigator.onLine !== false) { vencida(); return false }
        return true                                       // sin red: se reintenta al volver internet
      }
      ses = r.data?.session || ses
    }
    // La conexión anclada puede haber cambiado mientras dormía: se vuelve a fijar la empresa.
    const emp = guardada.empresaId || obtenerEmpresaActiva()
    if (emp) { try { await fijarEmpresaSesion(emp) } catch { /* el panel avisa si falla */ } }
    try { window.dispatchEvent(new Event('pos-reanudar')) } catch { /* ignore */ }
    return true
  } catch (e) {
    return !esFalloDeSesion(e)
  } finally { enCurso = false }
}

/** Arranca el guardia (una vez). `onVencida`: qué hacer cuando de verdad hay que volver a entrar. */
export function iniciarGuardiaSesion(onVencida) {
  alVencer = onVencida
  try { navigator.storage?.persist?.() } catch { /* ignore */ }
  const reanudar = () => { if (!document.hidden) revisarSesion() }
  document.addEventListener('visibilitychange', reanudar)
  window.addEventListener('focus', reanudar)
  window.addEventListener('online', reanudar)
  window.addEventListener('pageshow', reanudar)
  const id = setInterval(reanudar, REVISAR_CADA_MS)
  revisarSesion({ forzar: true })
  return () => {
    document.removeEventListener('visibilitychange', reanudar)
    window.removeEventListener('focus', reanudar)
    window.removeEventListener('online', reanudar)
    window.removeEventListener('pageshow', reanudar)
    clearInterval(id)
    alVencer = null
  }
}
