import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { USAR_SUPABASE } from '../services/config.js'
import { fijarEmpresa } from '../services/supabaseClient.js'
import { cargarEstadoInicial, despacharSupabase } from '../services/db.js'
import { round2 } from '../services/format.js'
import { repartirPorGrupo } from '../services/printing.js'
const uid = () => crypto.randomUUID()
const KEY = 'pos-control-demo-v2'
const KEY_SESION = 'pos-sesion'

const secciones = [
  { id: 's1', nombre: 'Desayunos', orden: 1 },
  { id: 's2', nombre: 'Comida', orden: 2 },
  { id: 's3', nombre: 'Bebidas', orden: 3 },
]
const productos = [
  ['Café', 's1', 10], ['Api con pastel', 's1', 12], ['Sándwich', 's1', 18],
  ['Milanesa', 's2', 45], ['Pique macho', 's2', 60], ['Sopa del día', 's2', 20],
  ['Jugo de naranja', 's3', 14], ['Refresco', 's3', 10], ['Cerveza', 's3', 25],
].map(([nombre, seccionId, precio]) => ({ id: uid(), nombre, seccionId, precio, activo: true }))

const GRUPOS_DEMO = [
  { id: 'cocina', nombre: 'Cocina', ancho: 32, baud: 9600 },
  { id: 'barra', nombre: 'Barra', ancho: 32, baud: 9600 },
  { id: 'caja', nombre: 'Caja (tickets)', ancho: 32, baud: 9600, tickets: true },
]

const inicial = {
  config: {
    nombre: 'Mi negocio', moneda: 'Bs', ivaPct: 0, propinaPct: 10,

    gruposImpresion: GRUPOS_DEMO, impresoraPorSeccion: { s1: 'cocina', s2: 'cocina', s3: 'barra' },
  },
  zonas: [{ id: 'z1', nombre: 'Salón' }, { id: 'z2', nombre: 'Terraza' }],
  mesas: [1, 2, 3, 4].map((n, i) => ({ id: 'm' + n, zona: 'z1', nombre: 'Mesa ' + n, x: 120 + i * 200, y: 150, w: 110, h: 110, forma: i % 2 ? 'redonda' : 'cuadrada', cap: 4 }))
    .concat([{ id: 'm5', zona: 'z2', nombre: 'Mesa 5', x: 300, y: 250, w: 150, h: 100, forma: 'rect', cap: 6 }]),
  secciones, productos,
  cuentas: [],
  caja: { turno: null, siguienteTurno: 1, historial: [] },
  devoluciones: [],
  usuariosDemo: [
    { usuario: 'admin', clave: '1234', rol: 'admin', nombre: 'Administrador' },
    { usuario: 'cajero', clave: '1234', rol: 'cajero', nombre: 'Cajero' },
    { usuario: 'mesero', clave: '1234', rol: 'mesero', nombre: 'Mesero' },
  ],
}

const migrar = e => {
  if (!e || typeof e !== 'object') return sembrar(inicial)
  const config = { ...inicial.config, ...(e.config || {}) }
  if (!Array.isArray(config.gruposImpresion) || !config.gruposImpresion.length) config.gruposImpresion = GRUPOS_DEMO
  if (!config.impresoraPorSeccion) config.impresoraPorSeccion = inicial.config.impresoraPorSeccion
  return sembrar({ ...e, config })
}

const nuevaCuenta = (a) => ({ id: uid(), tipo: 'mesa', canal: 'mesa', estado: 'abierta', items: [], pagos: [], propina: 0, descuento: 0, detalle: '', comensales: 1, abiertaEn: Date.now(), ...a })

