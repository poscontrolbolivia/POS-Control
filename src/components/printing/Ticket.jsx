import { MONEDA } from '../../services/config'
import { totalCuenta, totalFinal, pagadoCuenta } from '../../context/StoreContext.jsx'
import { gruposDe, grupoTickets, repartirPorGrupo, areasDelItem, opcionesDeGrupo } from '../../services/printing.js'
import { despachar } from '../../services/printDispatch.js'
import { tGlobal, existeClave } from '../../i18n/index.jsx'

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
const cap = x => x ? x.charAt(0).toUpperCase() + x.slice(1) : ''

export const precalcularCambio = (pagos = [], total = 0) => {
  const num = p => Number(p?.monto) || 0
  const efectivo = (pagos || []).filter(p => p?.metodo === 'efectivo').reduce((acc, p) => acc + num(p), 0)
  if (!efectivo) return 0
  const otros = (pagos || []).filter(p => p && p.metodo !== 'efectivo').reduce((acc, p) => acc + Math.min(num(p), Number(total) || 0), 0)
  const falta = Math.max(0, round2(Number(total) || 0) - otros)
  return round2(Math.max(0, efectivo - falta))
}

const nombreMetodo = m => (existeClave('metodo.' + m) ? tGlobal('metodo.' + m) : cap(String(m || tGlobal('metodo.otro'))))

const nombreArea = (id, config) => {
  const g = gruposDe(config).find(x => x.id === id)
  if (g) return String(g.nombre).toUpperCase()
  return (existeClave('areas.' + id) ? tGlobal('areas.' + id) : cap(String(id))).toUpperCase()
}
const prefijoAreas = (i, config) => {
  const areas = Array.isArray(i.areas) ? i.areas : []
  return areas.length > 1 ? `[${areas.map(a => nombreArea(a, config)).join('+')}] ` : ''
}

function lineasPlanas({ cuenta, config = {}, titulo, comanda = false, ancho = 32 }) {
  const moneda = config?.moneda || MONEDA
  const m = n => `${moneda} ${round2(n).toFixed(2)}`
  const sep = { texto: '', guion: true }
  const fila = (l, r, extras = {}) => ({ texto: `${l}\t${r}`, guion: true, ...extras })
  const ts = cuenta.cerradaEn || cuenta.abiertaEn || Date.now()
  const fecha = new Date(ts).toLocaleString()
  const L = []

  L.push({ texto: (titulo || config?.nombre || 'POS Control').toUpperCase(), negrita: true, centrado: true, tam: 2 })
  L.push({ texto: fecha, centrado: true })
  if (cuenta.tipo === 'directa') L.push({ texto: tGlobal('ticket.turnoValor', { n: cuenta.numero ?? '—' }) })
  else L.push({ texto: tGlobal('ticket.mesaValor', { mesa: cuenta.mesaTexto || (cuenta.mesaIds || []).join(', ') || '—' }) })
  if (cuenta.abiertaPor) L.push({ texto: tGlobal('ticket.atendioValor', { usuario: cuenta.abiertaPor }) })
  L.push(sep)

  const itemsVivos = (cuenta.items || []).filter(i => i.estado !== 'anulado')

  if (comanda) {
    const cocina = itemsVivos.filter(i => i.estado === 'pendiente' || i.estado === 'enviado')
    if (!cocina.length) L.push({ texto: tGlobal('ticket.sinPedidos'), centrado: true })
    cocina.forEach(i => {
      L.push({ texto: `${prefijoAreas(i, config)}${i.qty} x ${i.nombre}`, negrita: true })
      if (i.nota) L.push({ texto: `    ** ${i.nota} **`, negrita: true })
    })
    L.push(sep)
    L.push({ texto: tGlobal('ticket.emitidoValor', { fecha }) })
  } else {
    const anulados = (cuenta.items || []).filter(i => i.estado === 'anulado')
    if (!itemsVivos.length && !anulados.length) L.push({ texto: tGlobal('ticket.sinItems'), centrado: true })
    itemsVivos.forEach(i => {
      L.push(fila(`${i.qty} x ${i.nombre}`, m(i.precio * i.qty)))
      if (i.nota) L.push({ texto: `   · ${i.nota}` })
    })
    anulados.forEach(i => {
      L.push({ texto: `${i.qty} x ${i.nombre} ${tGlobal('ticket.anulado')}\t${m(0)}`, guion: true, negrita: false })
      if (i.motivo) L.push({ texto: `   · ${tGlobal('ticket.motivo')} ${i.motivo}` })
    })
    L.push(sep)
    const sub = totalCuenta(cuenta)
    const desc = round2(cuenta.descuento || 0)
    const prop = round2(cuenta.propina || 0)
    const total = totalFinal(cuenta)
    if (desc || prop) {
      L.push(fila(tGlobal('ticket.subtotal'), m(sub)))
      if (desc) L.push(fila(tGlobal('ticket.descuento'), '-' + m(desc)))
      if (prop) L.push(fila(tGlobal('ticket.propina'), m(prop)))
    }
    L.push(fila(tGlobal('ticket.total'), m(total), { negrita: true, tam: 2 }))
    const pctSug = Number(config?.propinaPct) || 0
    if (!config?.propinaIncluida && pctSug > 0 && !prop && cuenta.estado !== 'cerrada' && total > 0) {
      L.push(fila(tGlobal('ticket.propinaSugerida', { pct: pctSug }), m(round2(Math.max(0, sub - desc) * pctSug / 100))))
    }
    const pagos = cuenta.pagos || []
    if (pagos.length) {
      const porMetodo = {}
      pagos.forEach(p => { const k = p.metodo || 'otro'; porMetodo[k] = round2((porMetodo[k] || 0) + (Number(p.monto) || 0)) })
      L.push(sep)
      Object.entries(porMetodo).forEach(([met, monto]) => L.push(fila(nombreMetodo(met), m(monto))))
      const cambios = round2(pagos.reduce((acc, p) => acc + (Number(p.cambio) || 0), 0))
      const cambio = cambios || Math.max(0, round2(pagadoCuenta(cuenta) - total))
      if (cambio > 0.009) L.push(fila(tGlobal('ticket.cambio'), m(cambio)))
    }
    L.push({ texto: tGlobal('ticket.gracias'), centrado: true, negrita: true })
  }
  return L
}

