// Adaptador Supabase ↔ estado local del store (CONTRATO.md §4: mapeo 1:1 acción→RPC).
// `cargarEstadoInicial`: SELECTs directos (el RLS ya filtra por empresa activa).
// `despacharSupabase`: traduce cada acción del reducer demo a su RPC y re-sincroniza
// las filas afectadas (cuentas/items/pagos/mesas/turno). Nunca deja estado corrupto:
// ante error RPC, re-sincroniza desde la base y propaga el mensaje para el toast.
import { sb, rpc, fijarEmpresa } from './supabase.js'

const N = x => Number(x ?? 0)
const ts = iso => (iso ? new Date(iso).getTime() : undefined)
const hoyISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

// ─────────────────────────── mapeo fila DB → forma local ───────────────────────────

const mapZona = z => ({ id: z.id, nombre: z.nombre })
const mapMesa = m => ({ id: m.id, zona: m.zona_id, nombre: m.nombre, x: N(m.x), y: N(m.y), w: N(m.w), h: N(m.h), forma: m.forma, cap: N(m.capacidad) })
const mapSeccion = s => ({ id: s.id, nombre: s.nombre, orden: N(s.orden) })
const mapProducto = p => ({ id: p.id, nombre: p.nombre, seccionId: p.seccion_id, precio: N(p.precio), activo: p.activo, imagen_path: p.imagen_path ?? null })

const mapItem = i => ({
  id: i.id, productoId: i.producto_id, nombre: i.nombre_snapshot, precio: N(i.precio_snapshot),
  qty: N(i.qty), estado: i.estado, nota: i.nota || '', motivo: i.motivo_anulacion,
  enviadoEn: ts(i.enviado_en), creadaEn: ts(i.creada_en),
})

// Pagos: el detalle jsonb (recibido/cambio/referencia/tarjeta/ultimos4) se aplana en la línea,
// que es la convención de los componentes (p.ej. p.cambio en VentaDirecta/CajaPage).
const mapPago = p => ({ id: p.id, metodo: p.metodo, monto: N(p.monto), ...(p.detalle && typeof p.detalle === 'object' ? p.detalle : {}), creadaEn: ts(p.creada_en) })

const mapMov = m => ({ id: m.id, t: m.tipo, monto: N(m.monto), motivo: m.motivo, creadaEn: ts(m.creada_en) })

const mapTurno = (t, nombres) => ({
  id: t.id,
  abiertoEn: ts(t.abierto_en),
  abiertoPor: nombres[t.abierto_por] || t.abierto_por,
  fondo: N(t.fondo),
  movimientos: ((t.movimientos && t.movimientos.movimientos) || []).map(mapMov),
  ...(t.cerrado_en ? {
    cerradoEn: ts(t.cerrado_en),
    cerradoPor: nombres[t.cerrado_por] || t.cerrado_por,
    contado: N(t.contado),
    esperado: N(t.esperado),
  } : {}),
})

// ───────────────────────────── SELECTs auxiliares ──────────────────────────────────