// En demo el negocio arranca vacío y las pantallas de cocina/barra quedarían sin nada que mostrar,
// así que se siembra una vez por navegador: mesas abiertas con comandas ya enviadas.
function sembrar(s) {
  if (s._cocinaSembrada || (s.cuentas || []).some(c => c.estado !== 'cerrada')) return { ...s, _cocinaSembrada: true }
  const en = Date.now()
  const min = n => en - n * 60000
  const it = (nombre, qty, estado, enviadoEn, areas, extra) => {
    const prod = (s.productos || []).find(x => x.nombre === nombre)
    return prod ? { id: uid(), productoId: prod.id, nombre: prod.nombre, precio: prod.precio, qty, estado, nota: '', areas, enviadoEn, ...extra } : null
  }
  const devuelto = it('Sopa del día', 1, 'anulado', min(14), ['cocina'], { motivo: 'No salió' })
  const cuentas = [
    nuevaCuenta({ mesaIds: ['m1'], comensales: 4, abiertaPor: 'mesero', abiertaEn: min(22), items: [
      it('Milanesa', 1, 'enviado', min(11), ['cocina'], { nota: 'sin picante' }),
      it('Pique macho', 2, 'enviado', min(11), ['cocina']),
      it('Sopa del día', 1, 'listo', min(6), ['cocina'], { areasListas: ['cocina'], areasEn: { cocina: min(6) }, listoEn: min(6) }),
      it('Api con pastel', 1, 'enviado', min(3), ['cocina', 'barra'], { areasListas: ['cocina'], areasEn: { cocina: min(3) } }),
      it('Café', 2, 'anulacion', min(4), ['cocina'], { motivo: 'Cambio del cliente', anulacionEstadoPrevio: 'enviado', anulacionPedidaEn: min(1), anulacionPor: 'mesero' }),
      it('Cerveza', 2, 'enviado', min(6), ['barra']),
      it('Jugo de naranja', 1, 'pendiente'),
    ].filter(Boolean) }),
    nuevaCuenta({ mesaIds: ['m2'], comensales: 2, abiertaPor: 'mesero', abiertaEn: min(16), items: [
      devuelto,
      it('Milanesa', 1, 'enviado', min(2), ['cocina']),
      it('Refresco', 1, 'enviado', min(2), ['barra']),
    ].filter(Boolean) }),
  ]
  const devoluciones = devuelto ? [{
    id: uid(), cuentaId: cuentas[1].id, itemId: devuelto.id, area: 'cocina', nombre: devuelto.nombre, qty: devuelto.qty,
    monto: round2(devuelto.precio * devuelto.qty), mesa: nombreDeCuenta(s, cuentas[1]), motivo: 'No salió', turnoId: null,
    pedidaPor: 'mesero', pedidaEn: min(12), confirmadaPor: '', confirmadaEn: null, nota: '',
  }] : []
  return { ...s, _cocinaSembrada: true, cuentas: [...(s.cuentas || []), ...cuentas], devoluciones: [...(s.devoluciones || []), ...devoluciones] }
}

// Cada pago entra con su marca de tiempo: un abono entra en el turno en que se cobró,
// aunque la cuenta se cierre en un turno después.
const conFecha = (pagos, concepto, usuario) => (pagos || []).map(p => ({ ...p, id: p.id || uid(), ...(concepto ? { concepto } : {}), ...(usuario ? { por: usuario } : {}), en: Date.now() }))
const itemsVivos = c => c.items.filter(i => i.estado !== 'anulado')

// Las áreas de un ítem se resuelven igual que al imprimir la comanda, así la pantalla muestra
// exactamente lo que salió impreso.
const areasPorItem = (items, productos, config) => {
  const mapa = {}
  repartirPorGrupo(items, productos, config).forEach(({ grupo, items: delGrupo }) => delGrupo.forEach(i => { mapa[i.id] = [...(mapa[i.id] || []), grupo.id] }))
  return mapa
}
const areasDel = (i, s) => (Array.isArray(i.areas) && i.areas.length ? i.areas : areasPorItem([i], s.productos, s.config)[i.id] || [])
const nombreDeCuenta = (s, c) => (c.mesaIds || []).map(id => (s.mesas || []).find(m => m.id === id)?.nombre).filter(Boolean).join(', ')

