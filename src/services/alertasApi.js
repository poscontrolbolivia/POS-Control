import { sb } from './supabaseClient.js'

const TIPOS = ['general', 'cocina', 'cobro', 'inventario', 'mesa']
const LIMITE_TITULO = 80
const LIMITE_MENSAJE = 240
const PRIORIDAD_MIN = 1
const PRIORIDAD_MAX = 9

// Acepta epoch en ms o en segundos y también texto ISO/timestamptz.
const aMs = v => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return n > 1e11 ? n : n * 1000
  }
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

const aTexto = (v, max) => String(v ?? '').slice(0, max)

const aPrioridad = v => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 5
  return Math.min(PRIORIDAD_MAX, Math.max(PRIORIDAD_MIN, n))
}

// creada_por / resuelta_por son uuid de auth.users: no son legibles, así que viajan en su propio
// campo y el nombre se busca en la lista que ya trae el store (creadaPorNombre).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const autorLegible = v => {
  const txt = String(v ?? '').trim()
  return txt && !UUID.test(txt) ? txt : ''
}

const campo = (f, ...nombres) => {
  for (const k of nombres) if (f[k] !== undefined && f[k] !== null) return f[k]
  return null
}

export function normalizarAlerta(fila) {
  if (!fila) return null
  const tipo = TIPOS.includes(fila.tipo) ? fila.tipo : 'general'
  const resueltaEn = aMs(campo(fila, 'resuelta_en', 'resolved_at', 'resueltaEn'))
  const creadaPorId = campo(fila, 'creada_por', 'created_by', 'creadaPorId')
  const resueltaPorId = campo(fila, 'resuelta_por', 'resolved_by', 'resueltaPorId')
  return {
    id: fila.id,
    tipo,
    titulo: aTexto(campo(fila, 'titulo', 'title'), LIMITE_TITULO),
    mensaje: aTexto(campo(fila, 'mensaje', 'message'), LIMITE_MENSAJE),
    cuentaId: campo(fila, 'cuenta_id', 'cuentaId', 'account_id'),
    mesaId: campo(fila, 'mesa_id', 'mesaId', 'table_id'),
    prioridad: aPrioridad(campo(fila, 'prioridad', 'priority')),
    creadaPor: autorLegible(campo(fila, 'creadaPorNombre', 'creada_por_nombre', 'creador_nombre')) || autorLegible(creadaPorId),
    creadaPorId: creadaPorId || null,
    creadaEn: aMs(campo(fila, 'creada_en', 'created_at', 'creadaEn')) || 0,
    resueltaPor: autorLegible(campo(fila, 'resueltaPorNombre', 'resuelta_por_nombre', 'resolver_nombre')) || autorLegible(resueltaPorId),
    resueltaPorId: resueltaPorId || null,
    resueltaEn,
  }
}

// Cambia los uuid por el nombre que ya trae el store, sin pedir una query extra.
export function conNombres(alertas, mapaNombres) {
  const nombre = id => (mapaNombres && typeof mapaNombres.get === 'function' ? mapaNombres.get(id) : mapaNombres?.[id]) || ''
  return (Array.isArray(alertas) ? alertas : []).map(a => {
    if (!a) return a
    const creadaPor = a.creadaPor || nombre(a.creadaPorId) || ''
    const resueltaPor = a.resueltaPor || nombre(a.resueltaPorId) || ''
    return creadaPor === a.creadaPor && resueltaPor === a.resueltaPor ? a : { ...a, creadaPor, resueltaPor }
  })
}

// Nunca lanza: si no hay Supabase o la query falla, la pantalla sigue con lo que tenga en memoria.
export async function cargarAlertas() {
  if (!sb) return []
  try {
    const { data, error } = await sb.from('alertas').select('*').order('creada_en', { ascending: false }).limit(300)
    if (error) return []
    return (Array.isArray(data) ? data : []).map(normalizarAlerta).filter(Boolean)
  } catch {
    return []
  }
}

export const contarAbiertas = alertas => (Array.isArray(alertas) ? alertas : [])
  .filter(a => a && a.resueltaEn == null).length

