import { sb, fijarEmpresaSesion, obtenerEmpresaActiva } from './supabaseClient.js'
import { leerSesionSup } from '../context/StoreContext.jsx'

const AVISO_LOGIN = 'pos-aviso-login'
const RENOVAR_ANTES_S = 10 * 60
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
  try { sessionStorage.setItem(AVISO_LOGIN, 'vencida') } catch {  }
  alVencer?.()
}

async function revisarSesion({ forzar = false } = {}) {
  const guardada = leerSesionSup()
  if (!sb || !guardada?.supabase) return true
  if (enCurso) return true
  if (!forzar && Date.now() - ultimaRevision < 4000) return true
  enCurso = true
  ultimaRevision = Date.now()
  try {
    const { data, error } = await sb.auth.getSession()
    if (error && esFalloDeSesion(error)) { vencida(); return false }
    let ses = data?.session
    if (!ses) { vencida(); return false }
    const faltan = (ses.expires_at || 0) - Math.floor(Date.now() / 1000)
    if (faltan < RENOVAR_ANTES_S) {
      const r = await sb.auth.refreshSession()
      if (r.error) {
        if (esFalloDeSesion(r.error) && navigator.onLine !== false) { vencida(); return false }
        return true
      }
      ses = r.data?.session || ses
    }

    const emp = guardada.empresaId || obtenerEmpresaActiva()
    if (emp) { try { await fijarEmpresaSesion(emp) } catch {  } }
    try { window.dispatchEvent(new Event('pos-reanudar')) } catch {  }
    return true
  } catch (e) {
    return !esFalloDeSesion(e)
  } finally { enCurso = false }
}

export function iniciarGuardiaSesion(onVencida) {
  alVencer = onVencida
  try { navigator.storage?.persist?.() } catch {  }
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