// El monto se reparte entre las áreas que sirvieron el plato; el residuo va a la primera.
function devolucionesDeItem(s, c, i, motivo, usuario) {
  const areas = i.estado === 'listo' ? areasDel(i, s) : (i.areasListas || [])
  if (!areas.length) return []
  const total = round2(i.precio * i.qty)
  const parte = round2(total / areas.length)
  const en = Date.now()
  return areas.map((area, n) => ({
    id: uid(), cuentaId: c.id, itemId: i.id, area, nombre: i.nombre, qty: i.qty,
    monto: n === 0 ? round2(total - parte * (areas.length - 1)) : parte,
    mesa: nombreDeCuenta(s, c), motivo: motivo || 'sin motivo', turnoId: s.caja?.turno?.id || null,
    pedidaPor: usuario || '', pedidaEn: en, confirmadaPor: '', confirmadaEn: null, nota: '',
  }))
}

const cocinaSalida = (i, a, s) => {
  if (i.id !== a.itemId || i.estado !== 'enviado') return i
  const areas = areasDel(i, s)
  const areasListas = [...new Set([...(i.areasListas || []), a.area])]
  const en = Date.now()
  const completo = !areas.length || areas.every(x => areasListas.includes(x))
  return { ...i, areas, areasListas, areasEn: { ...(i.areasEn || {}), [a.area]: en }, ...(completo ? { estado: 'listo', listoEn: en } : {}) }
}

const cocinaDeshacer = (i, a) => {
  if (i.id !== a.itemId || (i.estado !== 'enviado' && i.estado !== 'listo')) return i
  const { [a.area]: _sale, ...areasEn } = i.areasEn || {}
  return { ...i, areasListas: (i.areasListas || []).filter(x => x !== a.area), areasEn, ...(i.estado === 'listo' ? { estado: 'enviado', listoEn: null } : {}) }
}

const cocinaAnular = (i, a) => (i.id !== a.itemId || (i.estado !== 'enviado' && i.estado !== 'listo')) ? i
  : { ...i, estado: 'anulacion', motivo: a.motivo, anulacionEstadoPrevio: i.estado, anulacionPedidaEn: Date.now(), anulacionPor: a.usuario || '' }

const cocinaResolver = (i, a) => {
  if (i.id !== a.itemId || i.estado !== 'anulacion') return i
  if (a.aprobar) return { ...i, estado: 'anulado', motivo: i.motivo || a.motivo || 'sin motivo', anulacionResueltaEn: Date.now(), anulacionResueltaPor: a.usuario || '' }
  const { anulacionEstadoPrevio: previo, motivo: _motivo, anulacionPedidaEn: _pedida, anulacionPor: _por, ...limpia } = i
  return { ...limpia, estado: previo || 'enviado', motivo: '' }
}

