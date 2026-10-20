import { totalFinal } from '../../../context/StoreContext.jsx'
import { round2 } from '../../../services/format.js'

// Resumen de un turno (caja). Puro: no muta nada, solo lee turno + cuentas.
export function calcularResumen(turno, cuentas) {
  const fin = turno.cerradoEn ?? Date.now()
  const tickets = cuentas.filter(c => c.estado === 'cerrada' && (c.pagos || []).length > 0 && (turno.modo !== 'por_cajero' || c.cerradaPor === turno.abiertoPor) && (c.cerradaEn || 0) >= turno.abiertoEn && (c.cerradaEn || 0) <= fin)
  const ventas = { efectivo: 0, qr: 0, tarjeta: 0, otros: 0 }
  // El dinero entra al cajón en cuanto se paga, no cuando se cierra la mesa: un abono
  // de una cuenta abierta cuenta en este turno (mismo criterio que cerrar_turno).
  const cuando = (p, c) => p.en ?? p.creadaEn ?? c.cerradaEn ?? (turno.abiertoEn + 1)
  const enTurno = (p, c) => { const t = cuando(p, c); return t >= turno.abiertoEn && t <= fin }
  const delCajero = (p, c) => turno.modo !== 'por_cajero' || c.cerradaPor === turno.abiertoPor
    || p.por === turno.abiertoPor || (p.porId && p.porId === turno.abiertoPorId)
  cuentas.forEach(c => (c.pagos || []).forEach(p => {
    if (!enTurno(p, c) || !delCajero(p, c)) return
    const k = ['efectivo', 'qr', 'tarjeta'].includes(p.metodo) ? p.metodo : 'otros'
    ventas[k] = round2(ventas[k] + (Number(p.monto) || 0))
  }))
  const movs = turno.movimientos || []
  const ingresos = round2(movs.filter(x => x.t === 'ingreso').reduce((acc, x) => acc + (Number(x.monto) || 0), 0))
  const egresos = round2(movs.filter(x => x.t === 'egreso').reduce((acc, x) => acc + (Number(x.monto) || 0), 0))
  const esperado = round2((Number(turno.fondo) || 0) + ventas.efectivo + ingresos - egresos)
  const vendido = round2(tickets.reduce((acc, c) => acc + totalFinal(c), 0))
  const porUsuario = {}
  tickets.forEach(c => { const u = c.cerradaPor || '—'; const x = porUsuario[u] || { n: 0, total: 0 }; porUsuario[u] = { n: x.n + 1, total: round2(x.total + totalFinal(c)) } })
  return { tickets, ventas, ingresos, egresos, esperado, vendido, porUsuario }
}
