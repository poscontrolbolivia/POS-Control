// Ticket / comanda imprimible (IA-2b). Exportaciones nombradas: imprimirTicket, imprimirCuenta, precalcularCambio.
// imprimirTicket → diálogo de impresión vía iframe oculto (opción manual).
// imprimirCuenta → modo silencioso por Web Serial + ESC/POS (impresora térmica USB) con fallback al diálogo.
//
// IDIOMA: estas funciones NO son componentes de React, así que no pueden usar el hook
// useIdioma(); leen el idioma activo con tGlobal() del carril IDIOMAS. El comprobante que
// recibe el cliente sí se traduce; lo que NO se traduce nunca son los bytes ESC/POS ni el
// ancho de línea (32 columnas en 58 mm, 48 en 80 mm), que siguen calculados igual.
import { MONEDA } from '../../config'
import { totalCuenta, totalFinal, pagadoCuenta } from '../../services/store.jsx'
import { imprimirSilencioso, estadoImpresora } from '../../services/impresora.js'
import { gruposDe, grupoTickets, repartirPorGrupo } from '../../services/impresion.js'
import { modoImpresion, encolarImpresion } from '../../services/colaImpresion.js'
import { tGlobal, existeClave, idiomaActivo } from '../../i18n/index.jsx'

const round2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100
const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const cap = x => x ? x.charAt(0).toUpperCase() + x.slice(1) : ''

// Cambio a partir de líneas de pago crudas (monto = recibido). El cambio solo sale del efectivo;
// con pago mixto, el excedente de QR/tarjeta no devuelve dinero.
export const precalcularCambio = (pagos = [], total = 0) => {
  const num = p => Number(p?.monto) || 0
  const efectivo = (pagos || []).filter(p => p?.metodo === 'efectivo').reduce((acc, p) => acc + num(p), 0)
  if (!efectivo) return 0
  const otros = (pagos || []).filter(p => p && p.metodo !== 'efectivo').reduce((acc, p) => acc + Math.min(num(p), Number(total) || 0), 0)
  const falta = Math.max(0, round2(Number(total) || 0) - otros)
  return round2(Math.max(0, efectivo - falta))
}

// Método de pago impreso: etiqueta traducida si existe clave, si no la palabra tal cual.
const nombreMetodo = m => (existeClave('metodo.' + m) ? tGlobal('metodo.' + m) : cap(String(m || tGlobal('metodo.otro'))))

