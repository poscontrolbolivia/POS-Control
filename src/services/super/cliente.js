// Cliente Supabase del carril SUPER ADMIN.
// Se construye aquí (y no se importa desde src/services/supabase.js) para que el panel
// no se rompa si el otro carril reorganiza su capa de datos: supabase-js guarda la sesión
// en localStorage con una clave derivada de la URL, así que el login normal de LoginPage
// ya sirve y no hay que volver a autenticarse.
// SEGURIDAD: solo se usan RPCs `security definer` del proyecto (es_super, super_listar_empresas,
// super_exportar_empresa, super_importar_empresa, fijar_empresa). Jamás una service key en el
// navegador: la anon/publishable key es pública por diseño y quien manda es RLS + es_super().
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, USAR_SUPABASE } from '../../config.js'

export const sb = USAR_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

// Mensajes base, reutilizables en la UI.
export const CONFIG_FALTA = 'Falta la configuración de Supabase (SUPABASE_URL / SUPABASE_ANON_KEY en src/config.js). El panel de super necesita una base real.'
export const SIN_SESION = 'No hay sesión iniciada. Entra en POS Control con el correo del super administrador y vuelve a intentarlo.'
export const NO_SUPER = 'Este usuario no es super administrador: el panel solo está disponible para el dueño de la plataforma.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = v => typeof v === 'string' && UUID_RE.test(v.trim())

// Traduce a español legible los `raise exception` de la migración setup.sql y los
// fallos de red/cliente. Nunca devolvemos un objeto raro a la UI.
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
  // Los mensajes que ya vienen en español de la base se muestran tal cual, con la inicial en mayúscula.
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// true si hay un token de auth guardado (el panel no debe intentar RPCs anónimas).
export async function haySesion() {
  if (!sb) return false
  try {
    const { data } = await sb.auth.getSession()
    return Boolean(data?.session?.access_token)
  } catch {
    return false
  }
}

// Llamada RPC normalizada del panel: si falta configuración o sesión, lanza error en español
// (el componente lo muestra; nunca dejamos un pantallazo blanco).
export async function rpcSuper(nombre, params = {}) {
  if (!sb) throw new Error(CONFIG_FALTA)
  if (!(await haySesion())) throw new Error(SIN_SESION)
  const { data, error } = await sb.rpc(nombre, params)
  if (error) throw new Error(mensajeError(error))
  return data
}