const trabajoDe = ({ cuenta, config, titulo, comanda, grupoId, cols }) => {
  const { copias, pie, corte } = opcionesDeGrupo(config, grupoId)
  const lineas = lineasPlanas({ cuenta, config, titulo, comanda, ancho: cols })
  if (pie) {
    lineas.push({ texto: '', guion: true })
    pie.split('\n').slice(0, 3).forEach(x => lineas.push({ texto: x, negrita: true, centrado: true }))
  }
  return {
    grupo: grupoId,
    titulo: titulo || (comanda ? tGlobal('ticket.comanda') : tGlobal('ticket.titulo')),
    payload: { lineas, ancho: cols, corte, copias, beep: Boolean(config?.impresoraBeep) },
  }
}

export async function imprimirCuenta({ cuenta, config = {}, titulo, comanda = false, grupo, ancho } = {}) {
  if (!cuenta) return null
  const g = comanda ? gruposDe(config).find(x => x.id === grupo) : (grupoTickets(config) || gruposDe(config)[0])
  const grupoId = g?.id || grupo || 'general'
  const cols = Number(ancho) || Number(g?.ancho) || Number(config?.impresoraAncho) || 32
  const [resultado] = await despachar([trabajoDe({ cuenta, config, titulo, comanda, grupoId, cols })], config)
  return resultado
}

export async function imprimirComandas({ cuenta, items, productos = [], config = {}, titulo }) {

  const itemsAreas = items.map(i => {
    const a = areasDelItem(i, productos)
    return a && !i.areas ? { ...i, areas: a } : i
  })
  const reparto = repartirPorGrupo(itemsAreas, productos, config)
  const resultados = await despachar(reparto.map(({ grupo, items: its }) => trabajoDe({
    cuenta: { ...cuenta, items: its }, config, titulo: `${titulo} · ${grupo.nombre}`, comanda: true,
    grupoId: grupo.id, cols: Number(grupo.ancho) || Number(config?.impresoraAncho) || 32,
  })), config)
  return reparto.map(({ grupo, items: its }, i) => ({ grupo, resultado: resultados[i], n: its.length }))
}
