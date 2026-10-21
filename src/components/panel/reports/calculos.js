// Cálculos de reportes por periodo: funciones puras, sin React.
import { round2 } from '../../../services/format.js'
import { areasDelItem } from '../../../services/printing.js'
import { MONEDA } from '../../../services/config.js'

const p2 = n => String(n).padStart(2, '0')

// «YYYY-MM-DD» en hora local (clave de día para agrupar y para inputs type=date).
export const fechaClave = ts => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }

const vivos = c => (c.items || []).filter(i => i.estado !== 'anulado')
const totalCuenta = c => round2(vivos(c).reduce((t, i) => t + (Number(i.precio) || 0) * (Number(i.qty) || 0), 0))
const totalFinal = c => round2(Math.max(0, totalCuenta(c) - (Number(c.descuento) || 0)) + (Number(c.propina) || 0))
const pagadoCuenta = c => round2((c.pagos || []).reduce((t, p) => t + (Number(p.monto) || 0), 0))

// Acepta epoch ms o string ISO (la RPC puede devolver fechas en texto).
export const aMs = v => (typeof v === 'number' ? v : v ? new Date(v).getTime() || 0 : 0)

// ── Rangos de periodo ────────────────────────────────────────────────────────
export const rangoHoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return { desde: d.getTime(), hasta: Date.now() } }
export const rangoUltimos7 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return { desde: d.getTime(), hasta: Date.now() } }
export const rangoMesActual = () => { const d = new Date(); return { desde: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), hasta: Date.now() } }
export const rangoMesPasado = () => {
  const d = new Date()
  return { desde: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), hasta: new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999).getTime() }
}
// null si alguna fecha está vacía o invierte el rango.
export const rangoDeFechas = (desdeTxt, hastaTxt) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeTxt || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hastaTxt || '')) return null
  const d = new Date(`${desdeTxt}T00:00:00`), h = new Date(`${hastaTxt}T23:59:59`)
  if (Number.isNaN(d.getTime()) || Number.isNaN(h.getTime()) || h < d) return null
  return { desde: d.getTime(), hasta: h.getTime() }
}

const etiquetaMesa = (s, c) => {
  const nombres = (c.mesaIds || []).map(id => (s.mesas || []).find(m => m.id === id)?.nombre).filter(Boolean)
  if (nombres.length) return nombres.join(', ')
  return c.canal === 'llevar' ? 'Para llevar' : 'Mostrador'
}