// cuenta: {tipo, numero, mesaIds, items, pagos, descuento, propina, cerradaEn...}
// comanda=true → solo ítems pendientes/enviados con sus notas, sin totales ni pagos (para cocina).
export function imprimirTicket({ cuenta, config = {}, titulo, ancho = 58, comanda = false } = {}) {
  if (!cuenta || typeof document === 'undefined') return
  const moneda = config?.moneda || MONEDA
  const m = n => `${moneda} ${round2(n).toFixed(2)}`
  const chars = ancho >= 70 ? 42 : 32
  const sep = () => `<div class="sep">${'-'.repeat(chars)}</div>`
  const fila = (l, r, cls = '') => `<div class="f${cls}"><span>${esc(l)}</span><span>${esc(r)}</span></div>`

  const ts = cuenta.cerradaEn || cuenta.abiertaEn || Date.now()
  const fecha = new Date(ts).toLocaleString()

  // Dónde: "Turno #n" (venta directa) o mesa(s)
  const destino = cuenta.tipo === 'directa'
    ? fila(tGlobal('ticket.turno'), '#' + (cuenta.numero ?? '—'))
    : fila(tGlobal('ticket.mesa'), cuenta.mesaTexto || (cuenta.mesaIds || []).join(', ') || '—')

  const itemsVivos = (cuenta.items || []).filter(i => i.estado !== 'anulado')
  const itemsCocina = itemsVivos.filter(i => i.estado === 'pendiente' || i.estado === 'enviado')

  let cuerpo = ''

  if (comanda) {
    // Comanda de cocina: cantidad, nombre y notas destacadas.
    cuerpo += itemsCocina.length
      ? itemsCocina.map(i => `<div class="f"><span><b>${i.qty}x ${esc(i.nombre)}</b></span></div>`
        + (i.nota ? `<div class="notax">** ${esc(i.nota)} **</div>` : '')).join('')
      : `<div class="c">${tGlobal('ticket.sinPedidos')}</div>`
    cuerpo += `${sep()}` + fila(tGlobal('ticket.emitido'), fecha)
  } else {
    const anulados = (cuenta.items || []).filter(i => i.estado === 'anulado')
    const lineas = itemsVivos.map(i => fila(`${i.qty} x ${i.nombre}`, m(i.precio * i.qty))
      + (i.nota ? `<div class="nota">· ${esc(i.nota)}</div>` : '')).join('')
    const lineaAnuladas = anulados.map(i => fila(`${i.qty} x ${i.nombre} ${tGlobal('ticket.anulado')}`, m(0), ' tachado')
      + (i.motivo ? `<div class="nota">· ${tGlobal('ticket.motivo')} ${esc(i.motivo)}</div>` : '')).join('')
    const sub = totalCuenta(cuenta)
    const desc = round2(cuenta.descuento || 0)
    const prop = round2(cuenta.propina || 0)
    const total = totalFinal(cuenta)

    cuerpo += (lineas + lineaAnuladas) || `<div class="c">${tGlobal('ticket.sinItems')}</div>`
    cuerpo += `${sep()}`
    if (desc || prop) {
      cuerpo += fila(tGlobal('ticket.subtotal'), m(sub))
      if (desc) cuerpo += fila(tGlobal('ticket.descuento'), '-' + m(desc))
      if (prop) cuerpo += fila(tGlobal('ticket.propina'), m(prop))
    }
    cuerpo += `<div class="f total"><span>${tGlobal('ticket.total')}</span><span>${m(total)}</span></div>`

    const pagos = cuenta.pagos || []
    if (pagos.length) {
      const porMetodo = {}
      pagos.forEach(p => { const k = p.metodo || 'otro'; porMetodo[k] = round2((porMetodo[k] || 0) + (Number(p.monto) || 0)) })
      cuerpo += `${sep()}`
      Object.entries(porMetodo).forEach(([met, monto]) => { cuerpo += fila(nombreMetodo(met), m(monto)) })
      const cambios = round2(pagos.reduce((acc, p) => acc + (Number(p.cambio) || 0), 0))
      const cambio = cambios || Math.max(0, round2(pagadoCuenta(cuenta) - total))
      if (cambio > 0.009) cuerpo += fila(tGlobal('ticket.cambio'), m(cambio))
    }
    cuerpo += `<div class="c gracias">${esc(tGlobal('ticket.gracias'))}</div>`
  }

  const cabecera = `<h1>${esc(titulo || config?.nombre || 'POS Control')}</h1>`
    + `<div class="c">${esc(fecha)}</div>` + destino
    + (cuenta.abiertaPor ? fila(tGlobal('ticket.atendio'), cuenta.abiertaPor) : '')
    + `${sep()}`

  const html = `<!doctype html><html lang="${idiomaActivo()}"><head><meta charset="utf-8"><title>${esc(titulo || config?.nombre || tGlobal('ticket.titulo'))}</title>
<style>
@page{size:${ancho}mm auto;margin:0}
*{box-sizing:border-box}
body{margin:0;width:${ancho}mm;font-family:'Courier New',Courier,monospace;font-size:${ancho >= 70 ? '13px' : '11px'};line-height:1.35;color:#000;background:#fff;padding:2mm}
h1{font-size:${ancho >= 70 ? '16px' : '14px'};text-align:center;margin:0 0 2mm;text-transform:uppercase}
.c{text-align:center;margin:1px 0}
.f{display:flex;justify-content:space-between;gap:6px}
.f span:last-child{white-space:nowrap}
.sep{text-align:center;overflow:hidden;margin:1.5mm 0;letter-spacing:0}
.nota{font-style:italic;padding-left:8px}
.notax{font-weight:700;padding-left:8px}
.tachado{opacity:.6;text-decoration:line-through}
.total{font-size:${ancho >= 70 ? '16px' : '14px'};font-weight:700;margin:2px 0}
.gracias{margin-top:3mm;font-weight:700}
</style></head><body>${cabecera}${cuerpo}</body></html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', comanda ? tGlobal('ticket.comanda') : tGlobal('ticket.titulo'))
  Object.assign(iframe.style, { position: 'fixed', top: '0', left: '-10000px', width: '0', height: '0', border: '0', visibility: 'hidden' })
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  win.document.open()
  win.document.write(html)
  win.document.close()

  let retirado = false
  const limpiar = () => { if (!retirado) { retirado = true; setTimeout(() => iframe.remove(), 400) } }
  win.onafterprint = limpiar
  setTimeout(() => {
    try { win.focus(); win.print() } catch (e) { console.error('No se pudo imprimir el ticket:', e) }
    limpiar()
  }, 150)
  setTimeout(limpiar, 60000) // red de seguridad si el navegador no dispara onafterprint
}

// ---------- modo silencioso (impresora térmica ESC/POS) ----------

// Mismos contenidos que el ticket HTML, pero en líneas de texto plano para la térmica.
// ancho = columnas (32 para 58 mm, 48 para 80 mm) → se mantiene igual que antes.
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
      L.push({ texto: `${i.qty} x ${i.nombre}`, negrita: true })
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

// Trabajo para la cola de la estación: mismas líneas que saldrían por la térmica local.
const trabajoDe = ({ cuenta, config, titulo, comanda, grupoId, cols }) => ({
  grupo: grupoId,
  titulo: titulo || (comanda ? tGlobal('ticket.comanda') : tGlobal('ticket.titulo')),
  payload: { lineas: lineasPlanas({ cuenta, config, titulo, comanda, ancho: cols }), ancho: cols, corte: true, beep: Boolean(config?.impresoraBeep) },
})

// Imprime UNA cuenta/ticket/comanda. Reglas:
//  · COMANDA (comanda=true): va SIEMPRE en silencio al puerto del grupo indicado (`grupo`), nunca abre
//    el diálogo del navegador ni pide elegir impresora. Sin impresora conectada → 'sin-impresora'.
//  · TICKET / PRE-CUENTA: si config.impresion === 'silenciosa' y el grupo de tickets (Caja) tiene
//    impresora → silencioso; si no → diálogo del navegador (pedido explícito del usuario).
//  · fallo de escritura → 'error' (el servicio deja el error visible en estadoImpresora(grupo)).
export async function imprimirCuenta({ cuenta, config = {}, titulo, comanda = false, grupo, ancho, fallbackDialog = true } = {}) {
  if (!cuenta) return null
  const g = comanda ? gruposDe(config).find(x => x.id === grupo) : grupoTickets(config)
  const grupoId = g?.id || grupo || 'general'
  const cols = Number(ancho) || Number(g?.ancho) || Number(config?.impresoraAncho) || 32
  const mm = cols >= 42 ? 80 : 58 // para el diálogo de respaldo (imprimirTicket recibe milímetros)
  const silenciosa = comanda || config?.impresion === 'silenciosa' || config?.imprimacion === 'silenciosa'
  // ESTACIÓN DE IMPRESIÓN: este equipo no imprime; deja el trabajo en la cola y la PC del local lo saca.
  if (silenciosa && modoImpresion(config) === 'estacion') {
    try {
      await encolarImpresion([trabajoDe({ cuenta, config, titulo, comanda, grupoId, cols })])
      return 'encolado'
    } catch { return 'error' }
  }
  if (silenciosa) {
    if (!estadoImpresora(grupoId).conectada) {
      if (!comanda && fallbackDialog) imprimirTicket({ cuenta, config, titulo, comanda, ancho: mm })
      return 'sin-impresora'
    }
    try {
      await imprimirSilencioso({
        grupo: grupoId,
        lineas: lineasPlanas({ cuenta, config, titulo, comanda, ancho: cols }),
        ancho: cols,
        corte: true,
        beep: Boolean(config?.impresoraBeep),
      })
      return 'silencioso'
    } catch {
      return 'error'
    }
  }
  imprimirTicket({ cuenta, config, titulo, comanda, ancho: mm })
  return 'manual'
}

// Envía la comanda REPARTIDA por grupo (bebida → Barra, comida → Cocina…) sin preguntar nada.
// `items`: los ítems pendientes que se están enviando. Devuelve [{ grupo, resultado, n }].
export async function imprimirComandas({ cuenta, items, productos = [], config = {}, titulo }) {
  const reparto = repartirPorGrupo(items, productos, config)
  const salida = []
  if (modoImpresion(config) === 'estacion') {
    // Un solo envío con todas las partes (Cocina, Barra…): o llegan todas a la cola o ninguna.
    const trabajos = reparto.map(({ grupo, items: its }) => trabajoDe({
      cuenta: { ...cuenta, items: its }, config, titulo: `${titulo} · ${grupo.nombre}`, comanda: true,
      grupoId: grupo.id, cols: Number(grupo.ancho) || Number(config?.impresoraAncho) || 32,
    }))
    let resultado = 'encolado'
    try { if (trabajos.length) await encolarImpresion(trabajos) } catch { resultado = 'error' }
    return reparto.map(({ grupo, items: its }) => ({ grupo, resultado, n: its.length }))
  }
  for (const { grupo, items: its } of reparto) {
    const resultado = await imprimirCuenta({
      cuenta: { ...cuenta, items: its }, config, comanda: true, grupo: grupo.id,
      titulo: `${titulo} · ${grupo.nombre}`, fallbackDialog: false,
    })
    salida.push({ grupo, resultado, n: its.length })
  }
  return salida
}
