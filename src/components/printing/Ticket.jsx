import { MONEDA, VERSION } from '../../services/config'
import { totalCuenta, totalFinal, pagadoCuenta } from '../../context/StoreContext.jsx'
import { gruposDe, grupoTickets, repartirPorGrupo, areasDelItem, opcionesDeGrupo } from '../../services/printing.js'
import { lineasComanda } from '../../services/comanda.js'
import { despachar } from '../../services/printDispatch.js'
import { tGlobal, existeClave } from '../../i18n/index.jsx'
import { round2 } from '../../services/format.js'
import { formatearMonto } from '../../services/money.js'

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

// El papel es monoespaciado: las columnas se arman aquí con espacios. Si se mandara un
// tabulador, la vista de Windows, el agente y la impresora ESC/POS lo abrirían distinto.
const colIzq = (x, n) => String(x ?? '').padEnd(n).slice(0, n)
const colDer = (x, n) => String(x ?? '').padStart(n)
// Cuatro columnas separadas por un blanco: cantidad, descripción, precio unitario e importe.
// Las dos últimas van a la derecha para que los puntos decimales queden en la misma columna.
const columnas = ancho => {
  const nU = ancho >= 42 ? 8 : 6, nT = ancho >= 42 ? 8 : 7, nC = 4
  return [nC, ancho - nC - nU - nT - 3, nU, nT]
}
const demas = (texto, n) => Math.max(0, String(texto).length - n)

// Ningún dato del ticket se pierde por un recorte: lo que no cabe en su columna continúa en
// la línea siguiente, partiendo por palabras y solo cortando de golpe una palabra imposible.
const ajustado = (texto, n) => {
  const t = String(texto ?? '').trim()
  if (n <= 0 || t.length <= n) return [t]
  const out = []
  let linea = ''
  for (const w of t.split(/\s+/)) {
    if (!linea) linea = w
    else if ((linea + ' ' + w).length <= n) linea += ' ' + w
    else { out.push(linea); linea = w }
    while (linea.length > n) { out.push(linea.slice(0, n)); linea = linea.slice(n) }
  }
  if (linea) out.push(linea)
  return out
}