function reducer(s, a) {
  const upd = (id, fn) => ({ ...s, cuentas: s.cuentas.map(c => (c.id === id ? fn(c) : c)) })
  switch (a.t) {
    case 'cfg~': return { ...s, config: { ...s.config, ...a.cambios } }
    case 'mesa+': return { ...s, mesas: [...s.mesas, a.mesa] }
    case 'mesa~': return { ...s, mesas: s.mesas.map(m => (m.id === a.id ? { ...m, ...a.cambios } : m)) }
    case 'mesa-': return { ...s, mesas: s.mesas.filter(m => m.id !== a.id) }
    case 'zona+': return { ...s, zonas: [...s.zonas, a.zona] }
    case 'zona~': return { ...s, zonas: s.zonas.map(z => (z.id === a.id ? { ...z, ...a.cambios } : z)) }
    case 'zona-': return { ...s, zonas: s.zonas.filter(z => z.id !== a.id) }

    case 'abrir': return { ...s, cuentas: [...s.cuentas, nuevaCuenta({ tipo: 'mesa', canal: 'mesa', mesaIds: [a.mesaId], comensales: a.comensales || 1, abiertaPor: a.usuario })] }
    case 'abrir-directa': return { ...s, caja: { ...s.caja, siguienteTurno: s.caja.siguienteTurno + 1 },
      cuentas: [...s.cuentas, nuevaCuenta({ tipo: 'directa', canal: a.canal || 'mostrador', numero: s.caja.siguienteTurno, mesaIds: [], abiertaPor: a.usuario })] }

    case 'abrir-llevar': {
      const dia = x => new Date(x || 0).toDateString()
      const n = s.cuentas.filter(c => c.canal === 'llevar' && dia(c.abiertaEn) === dia(Date.now())).reduce((m, c) => Math.max(m, c.numero || 0), 0) + 1
      return { ...s, cuentas: [...s.cuentas, nuevaCuenta({ tipo: 'directa', canal: 'llevar', numero: n, mesaIds: [], clienteNombre: a.nombre, clienteTel: a.tel || '', abiertaPor: a.usuario })] }
    }
    case 'llevar~': return upd(a.cuentaId, c => ({ ...c, clienteNombre: a.nombre, clienteTel: a.tel || '' }))
    case 'llevar-mesa': return upd(a.cuentaId, c => (c.canal !== 'llevar' ? c : { ...c, tipo: 'mesa', canal: 'mesa', numero: undefined, mesaIds: [a.mesaId], comensales: a.comensales || c.comensales || 1 }))
    case 'unir': {
      const absorb = s.cuentas.filter(c => c.estado !== 'cerrada' && c.id !== a.cuentaId && c.mesaIds.some(m => a.mesaIds.includes(m)))
      const absorbItems = absorb.flatMap(c => c.items)
      const absorbedIds = absorb.map(c => c.id)
      return { ...s, cuentas: s.cuentas.map(c =>
        c.id === a.cuentaId ? { ...c, mesaIds: [...new Set([...c.mesaIds, ...a.mesaIds])], items: [...c.items, ...absorbItems] }
        : absorbedIds.includes(c.id) ? { ...c, estado: 'cerrada', cerradaEn: Date.now(), nota: 'unida a otra cuenta' } : c) }
    }
    case 'separar': {
      const c = s.cuentas.find(x => x.id === a.cuentaId)
      if (!c || !c.mesaIds.includes(a.mesaId) || c.mesaIds.length < 2) return s
      return { ...s, cuentas: s.cuentas.map(x => x.id === a.cuentaId ? { ...x, mesaIds: x.mesaIds.filter(m => m !== a.mesaId) } : x)
        .concat([nuevaCuenta({ tipo: 'mesa', mesaIds: [a.mesaId], abiertaPor: a.usuario })]) }
    }

    case 'item+': return upd(a.cuentaId, c => {
      const nota = a.nota || ''
      const precio = a.p.precio + (Number(a.extra) || 0)
      const ex = c.items.find(i => i.productoId === a.p.id && i.estado === 'pendiente' && (i.nota || '') === nota && i.precio === precio)
      if (ex) return { ...c, items: c.items.map(i => (i === ex ? { ...i, qty: i.qty + 1 } : i)) }
      return { ...c, items: [...c.items, { id: uid(), productoId: a.p.id, nombre: a.p.nombre, precio, qty: 1, estado: 'pendiente', nota }] }
    })
    case 'dividir': {
      const c = s.cuentas.find(x => x.id === a.cuentaId)
      if (!c || c.tipo !== 'mesa') return s
      const hermanas = s.cuentas.filter(x => x.estado !== 'cerrada' && x.mesaIds.some(m => c.mesaIds.includes(m)))
      if (hermanas.length >= 8) return s
      const usadas = hermanas.map(x => x.etiqueta).filter(Boolean)
      const sig = String.fromCharCode(Math.max(97, ...usadas.map(l => l.charCodeAt(0))) + 1)
      return { ...s, cuentas: s.cuentas.map(x => (x.id === c.id && !x.etiqueta ? { ...x, etiqueta: 'a' } : x))
        .concat([nuevaCuenta({ tipo: 'mesa', mesaIds: [...c.mesaIds], etiqueta: sig, abiertaPor: a.usuario })]) }
    }
    case 'qty': return upd(a.cuentaId, c => ({ ...c, items: c.items.flatMap(i => (i.id !== a.itemId ? [i] : i.qty + a.d <= 0 ? [] : [{ ...i, qty: i.qty + a.d }])) }))
    case 'detalle': return upd(a.cuentaId, c => ({ ...c, detalle: a.detalle || '' }))
    case 'nota': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => (i.id === a.itemId ? { ...i, nota: a.nota } : i)) }))
    // Un plato que ya salió del área deja devolución, igual que hace el servidor al anularlo.
    case 'anular': {
      const previo = s.cuentas.find(c => c.id === a.cuentaId)?.items.find(i => i.id === a.itemId)
      if (previo && (previo.estado === 'listo' || (previo.areasListas || []).length)) return reducer(s, { ...a, t: 'devolver' })
      return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => (i.id === a.itemId ? { ...i, estado: 'anulado', motivo: a.motivo } : i)) }))
    }
    // Una sola marca de tiempo por envío: la cocina agrupa la comanda por ese momento.
    case 'enviar': return upd(a.cuentaId, c => {
      const pend = c.items.filter(i => i.estado === 'pendiente')
      const areas = areasPorItem(pend, s.productos, s.config)
      const en = Date.now()
      return { ...c, items: c.items.map(i => (i.estado === 'pendiente' ? { ...i, estado: 'enviado', enviadoEn: en, areas: areas[i.id] || [] } : i)) }
    })
    case 'cocina-salida': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => cocinaSalida(i, a, s)) }))
    case 'cocina-deshacer': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => cocinaDeshacer(i, a)) }))
    case 'cocina-anular': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => cocinaAnular(i, a)) }))
    case 'cocina-resolver': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => cocinaResolver(i, a)) }))
    case 'devolver': {
      const c = s.cuentas.find(x => x.id === a.cuentaId)
      const i = c?.items.find(x => x.id === a.itemId)
      if (!i) return s
      return { ...upd(a.cuentaId, x => ({ ...x, items: x.items.map(y => (y.id === a.itemId ? { ...y, estado: 'anulado', motivo: a.motivo || 'sin motivo' } : y)) })),
        devoluciones: [...(s.devoluciones || []), ...devolucionesDeItem(s, c, i, a.motivo, a.usuario)] }
    }
    case 'devolver~': return { ...s, devoluciones: (s.devoluciones || []).map(x => (x.id === a.id && !x.confirmadaEn ? { ...x, confirmadaEn: Date.now(), confirmadaPor: a.usuario || '', nota: a.nota || '' } : x)) }
    case 'precuenta': return upd(a.cuentaId, c => ({ ...c, estado: 'precuenta' }))
    case 'reabrir': return upd(a.cuentaId, c => ({ ...c, estado: 'abierta' }))
    case 'extras': return upd(a.cuentaId, c => ({ ...c, propina: a.propina ?? c.propina, descuento: a.descuento ?? c.descuento }))
    case 'comensales~': return upd(a.cuentaId, c => ({ ...c, comensales: a.comensales }))
    case 'cobrar': return upd(a.cuentaId, c => ({ ...c, estado: 'cerrada', pagos: [...(c.pagos || []), ...conFecha(a.pagos, a.concepto, a.usuario)], propina: a.propina ?? c.propina, descuento: a.descuento ?? c.descuento, cerradaPor: a.usuario, cerradaEn: Date.now() }))
    case 'abonar': return upd(a.cuentaId, c => ({ ...c, pagos: [...(c.pagos || []), ...conFecha(a.pagos, a.concepto, a.usuario)] }))

    case 'mover': {
      const origen = s.cuentas.find(c => c.id === a.cuentaId)
      let destino = a.cuentaDestinoId ? s.cuentas.find(c => c.id === a.cuentaDestinoId)
        : s.cuentas.find(c => c.mesaIds.includes(a.mesaDestino) && c.estado !== 'cerrada')
      let cuentas = s.cuentas
      if (!destino) { destino = nuevaCuenta({ tipo: 'mesa', mesaIds: [a.mesaDestino], abiertaPor: a.usuario }); cuentas = [...cuentas, destino] }
      const moverItems = origen.items.filter(i => a.itemIds.includes(i.id) && i.estado !== 'anulado')
      return { ...s, cuentas: cuentas.map(c => c.id === origen.id ? { ...c, items: c.items.filter(i => !a.itemIds.includes(i.id)) }
        : c.id === destino.id ? { ...c, items: [...c.items, ...moverItems] } : c) }
    }

    case 'intercambiar': {
      const A = s.cuentas.find(c => c.id === a.cuentaA), B = s.cuentas.find(c => c.id === a.cuentaB)
      const iA = A?.items.find(i => i.id === a.itemA && i.estado !== 'anulado'), iB = B?.items.find(i => i.id === a.itemB && i.estado !== 'anulado')
      if (!A || !B || !iA || !iB || A.id === B.id) return s
      return { ...s, cuentas: s.cuentas.map(c => c.id === A.id ? { ...c, items: [...c.items.filter(i => i.id !== iA.id), iB] }
        : c.id === B.id ? { ...c, items: [...c.items.filter(i => i.id !== iB.id), iA] } : c) }
    }

    case 'usuario+': return s.usuariosDemo.some(u => u.usuario.toLowerCase() === a.usuario.usuario.toLowerCase()) ? s
      : { ...s, usuariosDemo: [...s.usuariosDemo, { creadoEn: Date.now(), ...a.usuario }] }
    case 'usuario~': return { ...s, usuariosDemo: s.usuariosDemo.map(u => (u.usuario === a.usuario ? { ...u, ...a.cambios } : u)) }
    case 'usuario-': return { ...s, usuariosDemo: s.usuariosDemo.filter(u => u.usuario !== a.usuario) }

    case 'turno+': {
      if (s.caja.turno) return s

      const heredadas = s.cuentas.filter(c => c.estado !== 'cerrada').map(c => c.id)
      return { ...s, caja: { ...s.caja, turno: { id: uid(), abiertoEn: Date.now(), abiertoPor: a.usuario, fondo: a.fondo, movimientos: [], heredadas } } }
    }
    case 'turno-': {
      if (!s.caja.turno) return s
      const fin = Date.now()
      const t0 = s.caja.turno

      const cobradas = s.cuentas.filter(c => c.estado === 'cerrada' && (c.pagos || []).length && (c.cerradaEn || 0) >= t0.abiertoEn && (c.cerradaEn || 0) <= fin)
      const porUsuario = {}
      cobradas.forEach(c => { const u = c.cerradaPor || '—'; const x = porUsuario[u] || { n: 0, total: 0 }; porUsuario[u] = { n: x.n + 1, total: x.total + totalFinal(c) } })
      const traspaso = s.cuentas.filter(c => c.estado !== 'cerrada').map(c => ({ cuentaId: c.id, tipo: c.tipo, numero: c.numero, mesaIds: c.mesaIds, total: totalFinal(c) }))
      const turno = { ...t0, cerradoEn: fin, cerradoPor: a.usuario, contado: a.contado, porUsuario, traspaso }
      return { ...s, caja: { ...s.caja, turno: null, historial: [turno, ...s.caja.historial] } }
    }

    case 'caja-mov+': return s.caja.turno
      ? { ...s, caja: { ...s.caja, turno: { ...s.caja.turno, movimientos: [...s.caja.turno.movimientos, { id: uid(), t: a.tipo, monto: a.monto, motivo: a.motivo }] } } }
      : s

    case 'seccion+': return { ...s, secciones: [...s.secciones, { id: uid(), orden: s.secciones.length + 1, ...a.seccion }] }
    case 'seccion~': return { ...s, secciones: s.secciones.map(x => (x.id === a.id ? { ...x, ...a.cambios } : x)) }
    case 'seccion-': return { ...s, secciones: s.secciones.filter(x => x.id !== a.id), productos: s.productos.filter(p => p.seccionId !== a.id) }
    case 'producto+': {
      // Nº de ítem consecutivo por negocio, que NO se reutiliza aunque se borre un producto (en demo: contador aparte).
      const n = Math.max(s.contadorProductos || 0, s.productos.length, ...s.productos.map(p => p.numero || 0)) + 1
      return { ...s, contadorProductos: n, productos: [...s.productos, { id: uid(), activo: true, numero: n, ...a.producto }] }
    }
    case 'area-': return { ...s, productos: s.productos.map(p => {
      const rest = (p.areas || []).filter(x => x !== a.id)
      return (p.areas || []).includes(a.id) ? { ...p, areas: rest.length ? rest : [a.reemplazo || 'cocina'] } : p
    }) }
    case 'producto~': return { ...s, productos: s.productos.map(p => (p.id === a.id ? { ...p, ...a.cambios } : p)) }
    case 'producto-': return { ...s, productos: s.productos.filter(p => p.id !== a.id) }

    case 'reset': return inicial
    default: return s
  }
}

