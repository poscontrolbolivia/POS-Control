// Reporte de cierre (turno de un cajero o día completo) en PDF. Puro + jsPDF cargado bajo demanda.
import { totalCuenta, totalFinal, pagadoCuenta, saldoCuenta } from '../context/StoreContext.jsx'
import { areasDelItem, gruposDeComanda } from './printing.js'
import { round2 } from './format.js'
import { agruparTiempos, filasLocales } from './tiempos.js'
import { BUCKET_COMPROBANTES } from './comprobante.js'

const vivos = c => (c.items || []).filter(i => i.estado !== 'anulado')

// Datos del reporte a partir del resumen del turno (calcularResumen). No muta nada.
export function armarReporte({ turno, resumen, config, productos = [], devoluciones = [], contado = null, cerradoPor = '', etiquetaCuenta = c => c.numero ?? '', cuentas = null, abiertas = null, tiemposFilas = null }) {
  const tickets = resumen.tickets
  const grupos = gruposDeComanda(config)
  const nombreArea = id => grupos.find(g => g.id === id)?.nombre || id
  const porArea = {}
  tickets.forEach(c => vivos(c).forEach(i => {
    const area = (areasDelItem(i, productos) || ['cocina']).find(a => a !== 'caja') || 'cocina'
    const clave = i.productoId || i.nombre
    const A = (porArea[area] ||= { id: area, nombre: nombreArea(area), filas: {} })
    const f = (A.filas[clave] ||= { nombre: i.nombre, qty: 0, importe: 0 })
    f.qty += i.qty; f.importe = round2(f.importe + i.precio * i.qty)
  }))
  const secciones = Object.values(porArea).map(A => {
    const filas = Object.values(A.filas).sort((a, b) => b.qty - a.qty || (a.nombre > b.nombre ? 1 : -1))
    return { id: A.id, nombre: A.nombre, filas, unidades: filas.reduce((x, f) => x + f.qty, 0), importe: round2(filas.reduce((x, f) => x + f.importe, 0)) }
  }).sort((a, b) => (a.id === 'cocina' ? -1 : b.id === 'cocina' ? 1 : a.id === 'barra' ? -1 : b.id === 'barra' ? 1 : 0))

  const bruto = round2(tickets.reduce((a, c) => a + totalCuenta(c), 0))
  const descuentos = round2(tickets.reduce((a, c) => a + (c.descuento || 0), 0))
  const propinas = round2(tickets.reduce((a, c) => a + (c.propina || 0), 0))
  const total = round2(tickets.reduce((a, c) => a + totalFinal(c), 0))
  const personas = tickets.reduce((a, c) => a + Math.max(1, Number(c.comensales) || 1), 0)
  const consumo = round2(bruto - descuentos)
  const dev = devoluciones.filter(x => x.pedidaEn >= turno.abiertoEn && (!turno.cerradoEn || x.pedidaEn <= turno.cerradoEn))
  const comprobantes = []
  tickets.forEach(c => (c.pagos || []).forEach(p => { if (p.comprobante) comprobantes.push({ cuenta: etiquetaCuenta(c), monto: p.monto, en: p.en ?? p.creadaEn ?? c.cerradaEn, ref: p.comprobante }) }))
  const esperado = resumen.esperado
  const fin = turno.cerradoEn || Date.now()
  const enVentana = ts => ts != null && ts >= turno.abiertoEn && ts <= fin
  // Detalle de control: todo lo que se anuló, devolvió o movió en el turno (aunque la cuenta se cerrara en cero).
  const todas = cuentas || tickets
  const idsDev = new Set(dev.map(x => x.itemId).filter(Boolean))
  const anulaciones = []
  todas.forEach(c => {
    const actividad = c.cerradaEn ?? c.abiertaEn ?? fin
    if (!enVentana(actividad) && !(c.estado !== 'cerrada' && (c.abiertaEn ?? 0) <= fin)) return
    ;(c.items || []).forEach(i => {
      if (i.estado !== 'anulado' || idsDev.has(i.id)) return
      anulaciones.push({ cuenta: etiquetaCuenta(c), nombre: i.nombre, qty: i.qty, monto: round2((Number(i.precio) || 0) * (Number(i.qty) || 0)), motivo: i.motivo || '', por: i.anulacionPor || '' })
    })
  })
  const devolucionesPago = []
  const descuentosDet = []
  todas.forEach(c => {
    ;(c.pagos || []).forEach(p => {
      const cuando = p.en ?? p.creadaEn ?? c.cerradaEn
      if (Number(p.monto) < 0 && enVentana(cuando)) devolucionesPago.push({ cuenta: etiquetaCuenta(c), metodo: p.metodo, monto: round2(-Number(p.monto)), motivo: p.motivo || p.concepto || '', en: cuando })
    })
  })
  tickets.forEach(c => { if ((c.descuento || 0) > 0) descuentosDet.push({ cuenta: etiquetaCuenta(c), monto: round2(c.descuento) }) })
  const movimientos = (turno.movimientos || []).map(x => ({ tipo: x.t, monto: round2(Number(x.monto) || 0), motivo: x.motivo || '', en: x.creadaEn ?? x.en ?? null }))
  const devDetalle = dev.map(x => ({ en: x.pedidaEn, nombre: x.nombre, qty: x.qty, monto: round2(Number(x.monto) || 0), mesa: x.mesa || '', motivo: x.motivo || '', por: x.pedidaPor || '', confirmada: Boolean(x.confirmadaEn), nota: x.nota || '' }))
  // Tiempo de preparación por área (el servidor trae una fila por área, así que un combo cuenta en cocina y en barra).
  const tiempos = agruparTiempos(tiemposFilas || filasLocales(todas, turno.abiertoEn, fin, productos), nombreArea, 25)
  const abiertasAlCierre = (abiertas || []).filter(c => c.estado !== 'cerrada' && (c.items || []).some(i => i.estado !== 'anulado'))
    .map(c => ({ cuenta: etiquetaCuenta(c), total: round2(totalFinal(c)), pagado: round2(pagadoCuenta(c)), saldo: round2(saldoCuenta(c)) }))
  return {
    negocio: { nombre: config?.nombre || '', sucursal: config?.sucursal || '', direccion: config?.direccion || '', telefono: config?.telefono || '', nit: config?.nit || '' },
    porCajero: turno.modo === 'por_cajero',
    abiertoEn: turno.abiertoEn, cerradoEn: turno.cerradoEn || Date.now(), abiertoPor: turno.abiertoPor || '', cerradoPor: cerradoPor || turno.cerradoPor || turno.abiertoPor || '',
    fondo: Number(turno.fondo) || 0, ventas: resumen.ventas, ingresos: resumen.ingresos, egresos: resumen.egresos, esperado, contado,
    diferencia: contado == null ? null : round2(contado - esperado),
    cuentas: tickets.length, personas, bruto, descuentos, propinas, total, consumo,
    promedioPersona: personas ? round2(consumo / personas) : 0, ticketPromedio: tickets.length ? round2(total / tickets.length) : 0,
    secciones, unidades: secciones.reduce((a, s) => a + s.unidades, 0),
    top: secciones.flatMap(s => s.filas).sort((a, b) => b.qty - a.qty).slice(0, 5),
    devoluciones: { n: dev.length, monto: round2(dev.reduce((a, x) => a + (Number(x.monto) || 0), 0)) },
    anulaciones: { n: anulaciones.length, monto: round2(anulaciones.reduce((a, x) => a + x.monto, 0)), filas: anulaciones },
    devolucionesPago: { n: devolucionesPago.length, monto: round2(devolucionesPago.reduce((a, x) => a + x.monto, 0)), filas: devolucionesPago },
    devDetalle, movimientos, descuentosDet, abiertasAlCierre, tiempos,
    comprobantes,
  }
}