export function lineasPlanas({ cuenta, config = {}, titulo, comanda = false, ancho = 32, datos = {} }) {
  const moneda = config?.moneda || MONEDA
  const m = n => formatearMonto(n, moneda)
  const sin = n => round2(n).toFixed(2)
  const sep = { texto: '', guion: true }
  const L = []
  const suelta = (texto, n = ancho, extras = {}) => ajustado(texto, n).forEach(x => L.push({ texto: x, ...extras }))
  const fechaDe = ts => {
    const d = new Date(ts || Date.now())
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  if (comanda) {
    const cocina = (cuenta.items || []).filter(i => i.estado === 'pendiente' || i.estado === 'enviado')
    lineasComanda({
      items: cocina.map(i => ({ qty: i.qty, nombre: `${prefijoAreas(i, config)}${i.nombre}`, nota: i.nota })),
      areaNombre: datos.areaNombre || '',
      salon: datos.salon || '',
      mesa: cuenta.mesaTexto || datos.mesa || (cuenta.mesaIds || []).join(', ')
        || (cuenta.canal === 'mostrador' ? tGlobal('venta.mostrador') : '—'),
      enviadoPor: cuenta.abiertaPor || '',
      en: cuenta.abiertaEn || Date.now(),
      tr: tGlobal, ancho,
    }).forEach(l => (l.guion ? L.push(sep) : suelta(l.texto, ancho, { negrita: l.negrita, centrado: l.centrado })))
    return L
  }

  // ── TICKET DE CUENTA ─────────────────────────────────────────────────────
  // `grande` es cuerpo doble: el ancho útil se parte a la mitad, así que el texto se prueba
  // primero a ese ancho (el nombre del negocio puede quedar en 2 o 3 renglones dobles) y solo
  // baja a cuerpo normal cuando ni siquiera repartido cabe. Con `entero` no se parte: si el
  // nombre de una persona no cabe en un renglón doble, se imprime en cuerpo normal.
  const centro = (texto, { grande = false, entero = false, ...extras } = {}) => {
    if (!texto) return
    const t = String(texto)
    let tam = 1
    let partes = ajustado(t, ancho)
    if (grande) {
      const enMedio = ajustado(t, Math.floor(ancho / 2))
      if (enMedio.length <= (entero ? 1 : 3)) { tam = 2; partes = enMedio }
    }
    partes.forEach(x => L.push({ texto: x, centrado: true, tam, ...extras }))
  }
  const [nC, nD, nU, nT] = columnas(ancho)

  centro((config?.nombre || 'POS Control').toUpperCase(), { grande: true })
  centro(config?.sucursal, { negrita: true })
  centro(config?.direccion)
  centro([config?.telefono && `Tel ${config.telefono}`, config?.nit && `NIT ${config.nit}`].filter(Boolean).join('  ·  '))
  L.push(sep)

  // Salón · mesa (o mostrador) y mesero, un cuerpo más grande que el resto del ticket.
  const mesa = datos.mesa || titulo || (cuenta.canal === 'llevar'
    ? tGlobal('ticket.llevarValor', { n: cuenta.numero ?? '—' })
    : cuenta.tipo === 'directa'
    ? tGlobal('ticket.turnoValor', { n: cuenta.numero ?? '—' })
    : tGlobal('ticket.mesaValor', { mesa: cuenta.mesaTexto || (cuenta.mesaIds || []).join(', ') || '—' }))
  // Salón y mesa, cada uno en su renglón y en cuerpo doble; el que atiende justo debajo.
  if (datos.salon) centro(String(datos.salon).toUpperCase(), { grande: true })
  centro(String(mesa).toUpperCase(), { grande: true })
  if (cuenta.canal === 'llevar' && (cuenta.clienteNombre || cuenta.clienteTel)) centro([cuenta.clienteNombre, cuenta.clienteTel].filter(Boolean).join(' · '), { grande: true, entero: true })
  if (cuenta.abiertaPor) centro(tGlobal(cuenta.tipo === 'directa' ? 'ticket.cajeroValor' : 'ticket.meseroValor', { usuario: cuenta.abiertaPor }), { grande: true, entero: true })
  L.push(sep)

  const mitad = Math.ceil(ancho / 2)
  L.push({ texto: colIzq(tGlobal('ticket.ordenValor', { n: datos.orden ?? cuenta.numero ?? '—' }), mitad)
    + colDer(tGlobal('ticket.personasValor', { n: cuenta.comensales ?? '—' }), ancho - mitad) })
  suelta(tGlobal('ticket.abrioValor', { fecha: fechaDe(cuenta.abiertaEn || Date.now()) }))
  if (cuenta.cerradaEn) suelta(tGlobal('ticket.cobroValor', { fecha: fechaDe(cuenta.cerradaEn) }))
  if (cuenta.cerradaPor) suelta(tGlobal('ticket.cajeroValor', { usuario: cuenta.cerradaPor }))
  L.push(sep)

  const itemsVivos = (cuenta.items || []).filter(i => i.estado !== 'anulado')
  const anulados = (cuenta.items || []).filter(i => i.estado === 'anulado')

  L.push({ texto: colIzq(tGlobal('ticket.cant'), nC) + ' ' + colIzq(tGlobal('ticket.desc'), nD)
    + ' ' + colDer(tGlobal('ticket.pUnit'), nU) + ' ' + colDer(tGlobal('ticket.importe'), nT) })
  L.push(sep)
  if (!itemsVivos.length && !anulados.length) L.push({ texto: tGlobal('ticket.sinItems'), centrado: true })
  const filaItem = (i, anulado = false) => {
    const punit = anulado ? '—' : sin(i.precio)
    const importe = anulado ? sin(0) : sin(i.precio * i.qty)
    // Un monto con más cifras de las previstas no se corta: le roba columnas a la descripción.
    const wU = nU + demas(punit, nU), wT = nT + demas(importe, nT)
    const nDtil = Math.max(4, nD - (wU - nU) - (wT - nT))
    const filas = ajustado(anulado ? `${i.nombre} ${tGlobal('ticket.anulado')}` : i.nombre, nDtil)
    L.push({ texto: colIzq(anulado ? '—' : i.qty, nC) + ' ' + colIzq(filas[0], nDtil)
      + ' ' + colDer(punit, wU) + ' ' + colDer(importe, wT) })
    filas.slice(1).forEach(x => L.push({ texto: ' '.repeat(nC + 1) + x }))
    if (i.nota) suelta(`   · ${i.nota}`, ancho)
    if (anulado && i.motivo) suelta(`   · ${tGlobal('ticket.motivo')} ${i.motivo}`, ancho)
  }
  itemsVivos.forEach(i => filaItem(i))
  anulados.forEach(i => filaItem(i, true))
  if (cuenta.detalle) {
    L.push(sep)
    suelta(`${tGlobal('ticket.detalle')}: ${cuenta.detalle}`, ancho)
  }
  L.push(sep)

  const sub = totalCuenta(cuenta)
  const desc = round2(cuenta.descuento || 0)
  const prop = round2(cuenta.propina || 0)
  const total = totalFinal(cuenta)
  const pctSug = Number(config?.propinaPct) || 0
  // Cada cuerpo tiene su propio ancho útil (tam 2 = la mitad de columnas), así que las filas
  // de etiqueta + monto se miden sobre ese ancho y no sobre el del papel. Si el monto no cabe
  // en cuerpo doble se baja a cuerpo normal antes que recortarse.
  const saldoLinea = (l, r, { tam = 1, negrita = false } = {}) => {
    let t = tam, cols = Math.floor(ancho / t)
    if (String(r).length > cols - 6) { t = 1; cols = ancho }
    const mit = Math.min(Math.ceil(cols / 2), cols - String(r).length)
    L.push({ texto: colIzq(l, mit) + colDer(r, cols - mit), tam: t, negrita })
  }
  if (desc || prop) {
    saldoLinea(tGlobal('ticket.subtotal'), m(sub))
    if (desc) saldoLinea(tGlobal('ticket.descuento'), '-' + m(desc))
    if (prop) saldoLinea(tGlobal('ticket.propina'), m(prop))
  }
  saldoLinea(tGlobal('ticket.total'), m(total), { tam: 2, negrita: true })
  if (!config?.propinaIncluida && pctSug > 0 && !prop && cuenta.estado !== 'cerrada' && total > 0) {
    saldoLinea(tGlobal('ticket.propinaSugerida', { pct: pctSug }), m(round2(Math.max(0, sub - desc) * pctSug / 100)))
  }

  const pagos = cuenta.pagos || []
  if (pagos.length) {
    const porMetodo = {}
    pagos.forEach(p => { const k = p.metodo || 'otro'; porMetodo[k] = round2((porMetodo[k] || 0) + (Number(p.monto) || 0)) })
    L.push(sep)
    Object.entries(porMetodo).forEach(([met, monto]) => saldoLinea(nombreMetodo(met), m(monto)))
    const cambios = round2(pagos.reduce((acc, p) => acc + (Number(p.cambio) || 0), 0))
    const cambio = cambios || Math.max(0, round2(pagadoCuenta(cuenta) - total))
    if (cambio > 0.009) saldoLinea(tGlobal('ticket.cambio'), m(cambio))
    // Un abono deja la mesa abierta: el ticket dice qué se cobró y cuánto falta.
    if (cuenta.estado !== 'cerrada') {
      const pagado = pagadoCuenta(cuenta)
      if (pagado > 0.009) {
        pagos.filter(p => p.concepto).forEach(p => suelta(`${tGlobal('ticket.abono')}: ${p.concepto}`))
        saldoLinea(tGlobal('ticket.saldo'), m(round2(Math.max(0, total - pagado))), { negrita: true })
      }
    }
  }

  // Tres renglones punteados: que el cliente anote algo a mano (propina, firma, recordatorio).
  L.push(sep)
  const puntos = '. '.repeat(Math.max(4, Math.floor(ancho / 2))).slice(0, ancho)
  for (let i = 0; i < 3; i++) L.push({ texto: puntos })

  L.push(sep)
  centro(tGlobal('ticket.noFiscal'), { negrita: true })
  if (!config?.propinaIncluida && pctSug > 0) centro(tGlobal('ticket.propinaNoIncluida'))
  centro(tGlobal('ticket.gracias'))
  L.push(sep)
  centro(tGlobal('ticket.marca', { v: VERSION }), { negrita: true })
  return L
}

const trabajoDe = ({ cuenta, config, titulo, comanda, grupoId, cols, datos }) => {
  const { copias, pie, corte } = opcionesDeGrupo(config, grupoId)
  const lineas = lineasPlanas({ cuenta, config, titulo, comanda, ancho: cols, datos })
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

export async function imprimirCuenta({ cuenta, config = {}, titulo, comanda = false, grupo, ancho, datos } = {}) {
  if (!cuenta) return null
  const g = comanda ? gruposDe(config).find(x => x.id === grupo) : (grupoTickets(config) || gruposDe(config)[0])
  const grupoId = g?.id || grupo || 'general'
  const cols = Number(ancho) || Number(g?.ancho) || Number(config?.impresoraAncho) || 32
  const [resultado] = await despachar([trabajoDe({ cuenta, config, titulo, comanda, grupoId, cols, datos })], config)
  return resultado
}

export async function imprimirComandas({ cuenta, items, productos = [], config = {}, titulo, datos = {} }) {

  const itemsAreas = items.map(i => {
    const a = areasDelItem(i, productos)
    return a && !i.areas ? { ...i, areas: a } : i
  })
  const reparto = repartirPorGrupo(itemsAreas, productos, config)
  const resultados = await despachar(reparto.map(({ grupo, items: its }) => trabajoDe({
    cuenta: { ...cuenta, items: its }, config, titulo: `${titulo} · ${grupo.nombre}`, comanda: true,
    grupoId: grupo.id, cols: Number(grupo.ancho) || Number(config?.impresoraAncho) || 32,
    datos: { ...datos, areaNombre: grupo.nombre },
  })), config)
  return reparto.map(({ grupo, items: its }, i) => ({ grupo, resultado: resultados[i], n: its.length }))
}
