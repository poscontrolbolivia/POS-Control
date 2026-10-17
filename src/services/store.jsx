// Almacén: modo demo (localStorage) o modo Supabase (RPCs según docs/CONTRATO.md),
// con la MISMA interfaz useStore() → {s, d} para los componentes.
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { USAR_SUPABASE } from '../config.js'
import { fijarEmpresa } from './supabase.js'
import { cargarEstadoInicial, despacharSupabase } from './tiendaSupabase.js'
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
    // Bebidas salen en la Barra; desayunos y comida en la Cocina (editable al crear/editar la sección).
    gruposImpresion: GRUPOS_DEMO, impresoraPorSeccion: { s1: 'cocina', s2: 'cocina', s3: 'barra' },
  },
  zonas: [{ id: 'z1', nombre: 'Salón' }, { id: 'z2', nombre: 'Terraza' }],
  mesas: [1, 2, 3, 4].map((n, i) => ({ id: 'm' + n, zona: 'z1', nombre: 'Mesa ' + n, x: 120 + i * 200, y: 150, w: 110, h: 110, forma: i % 2 ? 'redonda' : 'cuadrada', cap: 4 }))
    .concat([{ id: 'm5', zona: 'z2', nombre: 'Mesa 5', x: 300, y: 250, w: 150, h: 100, forma: 'rect', cap: 6 }]),
  secciones, productos,
  cuentas: [], // {id, tipo:'mesa'|'directa', numero?, mesaIds:[], estado, items, pagos, propina, descuento, comensales, abiertaPor, cerradaPor?, cerradaEn?}
  caja: { turno: null, siguienteTurno: 1, historial: [] },
  usuariosDemo: [
    { usuario: 'admin', clave: '1234', rol: 'admin', nombre: 'Administrador' },
    { usuario: 'cajero', clave: '1234', rol: 'cajero', nombre: 'Cajero' },
    { usuario: 'mesero', clave: '1234', rol: 'mesero', nombre: 'Mesero' },
  ],
}

// Estados demo guardados por versiones anteriores no traen grupos de impresión: se completan.
const migrar = e => {
  if (!e || typeof e !== 'object') return inicial
  const config = { ...inicial.config, ...(e.config || {}) }
  if (!Array.isArray(config.gruposImpresion) || !config.gruposImpresion.length) config.gruposImpresion = GRUPOS_DEMO
  if (!config.impresoraPorSeccion) config.impresoraPorSeccion = inicial.config.impresoraPorSeccion
  return { ...e, config }
}

