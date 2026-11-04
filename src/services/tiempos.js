// Tiempos de preparación por área: desde que un ítem se envía al área hasta que el área lo saca.
// Un combo que va a cocina y barra cuenta UNA fila por área (cada área con su propio tiempo).
import { areasDelItem } from './printing.js'

const MAX_MS = 6 * 3600000 // más de 6 h casi seguro es un plato olvidado: no entra al promedio
const ms = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null }

// Duración legible: «45 s», «12 min», «1 h 05 min».
export function formatoDuracion(n) {
  if (!Number.isFinite(n) || n < 0) return ''
  const s = Math.round(n / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

// Servidor: una fila por ítem y por área ya sacada dentro del rango (ver tiempos_preparacion en el SQL).
export async function cargarTiempos(desde, hasta) {
  const { rpc } = await import('./supabaseClient.js')
  const r = await rpc('tiempos_preparacion', { p_desde: new Date(desde).toISOString(), p_hasta: new Date(hasta).toISOString() })
  return (Array.isArray(r) ? r : []).map(x => ({
    nombre: x.nombre, productoId: x.producto_id || null, qty: Number(x.qty) || 1, area: x.area,
    enviadoEn: ms(x.enviado_en), listoEn: ms(x.listo_en),
  }))
}

// En memoria (demo, o respaldo si el servidor no responde). Usa los tiempos por área si el ítem los trae (areasEn);
// si no, solo sirve para ítems de una sola área.
export function filasLocales(cuentas, desde, hasta, productos = []) {
  const filas = []
  ;(cuentas || []).forEach(c => (c.items || []).forEach(i => {
    if (!i.enviadoEn || i.estado === 'anulado') return
    const base = { nombre: i.nombre, productoId: i.productoId || null, qty: Number(i.qty) || 1, enviadoEn: i.enviadoEn }
    if (i.areasEn && Object.keys(i.areasEn).length) {
      Object.entries(i.areasEn).forEach(([area, listoEn]) => filas.push({ ...base, area, listoEn }))
    } else if (i.estado === 'listo' && i.listoEn) {
      const ars = (areasDelItem(i, productos) || ['cocina']).filter(a => a !== 'caja')
      if (ars.length === 1) filas.push({ ...base, area: ars[0], listoEn: i.listoEn })
    }
  }))
  return filas.filter(f => f.listoEn >= desde && f.listoEn <= hasta)
}

// → [{ id, nombre, n, promedio, filas: [{ nombre, n, promedio, min, max }] }], cocina y barra primero.
export function agruparTiempos(filas, nombreArea = a => a, limite = null) {
  const por = {}
  ;(filas || []).forEach(f => {
    const d = (f.listoEn ?? NaN) - (f.enviadoEn ?? NaN)
    if (!(d >= 0) || d > MAX_MS || !f.area) return
    const q = Number(f.qty) || 1
    const A = (por[f.area] ||= { id: f.area, nombre: nombreArea(f.area), n: 0, suma: 0, filas: {} })
    const p = (A.filas[f.productoId || f.nombre] ||= { nombre: f.nombre, n: 0, suma: 0, min: Infinity, max: 0 })
    p.n += q; p.suma += d * q; p.min = Math.min(p.min, d); p.max = Math.max(p.max, d)
    A.n += q; A.suma += d * q
  })
  const orden = id => (id === 'cocina' ? 0 : id === 'barra' ? 1 : 2)
  return Object.values(por).map(A => {
    let lista = Object.values(A.filas).sort((a, b) => b.n - a.n || (a.nombre > b.nombre ? 1 : -1))
    if (limite) lista = lista.slice(0, limite)
    return { id: A.id, nombre: A.nombre, n: A.n, promedio: A.suma / A.n, filas: lista.map(p => ({ nombre: p.nombre, n: p.n, promedio: p.suma / p.n, min: p.min, max: p.max })) }
  }).sort((a, b) => orden(a.id) - orden(b.id))
}