const SEMANA = 604800 // los enlaces firmados de comprobantes duran 7 días
export async function firmarComprobantes(sb, lista) {
  const paths = lista.map(x => x.ref).filter(r => r && !String(r).startsWith('data:'))
  if (!sb || !paths.length) return {}
  const { data } = await sb.storage.from(BUCKET_COMPROBANTES).createSignedUrls(paths, SEMANA)
  return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]))
}

// Genera y descarga el PDF. t(clave, params) = traductor de la app; m(n) = formateo de dinero.
export async function descargarPdfCierre(r, { t, m, sb, locale }) {
  const nombreSec = s => (s.id === 'cocina' ? t('cierrePdf.platos') : s.id === 'barra' ? t('cierrePdf.bebidas') : s.nombre)
  const { jsPDF } = await import('jspdf')
  const enlaces = await firmarComprobantes(sb, r.comprobantes).catch(() => ({}))
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, ML = 15, MR = 195
  let y = 18
  const fh = ts => new Date(ts).toLocaleString(locale || [], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const salto = h => { if (y + h > 282) { doc.addPage(); y = 18 } }
  const linea = (txt, o = {}) => { salto(6); doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.s || 10); doc.text(String(txt), o.c ? W / 2 : ML, y, o.c ? { align: 'center' } : undefined); y += o.h || 5.2 }
  const par = (a, b, o = {}) => { salto(6); doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(10); doc.text(String(a), ML, y); doc.text(String(b), MR, y, { align: 'right' }); y += 5.2 }
  const titulo = txt => { salto(12); y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.text(txt, ML, y); y += 1.6; doc.setDrawColor(150); doc.line(ML, y, MR, y); y += 5 }

  // Tabla simple con columnas (anchos relativos) y texto envuelto; repite el encabezado al cambiar de página.
  const tabla = (cols, anchos, filas) => {
    const U = MR - ML, suma = anchos.reduce((a, b) => a + b, 0)
    const ax = anchos.map(a => (U * a) / suma)
    const x0 = ax.map((_, i) => ML + ax.slice(0, i).reduce((a, b) => a + b, 0))
    const pintar = (vals, neg, der) => {
      doc.setFont('helvetica', neg ? 'bold' : 'normal'); doc.setFontSize(9)
      const partes = vals.map((v, i) => doc.splitTextToSize(String(v ?? ''), ax[i] - 2))
      const n = Math.max(1, ...partes.map(p => p.length))
      partes.forEach((p, i) => p.forEach((l, k) => { if (der.has(i)) doc.text(l, x0[i] + ax[i] - 1, y + k * 4, { align: 'right' }); else doc.text(l, x0[i] + 1, y + k * 4) }))
      y += n * 4 + 1.2
    }
    const der = new Set(cols.map((c, i) => (c.der ? i : -1)).filter(i => i >= 0))
    const cab = () => { salto(10); doc.setFillColor(232, 236, 242); doc.rect(ML, y - 3.4, U, 5.6, 'F'); pintar(cols.map(c => c.t), true, der) }
    cab()
    filas.forEach(f => {
      const alto = Math.max(1, ...f.map((v, i) => doc.splitTextToSize(String(v ?? ''), ax[i] - 2).length)) * 4 + 1.2
      if (y + alto > 282) { doc.addPage(); y = 18; cab() }
      pintar(f, false, der)
    })
    y += 2
  }
  const dur = n => {
    const s = Math.round(n / 1000)
    if (s < 60) return `${s} s`
    const mi = Math.round(s / 60)
    return mi < 60 ? `${mi} min` : `${Math.floor(mi / 60)} h ${String(mi % 60).padStart(2, '0')} min`
  }
  const hora = ts => (ts ? new Date(ts).toLocaleTimeString(locale || [], { hour: '2-digit', minute: '2-digit' }) : '')

  if (r.negocio.nombre) linea(r.negocio.nombre, { b: 1, s: 16, c: 1, h: 7 })
  if (r.negocio.sucursal) linea(r.negocio.sucursal, { c: 1 })
  if (r.negocio.direccion) linea(r.negocio.direccion, { c: 1 })
  const tel = [r.negocio.telefono && `Tel ${r.negocio.telefono}`, r.negocio.nit && `NIT ${r.negocio.nit}`].filter(Boolean).join('  -  ')
  if (tel) linea(tel, { c: 1 })
  y += 2
  linea(r.porCajero ? t('cierrePdf.turno') : t('cierrePdf.dia'), { b: 1, s: 14, c: 1, h: 8 })
  linea(`${fh(r.abiertoEn)}  -  ${fh(r.cerradoEn)}`, { c: 1 })

  titulo(t('cierrePdf.generales'))
  par(t('cierrePdf.abrio'), r.abiertoPor || '-'); par(t('cierrePdf.cerro'), r.cerradoPor || '-')
  par(t('cierrePdf.cuentas'), r.cuentas); par(t('cierrePdf.personas'), r.personas)
  par(t('cierrePdf.unidades'), r.unidades)
  par(t('cierrePdf.ticketProm'), m(r.ticketPromedio))
  par(t('cierrePdf.promPersona'), m(r.promedioPersona), { b: 1 })

  titulo(t('cierrePdf.ventas'))
  par(t('cierrePdf.consumo'), m(r.bruto))
  if (r.descuentos) par(t('cierrePdf.descuentos'), `- ${m(r.descuentos)}`)
  if (r.propinas) par(t('cierrePdf.propinas'), m(r.propinas))
  par(t('cierrePdf.totalVentas'), m(r.total), { b: 1 })
  y += 1
  par(t('cierrePdf.efectivo'), m(r.ventas.efectivo)); par(t('cierrePdf.qr'), m(r.ventas.qr)); par(t('cierrePdf.tarjeta'), m(r.ventas.tarjeta))
  if (r.ventas.otros) par(t('cierrePdf.otros'), m(r.ventas.otros))
  if (r.devoluciones.n) par(t('cierrePdf.devoluciones', { n: r.devoluciones.n }), m(r.devoluciones.monto))

  if (r.anulaciones.n || r.devolucionesPago.n) {
    titulo(t('cierrePdf.control'))
    par(t('cierrePdf.anulaciones', { n: r.anulaciones.n }), m(r.anulaciones.monto))
    par(t('cierrePdf.devolucionesPago', { n: r.devolucionesPago.n }), m(r.devolucionesPago.monto))
  }

  titulo(t('cierrePdf.caja'))
  par(t('cierrePdf.fondo'), m(r.fondo)); par(t('cierrePdf.ingresos'), m(r.ingresos)); par(t('cierrePdf.egresos'), m(r.egresos))
  par(t('cierrePdf.esperado'), m(r.esperado))
  if (r.contado != null) { par(t('cierrePdf.contado'), m(r.contado)); par(t('cierrePdf.diferencia'), m(r.diferencia), { b: 1 }) }

  if (r.anulaciones.filas.length) {
    titulo(`${t('cierrePdf.anulacionesDet')} (${r.anulaciones.n})`)
    tabla([{ t: t('cierrePdf.colCuenta') }, { t: t('cierrePdf.colProducto') }, { t: t('cierrePdf.colCant'), der: 1 }, { t: t('cierrePdf.colMonto'), der: 1 }, { t: t('cierrePdf.colMotivo') }, { t: t('cierrePdf.colPor') }],
      [14, 30, 7, 13, 30, 14], r.anulaciones.filas.map(x => [x.cuenta, x.nombre, x.qty, m(x.monto), x.motivo || t('cierrePdf.sinMotivo'), x.por]))
  }
  if (r.devDetalle.length) {
    titulo(`${t('cierrePdf.devolucionesDet')} (${r.devDetalle.length})`)
    tabla([{ t: t('cierrePdf.colHora') }, { t: t('cierrePdf.colProducto') }, { t: t('cierrePdf.colCant'), der: 1 }, { t: t('cierrePdf.colMonto'), der: 1 }, { t: t('cierrePdf.colMesa') }, { t: t('cierrePdf.colMotivo') }, { t: t('cierrePdf.colPor') }, { t: t('cierrePdf.colEstado') }],
      [8, 24, 6, 12, 10, 24, 11, 14], r.devDetalle.map(x => [hora(x.en), x.nombre, x.qty, m(x.monto), x.mesa, x.motivo || t('cierrePdf.sinMotivo'), x.por, x.confirmada ? `${t('cierrePdf.confirmada')}${x.nota ? ` - ${x.nota}` : ''}` : t('cierrePdf.pendienteConf')]))
  }
  if (r.devolucionesPago.filas.length) {
    titulo(`${t('cierrePdf.devolucionesPagoDet')} (${r.devolucionesPago.n})`)
    tabla([{ t: t('cierrePdf.colHora') }, { t: t('cierrePdf.colCuenta') }, { t: t('cierrePdf.colMetodo') }, { t: t('cierrePdf.colMonto'), der: 1 }, { t: t('cierrePdf.colMotivo') }],
      [8, 16, 12, 12, 40], r.devolucionesPago.filas.map(x => [hora(x.en), x.cuenta, x.metodo, m(x.monto), x.motivo || t('cierrePdf.sinMotivo')]))
  }
  if (r.movimientos.length) {
    titulo(`${t('cierrePdf.movimientos')} (${r.movimientos.length})`)
    tabla([{ t: t('cierrePdf.colHora') }, { t: t('cierrePdf.colTipo') }, { t: t('cierrePdf.colMonto'), der: 1 }, { t: t('cierrePdf.colMotivo') }],
      [8, 12, 12, 50], r.movimientos.map(x => [hora(x.en), x.tipo === 'ingreso' ? t('cierrePdf.ingreso') : t('cierrePdf.egreso'), m(x.monto), x.motivo || t('cierrePdf.sinMotivo')]))
  }
  if (r.descuentosDet.length) {
    titulo(`${t('cierrePdf.descuentosDet')} (${r.descuentosDet.length})`)
    tabla([{ t: t('cierrePdf.colCuenta') }, { t: t('cierrePdf.colMonto'), der: 1 }], [40, 14], r.descuentosDet.map(x => [x.cuenta, m(x.monto)]))
  }
  r.tiempos.forEach(A => {
    titulo(`${t('cierrePdf.tiempos')}: ${A.nombre} - ${t('cierrePdf.promedioGeneral')} ${dur(A.promedio)} (${A.n})`)
    tabla([{ t: t('cierrePdf.colProducto') }, { t: t('cierrePdf.colCant'), der: 1 }, { t: t('cierrePdf.colPromedio'), der: 1 }, { t: t('cierrePdf.colMin'), der: 1 }, { t: t('cierrePdf.colMax'), der: 1 }],
      [34, 8, 14, 12, 12], A.filas.map(f => [f.nombre, f.n, dur(f.promedio), dur(f.min), dur(f.max)]))
  })
  if (r.tiempos.length) { doc.setFontSize(8.5); doc.setTextColor(110); doc.text(t('cierrePdf.tiemposNota'), ML, y); doc.setTextColor(0); y += 5 }
  if (r.abiertasAlCierre.length) {
    titulo(`${t('cierrePdf.abiertasCierre')} (${r.abiertasAlCierre.length})`)
    tabla([{ t: t('cierrePdf.colCuenta') }, { t: t('cierrePdf.colTotal'), der: 1 }, { t: t('cierrePdf.colPagado'), der: 1 }, { t: t('cierrePdf.colSaldo'), der: 1 }],
      [30, 14, 14, 14], r.abiertasAlCierre.map(x => [x.cuenta, m(x.total), m(x.pagado), m(x.saldo)]))
  }

  r.secciones.forEach(sec => {
    titulo(`${nombreSec(sec)}  (${sec.unidades})`)
    sec.filas.forEach(f => { salto(6); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(`${f.qty} x`, ML + 8, y, { align: 'right' }); doc.text(f.nombre.slice(0, 60), ML + 11, y); doc.text(m(f.importe), MR, y, { align: 'right' }); y += 5 })
    par(t('cierrePdf.subtotal', { nombre: nombreSec(sec) }), m(sec.importe), { b: 1 })
  })
  if (r.top.length) {
    titulo(t('cierrePdf.top'))
    r.top.forEach((f, i) => par(`${i + 1}. ${f.nombre.slice(0, 50)}`, `${f.qty} x`))
  }

  if (r.comprobantes.length) {
    titulo(t('cierrePdf.comprobantes', { n: r.comprobantes.length }))
    r.comprobantes.forEach(c => {
      salto(6); doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
      const base = `${c.cuenta}  -  ${c.en ? fh(c.en) : ''}  -  ${m(c.monto)}  -  `
      doc.text(base, ML, y)
      const url = enlaces[c.ref]
      const x = ML + doc.getTextWidth(base)
      if (url) { doc.setTextColor(20, 90, 200); doc.textWithLink(t('cierrePdf.verFoto'), x, y, { url }); doc.setTextColor(0) } else doc.text(t('cierrePdf.fotoAdjunta'), x, y)
      y += 5.2
    })
    if (Object.keys(enlaces).length) { doc.setFontSize(8.5); doc.setTextColor(110); doc.text(t('cierrePdf.enlacesNota'), ML, y); doc.setTextColor(0); y += 5 }
  }

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(8.5); doc.setTextColor(120); doc.text(`${t('cierrePdf.generado')} ${fh(Date.now())}  -  ${p}/${n}`, W / 2, 291, { align: 'center' }); doc.setTextColor(0) }
  const d = new Date(r.cerradoEn); const p2 = x => String(x).padStart(2, '0')
  doc.save(`cierre-${r.porCajero ? 'turno' : 'dia'}-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.pdf`)
}
