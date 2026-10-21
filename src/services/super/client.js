// Mismo cliente que el resto de la app (misma sesión): un segundo createClient con la misma llave de
// almacenamiento provoca el aviso «Multiple GoTrueClient instances detected».
import { sb } from '../supabaseClient.js'
export { sb }

export const CONFIG_FALTA = 'Falta la configuración de Supabase (SUPABASE_URL / SUPABASE_ANON_KEY en src/services/config.js). El panel de super necesita una base real.'
export const SIN_SESION = 'No hay sesión iniciada. Entra en POS Control con el correo del super administrador y vuelve a intentarlo.'
const NO_SUPER = 'Este usuario no es super administrador: el panel solo está disponible para el dueño de la plataforma.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = v => typeof v === 'string' && UUID_RE.test(v.trim())

export function mensajeError(e) {
  const bruto = String((e && (e.message || e.error_description || e.hint)) || e || '')
  const t = bruto.trim()
  if (!t || t === '[object Object]') return 'Error inesperado al hablar con Supabase. Revisa la consola.'
  if (/requiere super/i.test(t)) return NO_SUPER
  if (/sin ?sesion/i.test(t)) return SIN_SESION
  if (/no pertenece a esa empresa/i.test(t)) return 'No puedes operar esa empresa: ni eres super administrador ni tienes membresía en ella.'
  if (/empresa inexistente/i.test(t)) return 'La empresa ya no existe en esta base de datos.'
  if (/snapshot invalido/i.test(t)) return 'El respaldo no es válido: falta la información de la empresa.'
  if (/ya existe/i.test(t)) return t.replace(/ya existe/i, 'ya está en uso. Escribe un código distinto.')
  if (/Failed to fetch|NetworkError|fetch failed/i.test(t)) return 'Sin conexión con Supabase. Comprueba tu internet y vuelve a intentarlo.'
  if (/permission denied/i.test(t)) return 'La base denegó esa función: este usuario no está en public.supers.'

  return t.charAt(0).toUpperCase() + t.slice(1)
}

export async function haySesion() {
  if (!sb) return false
  try {
    const { data } = await sb.auth.getSession()
    return Boolean(data?.session?.access_token)
  } catch {
    return false
  }
}

export async function rpcSuper(nombre, params = {}) {
  if (!sb) throw new Error(CONFIG_FALTA)
  if (!(await haySesion())) throw new Error(SIN_SESION)
  const { data, error } = await sb.rpc(nombre, params)
  if (error) throw new Error(mensajeError(error))
  return data
}