export const leerSesionSup = () => { try { const r = localStorage.getItem(KEY_SESION); return r ? JSON.parse(r) : null } catch { return null } }
export const guardarSesionSup = ses => { try { if (ses) localStorage.setItem(KEY_SESION, JSON.stringify(ses)); else localStorage.removeItem(KEY_SESION) } catch {  } window.dispatchEvent(new Event('pos-sesion')) }

const SUP_VACIO = { ...inicial, cuentas: [], caja: { turno: null, siguienteTurno: 1, historial: [] }, usuariosDemo: [], _supCargando: true }

function useSupabaseStore(empresaId) {
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  const estadoRef = useRef(null)
  const colaRef = useRef(Promise.resolve())
  const mapaRef = useRef(new Map())

  useEffect(() => {
    let vivo = true
    estadoRef.current = null
    mapaRef.current = new Map()
    colaRef.current = Promise.resolve()
    setS(null)
    setError('')
    if (!empresaId) return
    fijarEmpresa(empresaId)
    cargarEstadoInicial(empresaId)
      .then(e => { if (!vivo) return; estadoRef.current = { ...e, _empresaId: empresaId }; setS(estadoRef.current) })
      .catch(err => { if (vivo) setError('No se pudo cargar la empresa: ' + (err?.message || err)) })
    return () => { vivo = false }
  }, [empresaId])

  useEffect(() => {
    if (!empresaId) return undefined
    let vivo = true
    const alReanudar = () => {
      colaRef.current = colaRef.current.then(async () => {
        if (!vivo || !estadoRef.current) return
        try {
          const fresco = await cargarEstadoInicial(empresaId)
          if (!vivo) return
          estadoRef.current = { ...fresco, _empresaId: empresaId }
          setS(estadoRef.current)
          setError('')
        } catch {  }
      })
    }
    window.addEventListener('pos-reanudar', alReanudar)
    return () => { vivo = false; window.removeEventListener('pos-reanudar', alReanudar) }
  }, [empresaId])

  const d = useCallback(a => {
    if (!empresaId) return
    if (!estadoRef.current) { setError('Cargando datos de la empresa…'); return }
    const prev = estadoRef.current
    const nuevo = reducer(prev, a)

    const dif = (arrA, arrB) => { const S = new Set(arrA.map(x => x.id)); return arrB.filter(x => !S.has(x.id)).map(x => x.id) }
    const accion = {
      ...a,
      _nuevos: {
        cuentas: dif(prev.cuentas, nuevo.cuentas),
        secciones: dif(prev.secciones, nuevo.secciones),
        productos: dif(prev.productos, nuevo.productos),
      },
    }
    estadoRef.current = { ...nuevo, _empresaId: empresaId, _supCargando: false }
    setS(estadoRef.current)
    colaRef.current = colaRef.current.then(async () => {
      if (!estadoRef.current) return
      try {
        const res = await despacharSupabase(estadoRef.current, accion, { mapa: mapaRef.current, setError })
        estadoRef.current = { ...res, _empresaId: empresaId }
        setS(estadoRef.current)
        setError('')
      } catch (err) {
        setError(err?.message || String(err))
        try {
          const fresco = await cargarEstadoInicial(empresaId)
          estadoRef.current = { ...fresco, _empresaId: empresaId }
          setS(estadoRef.current)
        } catch {  }
      }
    })
  }, [empresaId])

  return { s: s || SUP_VACIO, d, error, cargando: !s }
}

