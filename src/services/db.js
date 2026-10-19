import { sb, rpc, fijarEmpresaSesion } from './supabaseClient.js'
import { borrarImagen } from './imageUpload.js'

const N = x => Number(x ?? 0)
const ts = iso => (iso ? new Date(iso).getTime() : undefined)
const hoyISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

const mapZona = z => ({ id: z.id, nombre: z.nombre })
const mapMesa = m => ({ id: m.id, zona: m.zona_id, nombre: m.nombre, x: N(m.x), y: N(m.y), w: N(m.w), h: N(m.h), forma: m.forma, cap: N(m.capacidad) })
const mapSeccion = s => ({ id: s.id, nombre: s.nombre, orden: N(s.orden) })
const mapProducto = p => ({
  id: p.id, nombre: p.nombre, seccionId: p.seccion_id, precio: N(p.precio), activo: p.activo, imagen_path: p.imagen_path ?? null,

  areas: Array.isArray(p.areas) && p.areas.length ? p.areas : ['cocina'],
  opciones: Array.isArray(p.opciones) ? p.opciones : [],
})

const mapItem = i => ({
  id: i.id, productoId: i.producto_id, nombre: i.nombre_snapshot, precio: N(i.precio_snapshot),
  qty: N(i.qty), estado: i.estado, nota: i.nota || '', motivo: i.anulacion_motivo ?? i.motivo_anulacion,
  areas: Array.isArray(i.areas) && i.areas.length ? i.areas : undefined,
  areasListas: Array.isArray(i.areas_listas) ? i.areas_listas : [],
  enviadoEn: ts(i.enviado_en), creadaEn: ts(i.creada_en),

  ...(i.listo_en ? { listoEn: ts(i.listo_en) } : {}),
  ...(i.anulacion_pedida_en ? { anulacionPedidaEn: ts(i.anulacion_pedida_en), anulacionPor: i.anulacion_por, anulacionEstadoPrevio: i.anulacion_estado_previo } : {}),
  ...(i.anulacion_resuelta_en ? { anulacionResueltaEn: ts(i.anulacion_resuelta_en), anulacionResueltaPor: i.anulacion_resuelta_por } : {}),
})

const mapPago = p => ({ id: p.id, metodo: p.metodo, monto: N(p.monto), ...(p.detalle && typeof p.detalle === 'object' ? p.detalle : {}), creadaEn: ts(p.creada_en) })

const mapMov = m => ({ id: m.id, t: m.tipo, monto: N(m.monto), motivo: m.motivo, creadaEn: ts(m.creada_en) })

const mapTurno = (t, nombres) => ({
  id: t.id,
  abiertoEn: ts(t.abierto_en),
  abiertoPor: nombres[t.abierto_por] || t.abierto_por,
  abiertoPorId: t.abierto_por,
  modo: t.modo || 'compartida',
  fondo: N(t.fondo),
  movimientos: ((t.movimientos && t.movimientos.movimientos) || []).map(mapMov),
  ...(t.cerrado_en ? {
    cerradoEn: ts(t.cerrado_en),
    cerradoPor: nombres[t.cerrado_por] || t.cerrado_por,
    contado: N(t.contado),
    esperado: N(t.esperado),
  } : {}),
})