const nuevaCuenta = (a) => ({ id: uid(), tipo: 'mesa', canal: 'mesa', estado: 'abierta', items: [], pagos: [], propina: 0, descuento: 0, comensales: 1, abiertaEn: Date.now(), ...a })
const itemsVivos = c => c.items.filter(i => i.estado !== 'anulado')

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

    case 'unir': { // suma mesas a la cuenta; si esas mesas tenían cuenta activa, sus ítems se absorben
      const absorb = s.cuentas.filter(c => c.estado !== 'cerrada' && c.id !== a.cuentaId && c.mesaIds.some(m => a.mesaIds.includes(m)))
      const absorbItems = absorb.flatMap(c => c.items)
      const absorbedIds = absorb.map(c => c.id)
      return { ...s, cuentas: s.cuentas.map(c =>
        c.id === a.cuentaId ? { ...c, mesaIds: [...new Set([...c.mesaIds, ...a.mesaIds])], items: [...c.items, ...absorbItems] }
        : absorbedIds.includes(c.id) ? { ...c, estado: 'cerrada', cerradaEn: Date.now(), nota: 'unida a otra cuenta' } : c) }
    }
    case 'separar': { // saca una mesa de la cuenta unida y le crea cuenta propia vacía
      const c = s.cuentas.find(x => x.id === a.cuentaId)
      if (!c || !c.mesaIds.includes(a.mesaId) || c.mesaIds.length < 2) return s
      return { ...s, cuentas: s.cuentas.map(x => x.id === a.cuentaId ? { ...x, mesaIds: x.mesaIds.filter(m => m !== a.mesaId) } : x)
        .concat([nuevaCuenta({ tipo: 'mesa', mesaIds: [a.mesaId], abiertaPor: a.usuario })]) }
    }

    case 'item+': return upd(a.cuentaId, c => {
      const ex = c.items.find(i => i.productoId === a.p.id && i.estado === 'pendiente' && !i.nota)
      if (ex) return { ...c, items: c.items.map(i => (i === ex ? { ...i, qty: i.qty + 1 } : i)) }
      return { ...c, items: [...c.items, { id: uid(), productoId: a.p.id, nombre: a.p.nombre, precio: a.p.precio, qty: 1, estado: 'pendiente', nota: '' }] }
    })
    case 'qty': return upd(a.cuentaId, c => ({ ...c, items: c.items.flatMap(i => (i.id !== a.itemId ? [i] : i.qty + a.d <= 0 ? [] : [{ ...i, qty: i.qty + a.d }])) }))
    case 'nota': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => (i.id === a.itemId ? { ...i, nota: a.nota } : i)) }))
    case 'anular': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => (i.id === a.itemId ? { ...i, estado: 'anulado', motivo: a.motivo } : i)) }))
    case 'enviar': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => (i.estado === 'pendiente' ? { ...i, estado: 'enviado', enviadoEn: Date.now() } : i)) }))
    case 'precuenta': return upd(a.cuentaId, c => ({ ...c, estado: 'precuenta' }))
    case 'reabrir': return upd(a.cuentaId, c => ({ ...c, estado: 'abierta' }))
    case 'extras': return upd(a.cuentaId, c => ({ ...c, propina: a.propina ?? c.propina, descuento: a.descuento ?? c.descuento }))
    case 'comensales~': return upd(a.cuentaId, c => ({ ...c, comensales: a.comensales }))
    case 'cobrar': return upd(a.cuentaId, c => ({ ...c, estado: 'cerrada', pagos: a.pagos, propina: a.propina ?? c.propina, descuento: a.descuento ?? c.descuento, cerradaPor: a.usuario, cerradaEn: Date.now() }))

    case 'mover': { // ítems a la cuenta activa de otra mesa (o a cuenta existente por id destino)
      const origen = s.cuentas.find(c => c.id === a.cuentaId)
      let destino = a.cuentaDestinoId ? s.cuentas.find(c => c.id === a.cuentaDestinoId)
        : s.cuentas.find(c => c.mesaIds.includes(a.mesaDestino) && c.estado !== 'cerrada')
      let cuentas = s.cuentas
      if (!destino) { destino = nuevaCuenta({ tipo: 'mesa', mesaIds: [a.mesaDestino], abiertaPor: a.usuario }); cuentas = [...cuentas, destino] }
      const moverItems = origen.items.filter(i => a.itemIds.includes(i.id) && i.estado !== 'anulado')
      return { ...s, cuentas: cuentas.map(c => c.id === origen.id ? { ...c, items: c.items.filter(i => !a.itemIds.includes(i.id)) }
        : c.id === destino.id ? { ...c, items: [...c.items, ...moverItems] } : c) }
    }

    case 'intercambiar': { // cambia una línea de la cuenta A por una línea de la cuenta B
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
      // Las mesas que ya estaban abiertas pasan a este turno ("heredadas del turno anterior").
      const heredadas = s.cuentas.filter(c => c.estado !== 'cerrada').map(c => c.id)
      return { ...s, caja: { ...s.caja, turno: { id: uid(), abiertoEn: Date.now(), abiertoPor: a.usuario, fondo: a.fondo, movimientos: [], heredadas } } }
    }
    case 'turno-': {
      if (!s.caja.turno) return s
      const fin = Date.now()
      const t0 = s.caja.turno
      // Ventas del turno agrupadas por quien cobró y mesas que siguen abiertas: NO se fuerza a
      // cerrarlas, pasan al turno siguiente para que la caja no se detenga.
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
    case 'seccion-': return { ...s, secciones: s.secciones.filter(x => x.id !== a.id), productos: s.productos.map(p => (p.seccionId === a.id ? { ...p, activo: false, huerfano: true } : p)) }
    case 'producto+': return { ...s, productos: [...s.productos, { id: uid(), activo: true, ...a.producto }] }
    case 'producto~': return { ...s, productos: s.productos.map(p => (p.id === a.id ? { ...p, ...a.cambios } : p)) }
    case 'producto-': return { ...s, productos: s.productos.filter(p => p.id !== a.id) }

    case 'reset': return inicial
    default: return s
  }
}

// Sesión Supabase guardada por LoginPage (localStorage 'pos-sesion'); null ⇒ modo demo.
export const leerSesionSup = () => { try { const r = localStorage.getItem(KEY_SESION); return r ? JSON.parse(r) : null } catch { return null } }
export const guardarSesionSup = ses => { try { if (ses) localStorage.setItem(KEY_SESION, JSON.stringify(ses)); else localStorage.removeItem(KEY_SESION) } catch { /* noop */ } window.dispatchEvent(new Event('pos-sesion')) }

// Estado esqueleto mientras carga Supabase (los componentes leen s.config, s.mesas… sin crashear).
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

  // d() en modo Supabase: aplica el reducer demo de forma OPTIMISTA (los componentes
  // dependen del encadenamiento síncrono de ids/efectos, p. ej. VentaDirecta) y encola
  // la RPC correspondiente en serie. Ante error: aviso visible + re-sincronía total.
  const d = useCallback(a => {
    if (!empresaId) return
    if (!estadoRef.current) { setError('Cargando datos de la empresa…'); return }
    const prev = estadoRef.current
    const nuevo = reducer(prev, a)
    // ids que ESTA acción generó de forma optimista (para mapearlos al id real de la base
    // cuando la RPC se ejecute, aunque la cola todavía tenga pasos pendientes).
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
        try { // el contrato manda: ante error, re-sincronizar desde la base (nunca aplicar el cambio local)
          const fresco = await cargarEstadoInicial(empresaId)
          estadoRef.current = { ...fresco, _empresaId: empresaId }
          setS(estadoRef.current)
        } catch { /* la base aún no responde: queda el aviso */ }
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

  // Ramas montadas SIEMPRE (reglas de hooks); solo una alimenta el contexto.
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

export const cuentaActiva = (s, mesaId) => s.cuentas.find(c => c.mesaIds.includes(mesaId) && c.estado !== 'cerrada')
export const totalCuenta = c => (c ? itemsVivos(c).reduce((t, i) => t + i.precio * i.qty, 0) : 0)
export const totalFinal = c => (c ? Math.max(0, totalCuenta(c) - (c.descuento || 0)) + (c.propina || 0) : 0)
export const pagadoCuenta = c => (c?.pagos || []).reduce((t, p) => t + p.monto, 0)