const Ctx = createContext(null)
export function StoreProvider({ children }) {
  const [sesion, setSesion] = useState(leerSesionSup)
  useEffect(() => {
    const refrescar = () => setSesion(leerSesionSup())
    window.addEventListener('pos-sesion', refrescar)
    window.addEventListener('storage', refrescar)
    return () => { window.removeEventListener('pos-sesion', refrescar); window.removeEventListener('storage', refrescar) }
  }, [])

  const supActivo = Boolean(sesion?.empresaId && USAR_SUPABASE)
  const [sDemo, dDemo] = useReducer(reducer, null, () => { try { return migrar(JSON.parse(localStorage.getItem(KEY))) } catch { return inicial } })
  useEffect(() => { if (!supActivo) localStorage.setItem(KEY, JSON.stringify(sDemo)) }, [sDemo, supActivo])
  const sup = useSupabaseStore(supActivo ? sesion.empresaId : null)

  const valor = supActivo
    ? { s: sup.s, d: sup.d, error: sup.error, modo: 'supabase', sesion }
    : { s: sDemo, d: dDemo, error: null, modo: 'demo', sesion }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}
export const useStore = () => useContext(Ctx)
export const nuevoId = uid

export const cuentasDeMesa = (s, mesaId) => s.cuentas
  .filter(c => c.mesaIds.includes(mesaId) && c.estado !== 'cerrada')
  .sort((x, y) => (x.etiqueta || '').localeCompare(y.etiqueta || ''))
export const cuentaActiva = (s, mesaId) => cuentasDeMesa(s, mesaId)[0]
export const totalCuenta = c => (c ? round2(itemsVivos(c).reduce((t, i) => t + i.precio * i.qty, 0)) : 0)
export const totalFinal = c => (c ? round2(Math.max(0, totalCuenta(c) - (c.descuento || 0)) + (c.propina || 0)) : 0)
export const pagadoCuenta = c => round2((c?.pagos || []).reduce((t, p) => t + (Number(p.monto) || 0), 0))
export const saldoCuenta = c => round2(Math.max(0, totalFinal(c) - pagadoCuenta(c)))

// «Orden» del ticket: el lugar que ocupa esta cuenta entre las abiertas el mismo día.
// Se saca del momento de apertura, así coincide con el orden en que entraron.
export const ordenDelDia = (cuentas, cuenta) => {
  const dia = ts => { const d = new Date(ts || 0); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
  const delDia = (cuentas || []).filter(x => dia(x.abiertaEn) === dia(cuenta?.abiertaEn)).sort((a, b) => (a.abiertaEn || 0) - (b.abiertaEn || 0))
  return delDia.findIndex(x => x.id === cuenta?.id) + 1
}
