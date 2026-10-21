// Alertas derivadas del estado del negocio. No se guardan en la base ni usan React ni i18n:
// devuelven la misma forma que una alerta normal, con `auto:true` y `id` sintético, para que la
// pantalla las muestre como sugerencias y el usuario decida si las convierte en alerta real.

const MIN = 60000
const DEMORA_MS = 15 * MIN
const SALDO_LARGO_MS = 120 * MIN
const DEMORA_URGENTE_MS = 30 * MIN

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const arr = v => (Array.isArray(v) ? v : [])
const min = ms => Math.max(0, Math.floor(ms / MIN))
const plata = v => r2(v).toFixed(2)

const itemsVivos = c => arr(c?.items).filter(i => i && i.estado !== 'anulado')
const totalCuenta = c => itemsVivos(c).reduce((t, i) => t + num(i.precio) * num(i.qty), 0)
const totalFinal = c => Math.max(0, totalCuenta(c) - num(c?.descuento)) + num(c?.propina)
const pagado = c => arr(c?.pagos).reduce((t, p) => t + num(p.monto), 0)
const saldo = c => r2(Math.max(0, totalFinal(c) - pagado(c)))

const nombreCuenta = (c, mesas) => {
  const ids = arr(c?.mesaIds)
  if (ids.length) return ids.map(id => arr(mesas).find(m => m?.id === id)?.nombre || 'Mesa').join(' + ')
  if (c?.canal === 'llevar') return c.clienteNombre ? `Para llevar · ${c.clienteNombre}` : 'Para llevar'
  if (c?.canal === 'mostrador') return 'Mostrador'
  return c?.numero ? `Pedido ${c.numero}` : 'Cuenta'
}

const mesaDe = c => arr(c?.mesaIds)[0] ?? null

export function alertasAutomaticas({ cuentas, mesas, insumos, ahora } = {}) {
  const en = Number(ahora) || Date.now()
  const abiertas = arr(cuentas).filter(c => c && c.estado !== 'cerrada')
  const out = []

  // 1) Pre-cuenta: el cobro está listo y nadie pasa por caja.
  for (const c of abiertas) {
    if (c.estado !== 'precuenta') continue
    out.push({
      id: 'auto-cobro-' + c.id,
      tipo: 'cobro',
      titulo: 'Cuenta por cobrar',
      mensaje: `${nombreCuenta(c, mesas)} quedó en pre-cuenta y debe ${plata(saldo(c))}.`,
      cuentaId: c.id,
      mesaId: mesaDe(c),
      prioridad: 3,
      creadaPor: '',
      creadaEn: c.precuentaEn || c.abiertaEn || en,
      monto: saldo(c),
      auto: true,
    })
  }

  // 2) Plato enviado hace más de 15 min: la comanda se está demorando.
  for (const c of abiertas) {
    for (const i of itemsVivos(c)) {
      if (i.estado !== 'enviado' || !i.enviadoEn) continue
      const desde = en - num(i.enviadoEn)
      if (desde <= DEMORA_MS) continue
      out.push({
        id: `auto-cocina-${c.id}-${i.id}`,
        tipo: 'cocina',
        titulo: 'Comanda demorada',
        mensaje: `${i.nombre} x${num(i.qty)} de ${nombreCuenta(c, mesas)} lleva ${min(desde)} min enviado.`,
        cuentaId: c.id,
        mesaId: mesaDe(c),
        prioridad: desde > DEMORA_URGENTE_MS ? 2 : 4,
        creadaPor: '',
        creadaEn: num(i.enviadoEn),
        auto: true,
      })
    }
  }

  // 3) Cuenta abierta con saldo sin cobrar hace más de 2 horas.
  for (const c of abiertas) {
    if (c.estado === 'precuenta' || !c.abiertaEn) continue
    const desde = en - num(c.abiertaEn)
    const resto = saldo(c)
    if (desde <= SALDO_LARGO_MS || resto <= 0) continue
    out.push({
      id: 'auto-atraso-' + c.id,
      tipo: 'cobro',
      titulo: 'Cuenta abierta hace más de 2 horas',
      mensaje: `${nombreCuenta(c, mesas)} debe ${plata(resto)} desde hace ${min(desde)} min.`,
      cuentaId: c.id,
      mesaId: mesaDe(c),
      prioridad: 5,
      creadaPor: '',
      creadaEn: num(c.abiertaEn),
      monto: resto,
      auto: true,
    })
  }

  // 4) Inventario por debajo del mínimo (insumos puede no venir cargado).
  for (const i of arr(insumos)) {
    if (!i || i.activo === false) continue
    const stock = num(i.stock), minimo = num(i.stock_min)
    if (minimo <= 0 || stock > minimo) continue
    out.push({
      id: 'auto-inventario-' + (i.id ?? i.nombre),
      tipo: 'inventario',
      titulo: 'Stock bajo',
      mensaje: `${i.nombre}: ${stock}${i.unidad ? ' ' + i.unidad : ''} disponible, mínimo ${minimo}.`,
      cuentaId: null,
      mesaId: null,
      prioridad: stock <= 0 ? 1 : 6,
      creadaPor: '',
      creadaEn: en,
      auto: true,
    })
  }

  return out
    .filter(a => a.id && a.titulo)
    .sort((a, b) => (a.prioridad - b.prioridad) || (b.creadaEn - a.creadaEn))
}

export default alertasAutomaticas