async function selectAll(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

async function fetchCuentas(empresaId, caja) {

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
  const { data: ses } = await sb.auth.getSession()
  const uid = ses?.session?.user?.id
  const [abiertos, historial] = await Promise.all([
    selectAll(sb.from('turnos_caja').select('*').eq('empresa_id', empresaId).is('cerrado_en', null).order('abierto_en', { ascending: false }).limit(50)),
    selectAll(sb.from('turnos_caja').select('*').eq('empresa_id', empresaId).not('cerrado_en', 'is', null).order('abierto_en', { ascending: false }).limit(15)),
  ])
  // Caja compartida: el único turno abierto del local. Un turno por cajero: EL MÍO (los de los demás van aparte).
  const mio = abiertos.find(x => x.modo === 'por_cajero' && x.abierto_por === uid) || abiertos.find(x => x.modo !== 'por_cajero') || null
  return { abierto: mio, otros: abiertos.filter(x => x !== mio), historial }
}

async function fetchDevoluciones(empresaId, cajaT, nombres) {
  try {
    const aperturas = [cajaT?.abierto?.abierto_en, ...((cajaT?.historial) || []).map(t => t.abierto_en)].filter(Boolean).map(x => new Date(x).getTime())
    const desde = new Date(aperturas.length ? Math.min(...aperturas) : new Date(hoyISO()).getTime()).toISOString()
    const rows = await selectAll(sb.from('devoluciones_item').select('*').eq('empresa_id', empresaId).gte('pedida_en', desde).order('pedida_en'))
    return rows.map(r => ({
      id: r.id, cuentaId: r.cuenta_id, itemId: r.item_id, area: r.area, nombre: r.nombre, qty: N(r.qty), monto: N(r.monto),
      mesa: r.mesa || '', motivo: r.motivo, turnoId: r.turno_id || null,
      pedidaPor: nombres[r.pedida_por] || '', pedidaEn: ts(r.pedida_en),
      confirmadaPor: r.confirmada_por ? (nombres[r.confirmada_por] || '') : '', confirmadaEn: r.confirmada_en ? ts(r.confirmada_en) : null,
      nota: r.nota_confirmacion || '',
    }))
  } catch { return [] }
}

async function fetchNombres() {

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
    etiqueta: c.etiqueta || '',
    comensales: N(c.comensales),
    propina: N(c.propina),
    descuento: N(c.descuento),
    nota: c.nota ?? undefined,
    abiertaPor: nombres[c.abierta_por] || undefined,
    abiertaEn: ts(c.abierta_en),
    cerradaPor: c.cerrada_por ? (nombres[c.cerrada_por] || undefined) : undefined,
    cerradaEn: ts(c.cerrada_en),
    items: (itemsBy[c.id] || []).map(mapItem),
    pagos: (pagosBy[c.id] || []).map(mapPago),
  }))
}

const armarCaja = (abierto, historial, nombres, siguienteTurno, cajaPrev, otros = []) => ({
  turno: abierto ? mapTurno(abierto, nombres) : null,
  otros: otros.map(x => mapTurno(x, nombres)),
  historial: historial.map(t => mapTurno(t, nombres)),

  siguienteTurno: siguienteTurno ?? cajaPrev?.siguienteTurno ?? 1,
})

export async function cargarEstadoInicial(empresaId) {
  if (!sb) throw new Error('Supabase no está configurado')

  await fijarEmpresaSesion(empresaId)
  const nombres = await fetchNombres()

  const cajaP = fetchCaja(empresaId)
  const [empresas, zonas, mesas, secciones, productos, cajaT, dataCuentas, numeradas] = await Promise.all([
    selectAll(sb.from('empresas').select('*').eq('id', empresaId)),
    selectAll(sb.from('zonas').select('*').eq('empresa_id', empresaId).order('orden')),
    selectAll(sb.from('mesas').select('*').eq('empresa_id', empresaId).eq('activa', true).order('nombre')),
    selectAll(sb.from('secciones_menu').select('*').eq('empresa_id', empresaId).order('orden')),
    selectAll(sb.from('productos').select('*').eq('empresa_id', empresaId).order('nombre')),
    cajaP,
    cajaP.then(t => fetchCuentas(empresaId, { turno: t.abierto ? mapTurno(t.abierto, nombres) : null, historial: t.historial.map(x => mapTurno(x, nombres)) })),

    selectAll(sb.from('cuentas').select('numero').eq('empresa_id', empresaId).eq('tipo', 'directa').gte('abierta_en', hoyISO()).order('numero', { ascending: false }).limit(1)),
  ])
  const emp = empresas[0]
  if (!emp) throw new Error('No tienes acceso a esta empresa (o no existe)')
  const cuentas = armarCuentas(dataCuentas.cuentas, dataCuentas.items, dataCuentas.pagos, dataCuentas.cms, nombres)
  const devoluciones = await fetchDevoluciones(empresaId, cajaT, nombres)
  return {
    config: { nombre: emp.nombre, moneda: emp.moneda, ivaPct: N(emp.iva_pct), propinaPct: N(emp.propina_pct), ...(emp.config && typeof emp.config === 'object' ? emp.config : {}) },
    _configRaw: (emp.config && typeof emp.config === 'object') ? emp.config : {},
    zonas: zonas.map(mapZona),
    mesas: mesas.map(mapMesa),
    secciones: secciones.map(mapSeccion),
    productos: productos.map(mapProducto),
    cuentas,
    devoluciones,
    caja: armarCaja(cajaT.abierto, cajaT.historial, nombres, N(numeradas[0]?.numero || 0) + 1, undefined, cajaT.otros),
    usuariosDemo: [],
    _sup: true,
  }
}

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
    devoluciones: await fetchDevoluciones(empresaId, cajaT, nombres),
    caja: armarCaja(cajaT.abierto, cajaT.historial, nombres, undefined, estado.caja, cajaT.otros),
  }
}