async function selectAll(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

async function fetchCuentas(empresaId, caja) {
  // Activas (abierta/precuenta) + cerradas dentro de la ventana de los turnos conocidos
  // (para el arqueo/historial de CajaPage) o del día (venta directa recién cobrada).
  const aperturas = [caja.turno?.abiertoEn, ...(caja.historial || []).map(t => t.abiertoEn)].filter(Boolean)
  const window = aperturas.length ? Math.min(...aperturas) : new Date(hoyISO()).getTime()
  const iso = new Date(window).toISOString()
  const orFilter = `estado.neq.cerrada,cerrada_en.gte.${iso}`
  const cuentas = await selectAll(sb.from('cuentas').select('*').eq('empresa_id', empresaId).or(orFilter))
  if (!cuentas.length) return { cuentas: [], items: [], pagos: [], cms: [] }
  const ids = cuentas.map(c => c.id)
  const [items, pagos, cms] = await Promise.all([
    selectAll(sb.from('cuenta_items').select('*').in('cuenta_id', ids).order('creada_en')),
    selectAll(sb.from('pagos').select('*').in('cuenta_id', ids).order('creada_en')),
    selectAll(sb.from('cuenta_mesas').select('*').in('cuenta_id', ids)),
  ])
  return { cuentas, items, pagos, cms }
}

async function fetchCaja(empresaId) {
  const [abierto, historial] = await Promise.all([
    selectAll(sb.from('turnos_caja').select('*').eq('empresa_id', empresaId).is('cerrado_en', null).order('abierto_en', { ascending: false }).limit(1)),
    selectAll(sb.from('turnos_caja').select('*').eq('empresa_id', empresaId).not('cerrado_en', 'is', null).order('abierto_en', { ascending: false }).limit(15)),
  ])
  return { abierto: abierto[0] || null, historial }
}

async function fetchNombres() {
  // perfiles visibles: uno mismo y colegas de empresa (para abiertaPor/cerradaPor en tickets)
  try {
    const rows = await selectAll(sb.from('perfiles').select('user_id, display_name'))
    return Object.fromEntries(rows.map(r => [r.user_id, r.display_name]))
  } catch { return {} }
}

function armarCuentas(cuentas, items, pagos, cms, nombres) {
  const porCuenta = (rows, key) => {
    const m = {}
    for (const r of rows) (m[r[key]] = m[r[key]] || []).push(r)
    return m
  }
  const itemsBy = porCuenta(items, 'cuenta_id')
  const pagosBy = porCuenta(pagos, 'cuenta_id')
  const mesasBy = porCuenta(cms, 'cuenta_id')
  return cuentas.map(c => ({
    id: c.id,
    tipo: c.tipo,
    canal: c.tipo === 'directa' ? 'mostrador' : 'mesa',
    numero: c.numero ?? undefined,
    mesaIds: (mesasBy[c.id] || []).map(cm => cm.mesa_id),
    estado: c.estado,
    comensales: N(c.comensales),
    propina: N(c.propina),
    descuento: N(c.descuento),
    nota: c.nota ?? undefined,
    abiertaPor: nombres[c.abierta_por] || c.abierta_por,
    abiertaEn: ts(c.abierta_en),
    cerradaPor: c.cerrada_por ? (nombres[c.cerrada_por] || c.cerrada_por) : undefined,
    cerradaEn: ts(c.cerrada_en),
    items: (itemsBy[c.id] || []).map(mapItem),
    pagos: (pagosBy[c.id] || []).map(mapPago),
  }))
}

const armarCaja = (abierto, historial, nombres, siguienteTurno, cajaPrev) => ({
  turno: abierto ? mapTurno(abierto, nombres) : null,
  historial: historial.map(t => mapTurno(t, nombres)),
  // siguienteTurno: lo gestiona el reducer optimista; no pisarlo en refetches parciales
  siguienteTurno: siguienteTurno ?? cajaPrev?.siguienteTurno ?? 1,
})

// ─────────────────────────── carga inicial del estado ──────────────────────────────

export async function cargarEstadoInicial(empresaId) {
  if (!sb) throw new Error('Supabase no está configurado')
  fijarEmpresa(empresaId)
  const nombres = await fetchNombres()
  // `cajaP` se consulta una sola vez y se encadena: fetchCuentas necesita el turno ya
  // mapeado, y nombrar `cajaT` dentro del mismo Promise.all que lo declara lanza
  // "Cannot access 'cajaT' before initialization" (TDZ) y rompía toda la carga inicial.
  const cajaP = fetchCaja(empresaId)
  const [empresas, zonas, mesas, secciones, productos, cajaT, dataCuentas, numeradas] = await Promise.all([
    selectAll(sb.from('empresas').select('*').eq('id', empresaId)),
    selectAll(sb.from('zonas').select('*').eq('empresa_id', empresaId).order('orden')),
    selectAll(sb.from('mesas').select('*').eq('empresa_id', empresaId).eq('activa', true).order('nombre')),
    selectAll(sb.from('secciones_menu').select('*').eq('empresa_id', empresaId).order('orden')),
    selectAll(sb.from('productos').select('*').eq('empresa_id', empresaId).order('nombre')),
    cajaP,
    cajaP.then(t => fetchCuentas(empresaId, { turno: t.abierto ? mapTurno(t.abierto, nombres) : null, historial: t.historial.map(x => mapTurno(x, nombres)) })),
    // contador de venta directa: máximo numero del día en la empresa + 1 (misma fórmula que la RPC)
    selectAll(sb.from('cuentas').select('numero').eq('empresa_id', empresaId).eq('tipo', 'directa').gte('abierta_en', hoyISO()).order('numero', { ascending: false }).limit(1)),
  ])
  const emp = empresas[0]
  if (!emp) throw new Error('No tienes acceso a esta empresa (o no existe)')
  const cuentas = armarCuentas(dataCuentas.cuentas, dataCuentas.items, dataCuentas.pagos, dataCuentas.cms, nombres)
  return {
    config: { nombre: emp.nombre, moneda: emp.moneda, ivaPct: N(emp.iva_pct), propinaPct: N(emp.propina_pct), ...(emp.config && typeof emp.config === 'object' ? emp.config : {}) },
    _configRaw: (emp.config && typeof emp.config === 'object') ? emp.config : {},
    zonas: zonas.map(mapZona),
    mesas: mesas.map(mapMesa),
    secciones: secciones.map(mapSeccion),
    productos: productos.map(mapProducto),
    cuentas,
    caja: armarCaja(cajaT.abierto, cajaT.historial, nombres, N(numeradas[0]?.numero || 0) + 1),
    usuariosDemo: [],
    _sup: true, // marca: estado respaldado por Supabase
  }
}

// Re-sincronización de negocio (cuentas + caja) tras una RPC; conserva el resto del estado.
async function refrescarNegocio(estado) {
  const empresaId = estado._empresaId
  const [cajaT, data, nombres] = await Promise.all([
    fetchCaja(empresaId),
    fetchCuentas(empresaId, estado.caja),
    fetchNombres(),
  ])
  return {
    ...estado,
    cuentas: armarCuentas(data.cuentas, data.items, data.pagos, data.cms, nombres),
    caja: armarCaja(cajaT.abierto, cajaT.historial, nombres, undefined, estado.caja),
  }
}

// ───────────────────────── helpers de resolución de ids ────────────────────────────
// El StoreProvider aplica el reducer demo de forma optimista (ids locales generados con
// crypto.randomUUID) para que los componentes funcionen igual que en demo. Las acciones
// en cola se ejecutan en serie; aquí resolvemos id-local → id-db cuando la RPC ya corrió.

const rid = (mapa, id) => (id ? mapa.get(id) || id : id)

// Tras agregar_items: empareja ítems optimistas sin mapear con las filas devueltas por la base.
function remapItems(mapa, prevItems, respItems) {
  const usados = new Set()
  for (const it of prevItems) {
    if (mapa.has(it.id)) continue
    if (respItems.some(r => r.id === it.id)) continue // ya es id de la base
    const cand = respItems.find(r => !usados.has(r.id) && r.id !== it.id
      && (r.producto_id || null) === (it.productoId || null)
      && (r.nota || '') === (it.nota || ''))
    if (cand) { usados.add(cand.id); mapa.set(it.id, cand.id) }
  }
}

// Busca la cuenta recién creada de forma optimista (el reducer la añade al final).
function cuentaRecien(cuentas, filtro) {
  for (let i = cuentas.length - 1; i >= 0; i--) if (filtro(cuentas[i])) return cuentas[i]
  return null
}

// ───────────────────────── despacho de acciones (mapeo §4) ─────────────────────────

const DETALLE_KEYS = ['recibido', 'cambio', 'referencia', 'tarjeta', 'ultimos4']
const mapPagos = pagos => (pagos || []).map(p => {
  const detalle = {}
  for (const k of DETALLE_KEYS) if (p[k] !== undefined && p[k] !== null) detalle[k] = p[k]
  return { metodo: p.metodo, monto: p.monto, ...(Object.keys(detalle).length ? { detalle } : {}) }
})

// ctx = { mapa: Map(local→db), setError(msg) }
// Devuelve el nuevo estado (verdad de la base) o lanza Error con mensaje legible.
export async function despacharSupabase(estado, a, ctx = {}) {
  const mapa = ctx.mapa || new Map()
  const empresaId = estado._empresaId
  if (!empresaId) throw new Error('No hay empresa activa')
  const E = { ...estado, _empresaId: empresaId }

  switch (a.t) {
    // ── negocio (RPCs del CONTRATO §3) ──
    case 'abrir': {
      const dbId = await rpc('abrir_cuenta', { p_mesa_id: a.mesaId, p_comensales: a.comensales || 1 })
      const locId = (a._nuevos?.cuentas || [])[0]
      if (locId && locId !== dbId) mapa.set(locId, dbId)
      return refrescarNegocio(E)
    }
    case 'abrir-directa': {
      const dbId = await rpc('abrir_venta_directa', {})
      const locId = (a._nuevos?.cuentas || [])[0]
      if (locId && locId !== dbId) mapa.set(locId, dbId)
      return refrescarNegocio(E)
    }
    case 'item+': {
      const itemsDb = await rpc('agregar_items', { p_cuenta_id: rid(mapa, a.cuentaId), p_items: [{ producto_id: a.p.id, qty: 1 }] })
      const c = cuentaRecien(estado.cuentas, x => x.id === a.cuentaId || x.id === rid(mapa, a.cuentaId))
      if (c) remapItems(mapa, c.items, itemsDb)
      return refrescarNegocio(E)
    }
    case 'qty': {
      await rpc('cambiar_qty_item', { p_item_id: rid(mapa, a.itemId), p_delta: a.d })
      if (a.d < 0) { const real = mapa.get(a.itemId); if (real) mapa.delete(a.itemId) }
      return refrescarNegocio(E)
    }
    case 'nota':
      await rpc('poner_nota', { p_item_id: rid(mapa, a.itemId), p_nota: a.nota || '' })
      return refrescarNegocio(E)
    case 'enviar':
      await rpc('enviar_items', { p_cuenta_id: rid(mapa, a.cuentaId) })
      return refrescarNegocio(E)
    case 'anular':
      await rpc('anular_item', { p_item_id: rid(mapa, a.itemId), p_motivo: a.motivo || '' })
      return refrescarNegocio(E)
    case 'precuenta':
      await rpc('pre_cuenta', { p_cuenta_id: rid(mapa, a.cuentaId) })
      return refrescarNegocio(E)
    case 'reabrir':
      await rpc('reabrir_cuenta', { p_cuenta_id: rid(mapa, a.cuentaId) })
      return refrescarNegocio(E)
    case 'extras':
      // El PIN que pide PedidoPanel es un flujo demo; en Supabase la base exige el
      // pin_descuento_hash de la membresía (sin pin → error legible si el rol no es admin).
      await rpc('aplicar_extras', { p_cuenta_id: rid(mapa, a.cuentaId), p_propina: a.propina ?? null, p_descuento: a.descuento ?? null })
      return refrescarNegocio(E)
    case 'comensales~':
      await rpc('actualizar_comensales', { p_cuenta_id: rid(mapa, a.cuentaId), p_comensales: a.comensales })
      return refrescarNegocio(E)
    case 'cobrar': {
      const ticket = await rpc('cobrar_cuenta', {
        p_cuenta_id: rid(mapa, a.cuentaId),
        p_pagos: mapPagos(a.pagos),
        p_propina: a.propina ?? null,
        p_descuento: a.descuento ?? null,
      })
      ctx.onTicket?.(ticket) // por si algún día se quiere imprimir desde el adaptador
      return refrescarNegocio(E)
    }
    case 'unir':
      await rpc('unir_mesas', { p_cuenta_id: rid(mapa, a.cuentaId), p_mesa_ids: a.mesaIds })
      return refrescarNegocio(E)
    case 'separar': {
      const dbId = await rpc('separar_mesa', { p_cuenta_id: rid(mapa, a.cuentaId), p_mesa_id: a.mesaId })
      const locId = (a._nuevos?.cuentas || [])[0]
      if (locId && locId !== dbId) mapa.set(locId, dbId)
      return refrescarNegocio(E)
    }
    case 'mover': {
      const dbDest = await rpc('mover_items', {
        p_cuenta_id: rid(mapa, a.cuentaId),
        p_item_ids: (a.itemIds || []).map(i => rid(mapa, i)),
        ...(a.cuentaDestinoId ? { p_cuenta_destino_id: rid(mapa, a.cuentaDestinoId) } : {}),
        ...(a.mesaDestino ? { p_mesa_destino: a.mesaDestino } : {}),
      })
      if (a.mesaDestino && dbDest !== rid(mapa, a.cuentaId)) {
        const locId = (a._nuevos?.cuentas || [])[0]
        if (locId && locId !== dbDest) mapa.set(locId, dbDest)
      }
      return refrescarNegocio(E)
    }

    // ── caja (RPCs §3.14-3.16) ──
    case 'turno+':
      await rpc('abrir_turno', { p_fondo: a.fondo || 0 })
      return refrescarNegocio(E)
    case 'turno-':
      await rpc('cerrar_turno', { p_contado: a.contado || 0 })
      return refrescarNegocio(E)
    case 'caja-mov+':
      await rpc('registrar_movimiento_caja', { p_tipo: a.tipo, p_monto: a.monto, p_motivo: a.motivo || null })
      return refrescarNegocio(E)

    // ── catálogo: escritura directa en tablas (RLS exige rol admin; CONTRATO §4) ──
    case 'mesa+': {
      const { error } = await sb.from('mesas').insert({
        id: a.mesa.id, empresa_id: empresaId, zona_id: a.mesa.zona ?? null, nombre: a.mesa.nombre,
        x: a.mesa.x, y: a.mesa.y, w: a.mesa.w, h: a.mesa.h, forma: a.mesa.forma, capacidad: a.mesa.cap ?? 4, activa: true,
      })
      if (error) throw new Error(error.message)
      return E
    }
    case 'mesa~': {
      const campos = { ...a.cambios }
      const row = { nombre: campos.nombre, zona_id: campos.zona, x: campos.x, y: campos.y, w: campos.w, h: campos.h, forma: campos.forma, capacidad: campos.cap }
      Object.keys(row).forEach(k => { if (row[k] === undefined) delete row[k] })
      const { error } = await sb.from('mesas').update(row).eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return E
    }
    case 'mesa-': {
      const { error } = await sb.from('mesas').delete().eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return { ...E, mesas: E.mesas.filter(m => m.id !== a.id) }
    }
    case 'zona+': {
      const { error } = await sb.from('zonas').insert({ id: a.zona.id ?? undefined, empresa_id: empresaId, nombre: a.zona.nombre, orden: estado.zonas.length + 1 })
      if (error) throw new Error(error.message)
      return E
    }
    case 'zona~': {
      const { error } = await sb.from('zonas').update({ nombre: a.cambios.nombre, orden: a.cambios.orden }).eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return { ...E, zonas: E.zonas.map(z => (z.id === a.id ? { ...z, ...a.cambios } : z)) }
    }
    case 'zona-': {
      const { error } = await sb.from('zonas').delete().eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return { ...E, zonas: E.zonas.filter(z => z.id !== a.id), mesas: E.mesas.map(m => (m.zona === a.id ? { ...m, zona: null } : m)) }
    }
    case 'seccion+': {
      // Se inserta con el id optimista generado por el reducer (a._nuevos) para que las
      // ediciones siguientes ('seccion~') referencien un id que ya existe en la base.
      const locId = (a._nuevos?.secciones || [])[0] || E.secciones[E.secciones.length - 1]?.id
      const { error } = await sb.from('secciones_menu').insert({ id: locId, empresa_id: empresaId, nombre: a.seccion.nombre, orden: E.secciones.length })
      if (error) throw new Error(error.message)
      return E
    }
    case 'seccion~': {
      const { error } = await sb.from('secciones_menu').update({ nombre: a.cambios.nombre, orden: a.cambios.orden }).eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return E
    }
    case 'seccion-': {
      // CONTRATO: productos de la sección → activo=false; luego delete de la sección.
      const p1 = await sb.from('productos').update({ activo: false }).eq('seccion_id', rid(mapa, a.id))
      if (p1.error) throw new Error(p1.error.message)
      const p2 = await sb.from('secciones_menu').delete().eq('id', rid(mapa, a.id))
      if (p2.error) throw new Error(p2.error.message)
      const [productos, secciones] = await Promise.all([
        selectAll(sb.from('productos').select('*').eq('empresa_id', empresaId).order('nombre')),
        selectAll(sb.from('secciones_menu').select('*').eq('empresa_id', empresaId).order('orden')),
      ])
      return { ...E, productos: productos.map(mapProducto), secciones: secciones.map(mapSeccion) }
    }
    case 'producto+': {
      const locId = (a._nuevos?.productos || [])[0] || E.productos[E.productos.length - 1]?.id
      const { error } = await sb.from('productos').insert({ id: locId, empresa_id: empresaId, nombre: a.producto.nombre, seccion_id: a.producto.seccionId ?? null, precio: a.producto.precio, activo: true, imagen_path: a.producto.imagen_path ?? null })
      if (error) throw new Error(error.message)
      return E
    }
    case 'producto~': {
      const row = { nombre: a.cambios.nombre, precio: a.cambios.precio, activo: a.cambios.activo, seccion_id: a.cambios.seccionId, imagen_path: a.cambios.imagen_path }
      Object.keys(row).forEach(k => { if (row[k] === undefined) delete row[k] })
      const { error } = await sb.from('productos').update(row).eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return E
    }
    case 'producto-': {
      // Borrar = desactivar (los snapshots históricos se conservan).
      const { error } = await sb.from('productos').update({ activo: false }).eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return { ...E, productos: E.productos.filter(p => p.id !== a.id) }
    }

    // ── config: update de empresas (RLS admin) ──
    case 'cfg~': {
      const { nombre, moneda, ivaPct, propinaPct, ...resto } = a.cambios || {}
      const row = {}
      if (nombre !== undefined) row.nombre = nombre
      if (moneda !== undefined) row.moneda = moneda
      if (ivaPct !== undefined) row.iva_pct = ivaPct
      if (propinaPct !== undefined) row.propina_pct = propinaPct
      // config jsonb: claves sueltas (impresora…). Las columnares ya van en `row`.
      if (Object.keys(resto).length) {
        const cfg = { ...(estado._configRaw || {}) }
        Object.entries(resto).forEach(([k, v]) => { cfg[k] = v })
        row.config = cfg
      }
      const { error } = await sb.from('empresas').update(row).eq('id', empresaId)
      if (error) throw new Error(error.message)
      const [emp] = await selectAll(sb.from('empresas').select('*').eq('id', empresaId))
      return {
        ...E,
        _configRaw: emp.config || {},
        config: { nombre: emp.nombre, moneda: emp.moneda, ivaPct: N(emp.iva_pct), propinaPct: N(emp.propina_pct), ...(emp.config || {}) },
      }
    }

    case 'reset': // exclusivo del modo demo
      return E

    default:
      return E
  }
}