// Resumen del periodo a partir del estado local (misma forma que la RPC reportes_resumen).
// Ventas del periodo = cuentas cerradas con cerradaEn dentro del rango.
export function resumenDeCuentas(estado, desde, hasta) {
  const s = estado || {}
  const cuentas = s.cuentas || []
  const cerradas = cuentas.filter(c => c.estado === 'cerrada' && aMs(c.cerradaEn) >= desde && aMs(c.cerradaEn) <= hasta)

  let bruto = 0, descuentos = 0, propinas = 0, total = 0, personas = 0
  cerradas.forEach(c => {
    bruto += totalCuenta(c)
    descuentos += Number(c.descuento) || 0
    propinas += Number(c.propina) || 0
    total += totalFinal(c)
    personas += Math.max(1, Number(c.comensales) || 1)
  })
  bruto = round2(bruto); descuentos = round2(descuentos); propinas = round2(propinas); total = round2(total)

  const porMetodo = {}
  cerradas.forEach(c => (c.pagos || []).forEach(p => {
    const k = ['efectivo', 'qr', 'tarjeta'].includes(p.metodo) ? p.metodo : 'mixed'
    const x = (porMetodo[k] ||= { monto: 0, ids: new Set() })
    x.monto = round2(x.monto + (Number(p.monto) || 0))
    x.ids.add(c.id)
  }))
  const por_metodo = Object.entries(porMetodo).map(([metodo, x]) => ({ metodo, monto: x.monto, cuentas: x.ids.size })).sort((a, b) => b.monto - a.monto)

  const porDia = {}
  cerradas.forEach(c => {
    const k = fechaClave(aMs(c.cerradaEn))
    const x = (porDia[k] ||= { monto: 0, cuentas: 0 })
    x.monto = round2(x.monto + totalFinal(c)); x.cuentas += 1
  })
  const por_dia = Object.entries(porDia).map(([dia, x]) => ({ dia, monto: x.monto, cuentas: x.cuentas })).sort((a, b) => (a.dia < b.dia ? -1 : 1))

  const porUsuario = {}
  cerradas.forEach(c => {
    const u = c.abiertaPor || c.cerradaPor || '—'
    const x = (porUsuario[u] ||= { monto: 0, n: 0 })
    x.monto = round2(x.monto + totalFinal(c)); x.n += 1
  })
  const por_usuario = Object.entries(porUsuario).map(([usuario, x]) => ({ usuario, monto: x.monto, cuentas: x.n })).sort((a, b) => b.monto - a.monto)

  const porMesa = {}
  cerradas.forEach(c => {
    const k = etiquetaMesa(s, c)
    const x = (porMesa[k] ||= { monto: 0, n: 0 })
    x.monto = round2(x.monto + totalFinal(c)); x.n += 1
  })
  const por_mesa = Object.entries(porMesa).map(([mesa, x]) => ({ mesa, monto: x.monto, cuentas: x.n })).sort((a, b) => b.monto - a.monto)

  const porArea = {}
  const productos = s.productos || []
  cerradas.forEach(c => vivos(c).forEach(i => {
    const area = (areasDelItem(i, productos) || ['cocina']).find(a => a !== 'caja') || 'cocina'
    porArea[area] = (porArea[area] || 0) + (Number(i.qty) || 0)
  }))
  const por_area = Object.entries(porArea).map(([area, qty]) => ({ area, qty })).sort((a, b) => b.qty - a.qty)

  const prods = {}
  cerradas.forEach(c => vivos(c).forEach(i => {
    const f = (prods[i.nombre] ||= { nombre: i.nombre, qty: 0, importe: 0 })
    f.qty += Number(i.qty) || 0
    f.importe = round2(f.importe + (Number(i.precio) || 0) * (Number(i.qty) || 0))
  }))
  const productosTop = Object.values(prods).sort((a, b) => b.qty - a.qty || b.importe - a.importe)

  const devs = {}
  ;(s.devoluciones || []).filter(x => aMs(x.pedidaEn) >= desde && aMs(x.pedidaEn) <= hasta).forEach(x => {
    const f = (devs[x.nombre] ||= { nombre: x.nombre, qty: 0, monto: 0 })
    f.qty += Number(x.qty) || 0
    f.monto = round2(f.monto + (Number(x.monto) || 0))
  })
  const devoluciones = Object.values(devs).sort((a, b) => b.monto - a.monto)

  const pendientes = cuentas.filter(c => c.estado !== 'cerrada').map(c => {
    const t = totalFinal(c), pg = pagadoCuenta(c)
    return {
      cuenta_id: c.id,
      mesa: c.canal === 'llevar' && c.clienteNombre ? `${etiquetaMesa(s, c)} · ${c.clienteNombre}` : etiquetaMesa(s, c),
      total: t, pagado: pg, saldo: round2(Math.max(0, t - pg)),
      abierta_en: aMs(c.abiertaEn) || 0, mesero: c.abiertaPor || c.cerradaPor || '—',
    }
  }).filter(x => x.saldo > 0.01)

  return {
    desde, hasta, moneda: s.config?.moneda || MONEDA,
    totales: {
      cuentas: cerradas.length, personas, bruto, descuentos, propinas, total,
      ticket: cerradas.length ? round2(total / cerradas.length) : 0,
      por_persona: personas ? round2(total / personas) : 0,
    },
    por_metodo, por_dia, por_usuario, por_mesa, por_area,
    productos: productosTop, devoluciones, pendientes,
  }
}

// ── CSV (patrón de AuditPage: BOM, comas escapadas, blob descargable) ────────
export function csvDe(columnas, filas) {
  const limpiar = v => {
    const txt = String(v ?? '')
    return /["\n\r,]/.test(txt) ? `"${txt.replaceAll('"', '""')}"` : txt
  }
  return [columnas, ...filas].map(fila => fila.map(limpiar).join(',')).join('\r\n')
}

export function bajarCsv(nombre, texto) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Un solo CSV con todas las secciones, cada una precedida por su línea de título.
export function csvDeSecciones(secciones) {
  return secciones.map(sec => `${sec.titulo}\r\n${csvDe(sec.columnas, sec.filas)}`).join('\r\n\r\n')
}