const rid = (mapa, id) => (id ? mapa.get(id) || id : id)

function remapItems(mapa, prevItems, respItems) {
  const usados = new Set()
  for (const it of prevItems) {
    if (mapa.has(it.id)) continue
    if (respItems.some(r => r.id === it.id)) continue
    const cand = respItems.find(r => !usados.has(r.id) && r.id !== it.id
      && (r.producto_id || null) === (it.productoId || null)
      && (r.nota || '') === (it.nota || ''))
    if (cand) { usados.add(cand.id); mapa.set(it.id, cand.id) }
  }
}

function cuentaRecien(cuentas, filtro) {
  for (let i = cuentas.length - 1; i >= 0; i--) if (filtro(cuentas[i])) return cuentas[i]
  return null
}

const DETALLE_KEYS = ['recibido', 'cambio', 'referencia', 'tarjeta', 'ultimos4']
const mapPagos = pagos => (pagos || []).map(p => {
  const detalle = {}
  for (const k of DETALLE_KEYS) if (p[k] !== undefined && p[k] !== null) detalle[k] = p[k]
  return { metodo: p.metodo, monto: p.monto, ...(Object.keys(detalle).length ? { detalle } : {}) }
})

export async function despacharSupabase(estado, a, ctx = {}) {
  const mapa = ctx.mapa || new Map()
  const empresaId = estado._empresaId
  if (!empresaId) throw new Error('No hay empresa activa')
  const E = { ...estado, _empresaId: empresaId }

  switch (a.t) {

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

      const itemsDb = await rpc('agregar_items', { p_cuenta_id: rid(mapa, a.cuentaId), p_items: [{ producto_id: a.p.id, qty: 1, ...(a.nota ? { nota: a.nota } : {}) }] })
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
      ctx.onTicket?.(ticket)
      return refrescarNegocio(E)
    }
    case 'unir':
      await rpc('unir_mesas', { p_cuenta_id: rid(mapa, a.cuentaId), p_mesa_ids: a.mesaIds })
      return refrescarNegocio(E)
    case 'dividir': {
      const dbId = await rpc('dividir_cuenta', { p_cuenta_id: rid(mapa, a.cuentaId) })
      const locId = (a._nuevos?.cuentas || [])[0]
      if (locId && locId !== dbId) mapa.set(locId, dbId)
      return refrescarNegocio(E)
    }
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

    case 'intercambiar': {
      await rpc('mover_items', { p_cuenta_id: rid(mapa, a.cuentaA), p_item_ids: [rid(mapa, a.itemA)], p_cuenta_destino_id: rid(mapa, a.cuentaB) })
      await rpc('mover_items', { p_cuenta_id: rid(mapa, a.cuentaB), p_item_ids: [rid(mapa, a.itemB)], p_cuenta_destino_id: rid(mapa, a.cuentaA) })
      return refrescarNegocio(E)
    }

    case 'turno+':
      await rpc('abrir_turno', { p_fondo: a.fondo || 0 })
      return refrescarNegocio(E)
    case 'turno-':
      await rpc('cerrar_turno', { p_contado: a.contado || 0 })
      return refrescarNegocio(E)
    case 'caja-mov+':
      await rpc('registrar_movimiento_caja', { p_tipo: a.tipo, p_monto: a.monto, p_motivo: a.motivo || null })
      return refrescarNegocio(E)

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

      const secId = rid(mapa, a.id)
      const { data: delSec } = await sb.from('productos').select('imagen_path').eq('seccion_id', secId)
      const p1 = await sb.from('productos').delete().eq('seccion_id', secId)
      if (p1.error) throw new Error(p1.error.message)
      for (const f of delSec || []) { if (f.imagen_path) { try { await borrarImagen(sb, f.imagen_path) } catch {  } } }
      const p2 = await sb.from('secciones_menu').delete().eq('id', secId)
      if (p2.error) throw new Error(p2.error.message)
      const [productos, secciones] = await Promise.all([
        selectAll(sb.from('productos').select('*').eq('empresa_id', empresaId).order('nombre')),
        selectAll(sb.from('secciones_menu').select('*').eq('empresa_id', empresaId).order('orden')),
      ])
      return { ...E, productos: productos.map(mapProducto), secciones: secciones.map(mapSeccion) }
    }
    case 'producto+': {
      const locId = (a._nuevos?.productos || [])[0] || E.productos[E.productos.length - 1]?.id
      const { error } = await sb.from('productos').insert({ id: locId, empresa_id: empresaId, nombre: a.producto.nombre, seccion_id: a.producto.seccionId ?? null, precio: a.producto.precio, activo: true, imagen_path: a.producto.imagen_path ?? null, areas: Array.isArray(a.producto.areas) && a.producto.areas.length ? a.producto.areas : ['cocina'], opciones: Array.isArray(a.producto.opciones) ? a.producto.opciones : [] })
      if (error) throw new Error(error.message)
      return E
    }
    case 'producto~': {
      const row = { nombre: a.cambios.nombre, precio: a.cambios.precio, activo: a.cambios.activo, seccion_id: a.cambios.seccionId, imagen_path: a.cambios.imagen_path, areas: a.cambios.areas, opciones: a.cambios.opciones }
      Object.keys(row).forEach(k => { if (row[k] === undefined) delete row[k] })
      const { error } = await sb.from('productos').update(row).eq('id', rid(mapa, a.id))
      if (error) throw new Error(error.message)
      return E
    }
    case 'producto-': {

      const id = rid(mapa, a.id)
      const { data: fila } = await sb.from('productos').select('imagen_path').eq('id', id).maybeSingle()
      const { error } = await sb.from('productos').delete().eq('id', id)
      if (error) throw new Error(error.message)
      if (fila?.imagen_path) { try { await borrarImagen(sb, fila.imagen_path) } catch {  } }
      return { ...E, productos: E.productos.filter(p => p.id !== a.id) }
    }

    case 'area-': {
      await rpc('retirar_area', { p_area: a.id, p_reemplazo: a.reemplazo || 'cocina' })
      return refrescarNegocio(E)
    }
    case 'cfg~': {
      const { nombre, moneda, ivaPct, propinaPct, ...resto } = a.cambios || {}
      const row = {}
      if (nombre !== undefined) row.nombre = nombre
      if (moneda !== undefined) row.moneda = moneda
      if (ivaPct !== undefined) row.iva_pct = ivaPct
      if (propinaPct !== undefined) row.propina_pct = propinaPct

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

    case 'reset':
      return E

    default:
      return E
  }
}
