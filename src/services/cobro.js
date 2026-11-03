import { round2, numMonto } from './format.js'

// Reparte lo recibido sobre el total y dice cuánto sale del cajón como cambio. Lo usan Salón, Caja y Venta directa.
//
// El cambio solo puede salir del EFECTIVO: un QR o una tarjeta no se devuelven en billetes. Por eso lo que no es
// efectivo se aplica primero (y solo hasta lo que falta) y el efectivo cubre el resto: lo que sobra de ese efectivo es
// el cambio. Antes se aplicaba en el orden en que se escribieron las líneas, y con «efectivo 100 + QR 50» sobre una
// cuenta de 120 la caja anotaba 100 en efectivo mientras al cliente se le devolvían 30: el cajón quedaba 30 corto.
//
// `monto` de cada pago es lo que SÍ entra a la cuenta (ya sin el cambio) y es lo que suman la caja, el cierre y los
// reportes; `recibido` y `cambio` quedan en el detalle para el comprobante.
// `excedente` es lo que sobra en pagos que no son efectivo: no hay cómo devolverlo, así que el cobro lo rechaza.
export function imputarPagos(lineas, total) {
  const validas = (lineas || []).map(l => ({ l, n: round2(numMonto(l.monto)) })).filter(x => x.n > 0)
  const esEfectivo = x => x.l.metodo === 'efectivo'
  const orden = [...validas.filter(x => !esEfectivo(x)), ...validas.filter(esEfectivo)]
  let saldo = round2(total)
  const aplicado = new Map()
  orden.forEach(x => {
    const a = round2(Math.min(x.n, saldo))
    aplicado.set(x, a)
    saldo = round2(saldo - a)
  })
  const pagos = []
  let cambio = 0
  let excedente = 0
  validas.forEach(x => {
    const aplica = aplicado.get(x)
    const sobra = round2(x.n - aplica)
    const devuelto = esEfectivo(x) ? sobra : 0
    if (!esEfectivo(x)) excedente = round2(excedente + sobra)
    if (aplica > 0) {
      pagos.push({
        metodo: x.l.metodo, monto: aplica, recibido: x.n, cambio: devuelto,
        ...(x.l.metodo === 'qr' && x.l.comprobante ? { comprobante: x.l.comprobante } : {}),
        ...(x.l.metodo === 'cxc' && x.l.trabajador_id ? { trabajador_id: x.l.trabajador_id, trabajador_nombre: x.l.trabajador_nombre } : {}),
      })
    }
    cambio = round2(cambio + devuelto)
  })
  return { pagos, cambio, saldo, excedente }
}

// Qué impide cobrar con estas líneas (texto ya traducido), o '' si todo está bien. `total` es opcional: sin él solo se
// revisa la cuenta por cobrar; con él también que QR, tarjeta y demás no pasen de lo que falta por cobrar.
export function cobroInvalido(lineas, tr, total) {
  const ls = lineas || []
  if (ls.some(l => l.metodo === 'cxc' && numMonto(l.monto) > 0 && !l.trabajador_id)) return tr('venta.cxcElegir')
  if (total !== undefined && imputarPagos(ls, total).excedente > 0.009) return tr('venta.sobraNoEfectivo')
  return ''
}
