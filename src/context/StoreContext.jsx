import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { USAR_SUPABASE } from '../services/config.js'
import { fijarEmpresa } from '../services/supabaseClient.js'
import { cargarEstadoInicial, despacharSupabase } from '../services/db.js'
import { round2 } from '../services/format.js'
import { round4, resolverCantidad, aplicarEntrada, MOTIVOS_MERMA } from '../services/inventario.js'
import { repartirPorGrupo } from '../services/printing.js'
import { notaProtegida } from '../services/indicaciones.js'
import { unirCuentas } from '../services/subcuentas.js'
const uid = () => crypto.randomUUID()

// La base puede avisar con «codigo: texto legible» (raise exception); al mesero le sirve la frase sola.
const textoError = e => {
  const crudo = (e && (e.message || e.error_description || String(e))) || 'Error inesperado'
  const m = /^([a-z_]+):\s/.exec(crudo)
  return m ? crudo.slice(m[0].length) : crudo
}

const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0 }
// Stock y cantidades de receta son numeric(12,3) en la base: tres decimales, no enteros.
const round3 = x => Math.round(num(x) * 1000) / 1000
const fechaLocal = (d = new Date()) => { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const KEY = 'pos-control-demo-v3'
const KEY_SESION = 'pos-sesion'

const secciones = [
  { id: 's1', nombre: 'Desayunos', orden: 1 },
  { id: 's2', nombre: 'Comida', orden: 2 },
  { id: 's3', nombre: 'Bebidas', orden: 3 },
  { id: 's4', nombre: 'Snacks', orden: 4 },
]
// 18 platos en 4 grupos: así la carta tiene scroll real, buscador con coincidencias, varios ítems
// por grupo y producto con costo, margen, área mixta (cocina + barra) y agotado.
const PLATOS = [
  ['Café', 's1', 10], ['Api con pastel', 's1', 12], ['Sándwich de chola', 's1', 18], ['Frankfurter', 's1', 15],
  ['Milanesa con papas', 's2', 45], ['Pique macho', 's2', 60], ['Sopa del día', 's2', 20], ['Silpanote', 's2', 55],
  ['Marquesillo', 's2', 30], ['Arroz con pollo', 's2', 35], ['Higado a la plancha', 's2', 40], ['Rímbol', 's2', 28],
  ['Jugo de naranja', 's3', 14], ['Refresco', 's3', 10], ['Cerveza nacional', 's3', 25], ['Singani a la moda', 's3', 40],
  ['Papas fritas', 's4', 18], ['Maní con cervezas', 's4', 22],
].map(([nombre, seccionId, precio]) => ({ id: uid(), nombre, seccionId, precio, activo: true }))
// Los tres primeros grupos van a cocina; las bebidas y el picoteo salen también por barra.
const AREAS_DEMO = { s1: ['cocina'], s2: ['cocina'], s3: ['barra'], s4: ['cocina', 'barra'] }
const productos = PLATOS.map(p => ({ ...p, areas: AREAS_DEMO[p.seccionId] }))

// Catálogo de indicaciones con reglas enganchadas a productos y a grupos: es lo que hace aparecer
// el picker en la comanda (sin esto, la pantalla de Indicaciones estaba vacía en demo).
const porNombre = nombre => productos.filter(p => p.nombre === nombre).map(p => p.id)
const INDICACIONES_DEMO = [
  { id: 'ind1', nombre: 'Término de la carne', obligatoria: true, min: 1, max: 1, secciones: ['s2'], productos: porNombre('Silpanote'),
    opciones: ['jugoso', 'a punto', 'bien cocido'], detalle: { 'bien cocido': { extra: 3 } } },
  { id: 'ind2', nombre: 'Picante', obligatoria: false, min: 0, max: 2, secciones: [], productos: porNombre('Pique macho'),
    opciones: ['sin picante', 'poco', 'bastante'], detalle: { 'bastante': { extra: 0 } } },
  { id: 'ind3', nombre: 'Adicionales', obligatoria: false, min: 0, max: 3, secciones: ['s2'], productos: porNombre('Milanesa con papas'),
    opciones: ['huevo extra', 'papas más', 'queso'], detalle: { 'huevo extra': { extra: 5 }, 'papas más': { extra: 8 }, 'queso': { extra: 6 } } },
  { id: 'ind4', nombre: 'Temperatura de la bebida', obligatoria: false, min: 0, max: 1, secciones: ['s3'], productos: [],
    opciones: ['bien fría', 'con hielo', 'sin hielo'], detalle: {} },
  { id: 'ind5', nombre: 'Presentación', obligatoria: false, min: 0, max: 1, secciones: [], productos: [],
    opciones: ['para llevar', 'en el local'], detalle: {} },
  { id: 'ind6', nombre: 'Tostado del pan', obligatoria: false, min: 0, max: 1, secciones: ['s1'], productos: [],
    opciones: ['normal', 'tosado', 'sin tostar'], detalle: {} },
  { id: 'ind7', nombre: 'Azúcar', obligatoria: false, min: 0, max: 1, secciones: ['s1'], productos: porNombre('Café'),
    opciones: ['con azúcar', 'sin azúcar', 'extra dulce'], detalle: {} },
]

const GRUPOS_DEMO = [
  { id: 'cocina', nombre: 'Cocina', ancho: 32, baud: 9600 },
  { id: 'barra', nombre: 'Barra', ancho: 32, baud: 9600 },
  { id: 'caja', nombre: 'Caja (tickets)', ancho: 32, baud: 9600, tickets: true },
]

// 24 insumos: varios por debajo del mínimo y otros justo en el límite, para que el semáforo de
// Inventario y la regla de stock bajo de Alertas tengan algo que mostrar desde el primer minuto.
const INSUMOS_DEMO = [
  ['Carne de res', 'kg', 8.5, 4, 30], ['Carne de pollo', 'kg', 6, 3, 22], ['Hígado de res', 'kg', 2.5, 2, 18],
  ["Ch'arki", 'kg', 1.2, 2, 45], ['Papa', 'kg', 20, 8, 6], ['Papa amarilla', 'kg', 5, 6, 8],
  ['Arroz', 'kg', 15, 5, 8.5], ['Aceite', 'litro', 4, 3, 12], ['Sal', 'kg', 3, 1, 4],
  ['Cebolla', 'kg', 7, 3, 5], ['Tomate', 'kg', 4, 3, 6], ['Zanahoria', 'kg', 2, 2, 5],
  ['Huevo', 'unidad', 60, 24, 1.2], ['Queso', 'kg', 3, 2, 28], ['Leche', 'litro', 6, 4, 7.5],
  ['Harina', 'kg', 9, 3, 5.5], ['Azúcar', 'kg', 10, 4, 6], ['Café molido', 'kg', 1.5, 1, 40],
  ['Naranja', 'unidad', 25, 20, 2], ['Cerveza en lata', 'unidad', 48, 24, 8], ['Refresco 2.25 L', 'unidad', 12, 6, 9],
  ['Singani', 'litro', 2, 1, 60], ['Maní', 'kg', 3, 1.5, 16], ['Pan', 'unidad', 30, 12, 2.5],
].map(([nombre, unidad, stock, stock_min, costo], i) => ({ id: 'ins' + (i + 1), nombre, unidad, stock, stock_min, costo, activo: true, presentaciones: [], con_merma: false, rendimiento_esp: null }))
  // Dos insumos de muestra con presentaciones y merma de limpieza (el resto queda sin presentaciones).
  .map(i => (i.nombre === 'Singani'
    ? { ...i, presentaciones: [{ id: 'pr-sing-750', nombre: 'Botella 750 ml', cantidad: 0.75, costo: 45, activo: true, principal: true }, { id: 'pr-sing-1', nombre: 'Botella 1 L', cantidad: 1, costo: 60, activo: true, principal: false }] }
    : i.nombre === 'Carne de res'
      ? { ...i, con_merma: true, rendimiento_esp: 84, presentaciones: [{ id: 'pr-carne-5', nombre: 'Bolsa 5 kg', cantidad: 5, costo: 150, activo: true, principal: true }] }
      : i))

// Receta por nombre de plato: es lo que engancha el inventario con la carta (y lo que descuenta
// stock al cobrar). Se resuelve contra los productos que hay en el estado, no contra los de acá.
const RECETAS_DEMO = {
  'Milanesa con papas': [['Carne de res', 0.25], ['Papa', 0.3], ['Aceite', 0.05], ['Huevo', 1], ['Harina', 0.05]],
  'Pique macho': [['Carne de res', 0.3], ['Papa', 0.25], ['Tomate', 0.1], ['Cebolla', 0.1], ['Huevo', 1], ['Aceite', 0.05]],
  'Sopa del día': [['Carne de pollo', 0.2], ['Zanahoria', 0.08], ['Arroz', 0.1], ['Papa', 0.15]],
  'Silpanote': [['Carne de res', 0.35], ['Huevo', 2], ['Queso', 0.08], ['Papa', 0.2], ["Ch'arki", 0.05]],
  'Marquesillo': [['Carne de res', 0.25], ['Papa amarilla', 0.3], ['Huevo', 1]],
  'Arroz con pollo': [['Carne de pollo', 0.2], ['Arroz', 0.15], ['Tomate', 0.05], ['Cebolla', 0.05]],
  'Higado a la plancha': [['Hígado de res', 0.25], ['Cebolla', 0.08], ['Harina', 0.03]],
  'Rímbol': [['Huevo', 2], ['Harina', 0.1], ['Queso', 0.05]],
  'Café': [['Café molido', 0.02], ['Leche', 0.15], ['Azúcar', 0.02]],
  'Api con pastel': [['Harina', 0.08], ['Azúcar', 0.04], ['Leche', 0.1]],
  'Sándwich de chola': [['Pan', 1], ['Carne de res', 0.08], ['Tomate', 0.05]],
  'Frankfurter': [['Pan', 1], ['Huevo', 1]],
  'Jugo de naranja': [['Naranja', 3], ['Azúcar', 0.02]],
  'Refresco': [['Refresco 2.25 L', 0.33]],
  'Cerveza nacional': [['Cerveza en lata', 1]],
  'Singani a la moda': [['Singani', 0.08], ['Azúcar', 0.02]],
  'Papas fritas': [['Papa', 0.35], ['Aceite', 0.05], ['Sal', 0.005]],
  'Maní con cervezas': [['Maní', 0.15], ['Cerveza en lata', 1]],
}
// La receta demo usa los mismos nombres de campo que devuelve el servidor (insumo_id), así la
// pantalla de Inventario lee igual en los dos modos.
const recetasDeDemo = (productos = [], insumos = INSUMOS_DEMO) => {
  const porNombre = new Map(insumos.map(i => [i.nombre, i.id]))
  return productos.flatMap(p => (RECETAS_DEMO[p.nombre] || []).flatMap(([nombre, cantidad]) => {
    const insumo_id = porNombre.get(nombre)
    return insumo_id ? [{ productoId: p.id, insumo_id, cantidad }] : []
  }))
}
const costoReceta = (productoId, recetas = [], insumos = INSUMOS_DEMO) => round2(
  (recetas || []).filter(r => r.productoId === productoId)
    .reduce((t, r) => t + num((insumos || []).find(i => i.id === r.insumo_id)?.costo) * num(r.cantidad), 0))

const PROVEEDOR_POR_SECCION = { s1: 'pv2', s2: 'pv1', s3: 'pv1', s4: 'pv1' }
// El costo sale de la receta cuando existe; si no, de un porcentaje del precio (igual que en la base).
const costoDeDemo = () => productos.map(p => {
  const rec = costoReceta(p.id, recetasDeDemo(productos))
  return {
    productoId: p.id, costo: rec > 0 ? rec : round2(p.precio * (p.seccionId === 's1' ? 0.45 : 0.35)),
    proveedorId: PROVEEDOR_POR_SECCION[p.seccionId] || 'pv1',
  }
})
// Un historial corto para que la pestaña Movimientos y su CSV no salgan vacíos.
const movimientosDeDemo = (insumos = INSUMOS_DEMO) => {
  const h = n => new Date(Date.now() - n * 3600000).toISOString()
  const ins = id => insumos.find(x => x.id === id) || {}
  const fila = (horas, id, tipo, cantidad, nota, usuario) => ({
    id: uid(), en: h(horas), insumo_id: id, insumo_nombre: ins(id).nombre || '', tipo, cantidad,
    stock_after: ins(id).stock ?? 0, nota, usuario_nombre: usuario,
  })
  return [
    fila(50, 'ins1', 'entrada', 10, 'Compra al depósito', 'Administrador'),
    fila(46, 'ins5', 'entrada', 25, 'Saco de papa', 'Administrador'),
    fila(30, 'ins13', 'salida', 6, 'Rotos en la caja', 'Cajero'),
    fila(26, 'ins4', 'salida', 0.8, 'Merma del día', 'Administrador'),
    fila(20, 'ins19', 'ajuste', 25, 'Conteo de la mañana', 'Administrador'),
    fila(5, 'ins20', 'venta', 6, 'venta cuenta 11', 'sistema'),
    fila(3, 'ins1', 'venta', 1.2, 'venta cuenta 12', 'sistema'),
  ]
}

// Para que el Menú (costo/margen) y Proveedores tengan algo que mostrar en demo.
const PROVEEDORES_DEMO = [
  { id: 'pv1', nombre: 'Depósito La Rápida', telefono: '700 11 223', email: '', direccion: 'Av. Blanco s/n', nota: '', activo: true },
  { id: 'pv2', nombre: 'Lácteos y Quesos SRL', telefono: '', email: 'ventas@lacteos.demo', direccion: '', nota: 'Fía 8 días', activo: true },
]
const deudasDeDemo = () => {
  const ayer = fechaLocal(Date.now() - 86400000), hace5 = fechaLocal(Date.now() - 5 * 86400000)
  return [
    { id: uid(), proveedorId: 'pv1', fecha: hace5, vencimiento: ayer, concepto: 'Túley, arroz y aceite', monto: 850, pagado: 300, saldo: 550, nota: '', creadaEn: Date.now() - 5 * 86400000, pagadaEn: null },
    { id: uid(), proveedorId: 'pv2', fecha: ayer, vencimiento: null, concepto: 'Leche y queso para los desayunos', monto: 420, pagado: 0, saldo: 420, nota: '', creadaEn: Date.now() - 86400000, pagadaEn: null },
    { id: uid(), proveedorId: 'pv1', fecha: ayer, vencimiento: null, concepto: 'Cerveza y refrescos', monto: 600, pagado: 600, saldo: 0, nota: '', creadaEn: Date.now() - 86400000, pagadaEn: Date.now() - 3600000 },
  ]
}

// Historial de ventas cerradas para que Reportes, Caja y el mapa de ventas tengan historia que mostrar.
// Formato: [días atrás, hora, mesa(s) | null (mostrador) | 'llevar', comensales, usuario, método, propina, ítems].
// Los precios se leen de la carta del propio estado, así los totales nunca se inventan.
const VENTAS_DEMO = [
  [0, 13, ['m2'], 3, 'mesero', 'efectivo', 15, [['Pique macho', 2], ['Cerveza nacional', 2], ['Sopa del día', 1]]],
  [0, 20, ['m1', 'm3'], 7, 'cajero', 'qr', 30, [['Silpanote', 3], ['Milanesa con papas', 2], ['Refresco', 2]]],
  [1, 14, ['m5'], 4, 'mesero', 'tarjeta', 20, [['Marquesillo', 2], ['Jugo de naranja', 2]]],
  [1, 21, ['m4'], 2, 'mesero', 'efectivo', 0, [['Higado a la plancha', 2], ['Cerveza nacional', 3]]],
  [2, 12, null, 1, 'cajero', 'efectivo', 0, [['Frankfurter', 2], ['Café', 2]]],
  [2, 19, ['m1'], 5, 'mesero', 'qr', 25, [['Pique macho', 3], ['Api con pastel', 2], ['Singani a la moda', 2]]],
  [3, 20, ['m3'], 3, 'mesero', 'efectivo', 10, [['Milanesa con papas', 3], ['Refresco', 1]]],
  [4, 13, 'llevar', 1, 'cajero', 'qr', 0, [['Sándwich de chola', 2], ['Jugo de naranja', 1]]],
  [4, 22, ['m2'], 6, 'mesero', 'tarjeta', 35, [['Silpanote', 4], ['Cerveza nacional', 6], ['Papas fritas', 2]]],
  [5, 15, ['m5'], 2, 'cajero', 'efectivo', 5, [['Sopa del día', 2], ['Rímbol', 1]]],
  [6, 21, ['m1'], 4, 'mesero', 'qr', 18, [['Pique macho', 2], ['Marquesillo', 1], ['Cerveza nacional', 4]]],
  [8, 14, ['m4'], 3, 'mesero', 'efectivo', 12, [['Arroz con pollo', 3], ['Refresco', 2]]],
  [9, 19, ['m2', 'm5'], 8, 'mesero', 'tarjeta', 40, [['Pique macho', 4], ['Silpanote', 3], ['Singani a la moda', 3], ['Maní con cervezas', 2]]],
  [10, 20, ['m3'], 2, 'cajero', 'efectivo', 8, [['Milanesa con papas', 2], ['Api con pastel', 2]]],
  [12, 13, ['m1'], 3, 'mesero', 'qr', 14, [['Higado a la plancha', 2], ['Jugo de naranja', 2], ['Papas fritas', 1]]],
  [14, 18, null, 1, 'cajero', 'efectivo', 0, [['Café', 3], ['Frankfurter', 1]]],
  [16, 20, 'llevar', 1, 'mesero', 'qr', 0, [['Pique macho', 2], ['Refresco', 2]]],
]

// El seed de cocina solo corre cuando el navegador arrancaba vacío; con mesas abiertas nunca llegaban las
// cuentas cerradas y Reportes salía en cero. Esta siembra va aparte y entra una sola vez por navegador.
function sembrarVentas(s) {
  if (s._ventasSembrada) return s
  const prods = s.productos || productos
  const hoy = new Date()
  const ahora = Date.now()
  let mostrador = 0, llevar = 0
  const cuentas = VENTAS_DEMO.map(([dias, hora, ms, comensales, usuario, metodo, propina, lineas]) => {
    const enMostrador = ms === null
    const esLlevar = ms === 'llevar'
    const directa = enMostrador || esLlevar
    // Las cuentas de «hoy» no pueden quedar en el futuro: el reporte del día las cortaría y el mapa
    // de ventas saldría vacío justo en la demo que se abre a cualquier hora.
    const abiertaEn = Math.min(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dias, hora, 20).getTime(),
      ahora - (directa ? 30 : 120) * 60000)
    const items = lineas.map(([nombre, qty]) => {
      const p = prods.find(x => x.nombre === nombre)
      return p ? {
        id: uid(), productoId: p.id, nombre: p.nombre, precio: p.precio, qty, estado: 'enviado', nota: '',
        areas: p.areas || ['cocina'], enviadoEn: abiertaEn + 2 * 60000,
      } : null
    }).filter(Boolean)
    if (!items.length) return null
    const bruto = round2(items.reduce((a, i) => a + i.precio * i.qty, 0))
    const total = round2(bruto + propina)
    const cerradaEn = Math.min(abiertaEn + (directa ? 8 : 78) * 60000, ahora - 4 * 60000)
    if (enMostrador) mostrador += 1
    if (esLlevar) llevar += 1
    return {
      id: uid(), tipo: directa ? 'directa' : 'mesa', canal: esLlevar ? 'llevar' : enMostrador ? 'mostrador' : 'mesa',
      mesaIds: Array.isArray(ms) ? ms : [], numero: directa ? (enMostrador ? 100 + mostrador : 200 + llevar) : undefined,
      estado: 'cerrada', comensales, items, pagos: [{ id: uid(), metodo, monto: total, en: cerradaEn, por: usuario }],
      propina, descuento: 0, detalle: '', abiertaPor: usuario, abiertaEn, cerradaPor: usuario, cerradaEn,
      ...(esLlevar ? { clienteNombre: 'Pedido por teléfono', clienteTel: '' } : {}),
    }
  }).filter(Boolean)
  return { ...s, _ventasSembrada: true, cuentas: [...(s.cuentas || []), ...cuentas] }
}

const inicial = {
  // Marca el estado del navegador local: solo en demo el reducer escribe la bitácora y descuenta
  // el inventario (en la base real lo hacen los RPC, y duplicarlo acá contaría dos veces).
  _demo: true,
  config: {
    nombre: 'Mi negocio', moneda: 'Bs', ivaPct: 0, propinaPct: 10, propinaMostrar: true,
    indicaciones: INDICACIONES_DEMO,
    gruposImpresion: GRUPOS_DEMO, impresoraPorSeccion: { s1: 'cocina', s2: 'cocina', s3: 'barra', s4: ['cocina', 'barra'] },
  },
  zonas: [{ id: 'z1', nombre: 'Salón' }, { id: 'z2', nombre: 'Terraza' }],
  mesas: [1, 2, 3, 4].map((n, i) => ({ id: 'm' + n, zona: 'z1', nombre: 'Mesa ' + n, x: 120 + i * 200, y: 150, w: 110, h: 110, forma: i % 2 ? 'redonda' : 'cuadrada', cap: 4 }))
    .concat([{ id: 'm5', zona: 'z2', nombre: 'Mesa 5', x: 300, y: 250, w: 150, h: 100, forma: 'rect', cap: 6 }]),
  secciones, productos,
  cuentas: [],
  caja: { turno: null, siguienteTurno: 1, historial: [] },
  devoluciones: [],
  costos: costoDeDemo(),
  proveedores: PROVEEDORES_DEMO.map(p => ({ ...p, creadaEn: Date.now() })),
  deudas: deudasDeDemo(),
  alertas: [],
  insumos: INSUMOS_DEMO,
  recetas: recetasDeDemo(productos, INSUMOS_DEMO),
  movimientos: movimientosDeDemo(INSUMOS_DEMO),
  bitacora: [],
  usuariosDemo: [
    { usuario: 'admin', clave: '1234', rol: 'admin', nombre: 'Administrador' },
    { usuario: 'cajero', clave: '1234', rol: 'cajero', nombre: 'Cajero' },
    { usuario: 'mesero', clave: '1234', rol: 'mesero', nombre: 'Mesero' },
  ],
}

const migrar = e => {
  if (!e || typeof e !== 'object') return sembrarVentas(sembrar(inicial))
  const config = { ...inicial.config, ...(e.config || {}) }
  if (!Array.isArray(config.gruposImpresion) || !config.gruposImpresion.length) config.gruposImpresion = GRUPOS_DEMO
  if (!config.impresoraPorSeccion) config.impresoraPorSeccion = inicial.config.impresoraPorSeccion
  if (!Array.isArray(config.indicaciones)) config.indicaciones = INDICACIONES_DEMO
  const base = { ...e, config, _demo: true }
  // Arrays que llegaron con esta versión: un respaldo viejo del navegador no los trae.
  if (!Array.isArray(base.costos)) base.costos = costoDeDemo()
  if (!Array.isArray(base.proveedores)) base.proveedores = PROVEEDORES_DEMO.map(p => ({ ...p, creadaEn: Date.now() }))
  if (!Array.isArray(base.deudas)) base.deudas = deudasDeDemo()
  if (!Array.isArray(base.alertas)) base.alertas = []
  if (!Array.isArray(base.insumos) || !base.insumos.length) base.insumos = INSUMOS_DEMO
  if (!Array.isArray(base.recetas)) base.recetas = recetasDeDemo(base.productos || productos, base.insumos)
  if (!Array.isArray(base.movimientos)) base.movimientos = movimientosDeDemo(base.insumos)
  if (!Array.isArray(base.bitacora)) base.bitacora = []
  return sembrarVentas(sembrar(base))
}

const nuevaCuenta = (a) => ({ id: uid(), tipo: 'mesa', canal: 'mesa', estado: 'abierta', items: [], pagos: [], propina: 0, descuento: 0, detalle: '', comensales: 1, abiertaEn: Date.now(), ...a })

// En demo el negocio arranca vacío y las pantallas de cocina/barra quedarían sin nada que mostrar,
// así que se siembra una vez por navegador: mesas abiertas con comandas ya enviadas, una cuenta de
// mostrador cobrada (la cola que arma el cliente), un para llevar y una mesa recién abierta.
function sembrar(s) {
  if (s._cocinaSembrada || (s.cuentas || []).some(c => c.estado !== 'cerrada')) return { ...s, _cocinaSembrada: true }
  const en = Date.now()
  const min = n => en - n * 60000
  const it = (nombre, qty, estado, enviadoEn, areas, extra) => {
    const prod = (s.productos || []).find(x => x.nombre === nombre)
    return prod ? { id: uid(), productoId: prod.id, nombre: prod.nombre, precio: prod.precio, qty, estado, nota: '', areas, enviadoEn, ...extra } : null
  }
  const devuelto = it('Sopa del día', 1, 'anulado', min(14), ['cocina'], { motivo: 'No salió' })
  // El plato mixto ya salió de cocina y falta barra: es el caso que dejaba el contador rojo en 1
  // en las dos áreas cuando una de las dos ya lo había entregado.
  const mixto = it('Api con pastel', 1, 'enviado', min(3), ['cocina', 'barra'], { areasListas: ['cocina'], areasEn: { cocina: min(3) } })
  const cuentas = [
    nuevaCuenta({ mesaIds: ['m1'], comensales: 4, abiertaPor: 'mesero', abiertaEn: min(22), items: [
      it('Milanesa con papas', 1, 'enviado', min(19), ['cocina'], { nota: 'sin picante', indicaciones: 'a punto' }),
      it('Pique macho', 2, 'enviado', min(19), ['cocina'], { indicaciones: 'bastante' }),
      it('Sopa del día', 1, 'listo', min(6), ['cocina'], { areasListas: ['cocina'], areasEn: { cocina: min(6) }, listoEn: min(6) }),
      mixto,
      it('Café', 2, 'anulacion', min(4), ['cocina'], { motivo: 'Cambio del cliente', anulacionEstadoPrevio: 'enviado', anulacionPedidaEn: min(1), anulacionPor: 'mesero' }),
      it('Cerveza nacional', 2, 'enviado', min(6), ['barra']),
      it('Jugo de naranja', 1, 'pendiente'),
    ].filter(Boolean) }),
    nuevaCuenta({ mesaIds: ['m2'], comensales: 2, abiertaPor: 'mesero', abiertaEn: min(16), items: [
      devuelto,
      it('Milanesa con papas', 1, 'enviado', min(2), ['cocina']),
      it('Refresco', 1, 'enviado', min(2), ['barra']),
    ].filter(Boolean) }),
    nuevaCuenta({ mesaIds: ['m3'], comensales: 3, abiertaPor: 'mesero', abiertaEn: min(8), items: [
      it('Papas fritas', 1, 'pendiente'),
      it('Singani a la moda', 2, 'pendiente'),
      it('Sándwich de chola', 1, 'pendiente'),
    ].filter(Boolean) }),
    nuevaCuenta({ mesaIds: ['m5'], comensales: 6, abiertaPor: 'cajero', abiertaEn: min(35), items: [
      it('Maní con cervezas', 2, 'enviado', min(31), ['cocina', 'barra']),
      it('Cerveza nacional', 4, 'listo', min(31), ['barra'], { areasListas: ['barra'], areasEn: { barra: min(24) }, listoEn: min(24) }),
      it('Higado a la plancha', 1, 'enviado', min(12), ['cocina']),
      it('Rímbol', 1, 'enviado', min(12), ['cocina'], { nota: 'sin sal' }),
    ].filter(Boolean) }),
    nuevaCuenta({ tipo: 'directa', canal: 'mostrador', numero: 12, mesaIds: [], abiertaPor: 'cajero', abiertaEn: min(9), cerradaEn: min(9),
      pagos: [{ id: uid(), metodo: 'efectivo', monto: 83, en: min(9), por: 'cajero' }],
      items: [
        it('Frankfurter', 1, 'enviado', min(9), ['cocina', 'directa']),
        it('Cerveza nacional', 2, 'enviado', min(9), ['directa']),
        it('Papas fritas', 1, 'listo', min(9), ['directa'], { areasListas: ['directa'], areasEn: { directa: min(7) }, listoEn: min(7) }),
      ].filter(Boolean) }),
    nuevaCuenta({ tipo: 'directa', canal: 'llevar', numero: 13, mesaIds: [], abiertaPor: 'cajero', abiertaEn: min(20), cerradaEn: min(18),
      clienteNombre: 'Doña Elsa', clienteTel: '71234567',
      pagos: [{ id: uid(), metodo: 'qr', monto: 90, en: min(18), por: 'cajero' }],
      items: [it('Pique macho', 1, 'enviado', min(18), ['cocina']), it('Marquesillo', 1, 'enviado', min(18), ['cocina'])].filter(Boolean) }),
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

// INVENTARIO (demo): misma lógica que private.insumo_mover del servidor (presentaciones, rendimiento,
// costo promedio ponderado sobre lo limpio y merma). a: { id, tipo, cantidad (unidad base) | presId + cantPres,
// limpio, costoTotal, motivo, nota, usuario }.
function moverInsumo(s, a) {
  const ins = (s.insumos || []).find(x => x.id === a.id)
  if (!ins || !['entrada', 'salida', 'ajuste', 'merma'].includes(a.tipo)) return s
  const r = resolverCantidad(ins, a.presId ? a.cantPres : a.cantidad, a.presId ? 'p:' + a.presId : 'base')
  const pres = r.pres
  if (a.presId && !pres) return s
  const cant = r.base
  if (a.tipo === 'ajuste' ? cant < 0 : !(cant > 0)) return s
  let nota = String(a.nota || '').trim()
  const det = {}
  if (pres) {
    Object.assign(det, { presentacion: pres.nombre, presentacion_id: pres.id, cant_pres: round3(a.cantPres), factor: num(pres.cantidad) })
    nota = `${round3(a.cantPres)} × ${pres.nombre}` + (nota ? ` — ${nota}` : '')
  }
  let stock, costo = num(ins.costo), mov = cant
  if (a.tipo === 'entrada') {
    let costoTotal = a.costoTotal
    if (!(num(costoTotal) > 0) && pres && num(pres.costo) > 0) costoTotal = round2(num(a.cantPres) * num(pres.costo))
    try {
      const e = aplicarEntrada(ins, { cantidad: cant, limpio: a.limpio, costoTotal })
      stock = e.stock; costo = e.costo; mov = e.mov; Object.assign(det, e.detalle)
    } catch { return s }
  } else if (a.tipo === 'salida' || a.tipo === 'merma') stock = round3(num(ins.stock) - cant)
  else stock = cant
  if (a.tipo === 'merma') det.motivo = MOTIVOS_MERMA.includes(a.motivo) ? a.motivo : 'otro'
  det.costo_unit = costo
  const fila = { id: uid(), en: new Date().toISOString(), insumo_id: ins.id, insumo_nombre: ins.nombre, unidad: ins.unidad,
    tipo: a.tipo, cantidad: mov, stock_after: stock, nota, detalle: det, usuario_nombre: a.usuario || 'demo' }
  return { ...s,
    insumos: s.insumos.map(x => (x.id === ins.id ? { ...x, stock, costo } : x)),
    movimientos: [fila, ...(s.movimientos || [])].slice(0, 800) }
}

// Al cerrar una cuenta baja el stock de la receta de cada plato, igual que hace cobrar_cuenta en
// la base (uno o varios movimientos «venta» por insumo, con el stock resultante).
function descuentoDeVenta(s, c, usuario) {
  const recetas = s.recetas || [], insumos = s.insumos || []
  if (!recetas.length || !insumos.length) return null
  const consume = new Map()
  itemsVivos(c).forEach(i => recetas.filter(r => r.productoId === i.productoId)
    .forEach(r => consume.set(r.insumo_id, round3(num(consume.get(r.insumo_id)) + i.qty * num(r.cantidad)))))
  if (!consume.size) return null
  const en = new Date().toISOString()
  const orden = c.numero ? `#${c.numero}` : nombreDeCuenta(s, c)
  const filas = []
  const nuevos = insumos.map(x => {
    const n = consume.get(x.id)
    if (!n) return x
    const stock = round3(num(x.stock) - n)
    filas.push({ id: uid(), en, insumo_id: x.id, insumo_nombre: x.nombre, tipo: 'venta', cantidad: n,
      stock_after: stock, nota: `venta cuenta ${orden}`, usuario_nombre: usuario || 'sistema' })
    return { ...x, stock }
  })
  if (!filas.length) return null
  return { insumos: nuevos, movimientos: [...filas, ...(s.movimientos || [])].slice(0, 800) }
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

    case 'abrir': if (s.cuentas.some(c => c.estado !== 'cerrada' && (c.mesaIds || []).includes(a.mesaId))) return s
      return { ...s, cuentas: [...s.cuentas, nuevaCuenta({ tipo: 'mesa', canal: 'mesa', mesaIds: [a.mesaId], comensales: a.comensales || 1, abiertaPor: a.usuario })] }
    case 'abrir-descartar': return { ...s, cuentas: s.cuentas.filter(c => !(c.id === a.cuentaId && (c.tipo === 'mesa' || c.canal === 'llevar') && c.estado === 'abierta' && !(c.items || []).length && !(c.pagos || []).length)) }
    case 'abrir-directa': return { ...s, caja: { ...s.caja, siguienteTurno: s.caja.siguienteTurno + 1 },
      cuentas: [...s.cuentas, nuevaCuenta({ tipo: 'directa', canal: a.canal || 'mostrador', numero: s.caja.siguienteTurno, mesaIds: [], abiertaPor: a.usuario })] }

    case 'abrir-llevar': {
      const dia = x => new Date(x || 0).toDateString()
      const n = s.cuentas.filter(c => c.canal === 'llevar' && dia(c.abiertaEn) === dia(Date.now())).reduce((m, c) => Math.max(m, c.numero || 0), 0) + 1
      return { ...s, cuentas: [...s.cuentas, nuevaCuenta({ ...(a.id ? { id: a.id } : {}), tipo: 'directa', canal: 'llevar', numero: n, mesaIds: [], clienteNombre: a.nombre, clienteTel: a.tel || '', abiertaPor: a.usuario })] }
    }
    case 'llevar~': return upd(a.cuentaId, c => ({ ...c, clienteNombre: a.nombre, clienteTel: a.tel || '' }))
    case 'llevar-mesa': return upd(a.cuentaId, c => (c.canal !== 'llevar' ? c : { ...c, tipo: 'mesa', canal: 'mesa', numero: undefined, mesaIds: [a.mesaId], comensales: a.comensales || c.comensales || 1 }))
    case 'unir': {
      const absorb = s.cuentas.filter(c => c.estado !== 'cerrada' && c.id !== a.cuentaId && c.mesaIds.some(m => a.mesaIds.includes(m)))
      return { ...s, cuentas: unirCuentas(s.cuentas, a.cuentaId, absorb, a.mesaIds) }
    }
    case 'separar': {
      const c = s.cuentas.find(x => x.id === a.cuentaId)
      if (!c || !c.mesaIds.includes(a.mesaId) || c.mesaIds.length < 2) return s
      return { ...s, cuentas: s.cuentas.map(x => x.id === a.cuentaId ? { ...x, mesaIds: x.mesaIds.filter(m => m !== a.mesaId) } : x)
        .concat([nuevaCuenta({ tipo: 'mesa', mesaIds: [a.mesaId], abiertaPor: a.usuario })]) }
    }

    case 'item+': return upd(a.cuentaId, c => {
      const nota = a.nota || ''
      const indicaciones = a.indicaciones && nota.startsWith(a.indicaciones) ? a.indicaciones : ''
      const precio = a.p.precio + (Number(a.extra) || 0)
      const ex = c.items.find(i => i.productoId === a.p.id && i.estado === 'pendiente' && (i.nota || '') === nota && (i.indicaciones || '') === indicaciones && i.precio === precio)
      if (ex) return { ...c, items: c.items.map(i => (i === ex ? { ...i, qty: i.qty + 1 } : i)) }
      return { ...c, items: [...c.items, { id: uid(), productoId: a.p.id, nombre: a.p.nombre, precio, qty: 1, estado: 'pendiente', nota, indicaciones }] }
    })
    case 'dividir': {
      const c = s.cuentas.find(x => x.id === a.cuentaId)
      if (!c || c.tipo !== 'mesa') return s
      const vivas = s.cuentas.filter(x => x.estado !== 'cerrada' && x.mesaIds.some(m => c.mesaIds.includes(m)))
      if (vivas.length >= 8) return s
      // Las letras se reordenan desde «a» por orden de apertura: una cuenta que quedó con la letra
      // vieja después de una unión no debe hacer que la nueva salte a «c».
      const letras = {}
      ;[...vivas].sort((x, y) => (x.abiertaEn || 0) - (y.abiertaEn || 0)).forEach((x, i) => { letras[x.id] = String.fromCharCode(97 + i) })
      const sig = String.fromCharCode(97 + vivas.length)
      return { ...s, cuentas: s.cuentas.map(x => (letras[x.id] && x.etiqueta !== letras[x.id] ? { ...x, etiqueta: letras[x.id] } : x))
        .concat([nuevaCuenta({ tipo: 'mesa', mesaIds: [...c.mesaIds], etiqueta: sig, abiertaPor: a.usuario })]) }
    }
    case 'qty': return upd(a.cuentaId, c => ({ ...c, items: c.items.flatMap(i => (i.id !== a.itemId ? [i] : i.qty + a.d <= 0 ? [] : [{ ...i, qty: i.qty + a.d }])) }))
    case 'detalle': return upd(a.cuentaId, c => ({ ...c, detalle: a.detalle || '' }))
    case 'fiscal~': return upd(a.cuentaId, c => ({ ...c, fiscalNombre: a.nombre || '', fiscalNumero: a.numero || '', fiscalCorreo: a.correo || '' }))
    // Solo cambia el comentario: las indicaciones del ítem se conservan siempre.
    case 'nota': return upd(a.cuentaId, c => ({ ...c, items: c.items.map(i => (i.id === a.itemId ? { ...i, nota: notaProtegida(i.indicaciones, a.nota) } : i)) }))
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
    case 'cobrar': {
      const previa = s.cuentas.find(x => x.id === a.cuentaId)
      const cerrado = upd(a.cuentaId, c => ({ ...c, estado: 'cerrada', pagos: [...(c.pagos || []), ...conFecha(a.pagos, a.concepto, a.usuario)], propina: a.propina ?? c.propina, descuento: a.descuento ?? c.descuento, cerradaPor: a.usuario, cerradaEn: Date.now() }))
      // Solo la primera vez que la cuenta pasa a cerrada: una cuenta ya cobrada que vuelve a cobrarse
      // (reabierta) no debe volver a descontar el inventario.
      if (!s._demo || !previa || previa.estado === 'cerrada') return cerrado
      const baja = descuentoDeVenta(s, previa, a.usuario)
      return baja ? { ...cerrado, insumos: baja.insumos, movimientos: baja.movimientos } : cerrado
    }
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

    // Mover solo parte de un ítem (2 de 3 iguales): nace una fila nueva con el mismo estado y precio.
    case 'mover-parcial': {
      const n = Math.max(1, Math.floor(Number(a.cantidad) || 1))
      const it = s.cuentas.find(x => x.id === a.cuentaId)?.items.find(x => x.id === a.itemId)
      if (!it || n >= it.qty) return reducer(s, { ...a, t: 'mover', itemIds: [a.itemId] })
      let destino = a.cuentaDestinoId ? s.cuentas.find(x => x.id === a.cuentaDestinoId)
        : s.cuentas.find(x => x.mesaIds.includes(a.mesaDestino) && x.estado !== 'cerrada')
      let cuentas = s.cuentas
      if (!destino) {
        if (!a.mesaDestino) return s
        destino = nuevaCuenta({ tipo: 'mesa', mesaIds: [a.mesaDestino], abiertaPor: a.usuario })
        cuentas = [...cuentas, destino]
      }
      const parte = { ...it, id: uid(), qty: n }
      return { ...s, cuentas: cuentas.map(x => x.id === a.cuentaId ? { ...x, items: x.items.map(y => (y.id === it.id ? { ...y, qty: y.qty - n } : y)) }
        : x.id === destino.id ? { ...x, items: [...x.items, parte] } : x) }
    }

    // Unir subcuentas hermanas (2A + 2B): unir_mesas trabaja por mesa y aquí ambas comparten la misma.
    // La absorbida desaparece de la lista, no queda «cerrada con nota»: si no, la mesa seguiría
    // mostrando dos cuentas y la letra de la que sobrevive no se caería nunca.
    case 'unir-sub': {
      const absorb = s.cuentas.filter(x => x.id !== a.cuentaId && (a.cuentaIds || []).includes(x.id) && x.estado !== 'cerrada')
      return { ...s, cuentas: unirCuentas(s.cuentas, a.cuentaId, absorb) }
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
    case 'producto-': return { ...s, productos: s.productos.filter(p => p.id !== a.id), costos: (s.costos || []).filter(c => c.productoId !== a.id) }

    // LISTO DEL PEDIDO: mismo criterio que el servidor (los platos enviados pasan a listo con todas sus áreas).
    case 'listo': return upd(a.cuentaId, c => {
      if (a.lista === false) {
        return { ...c, items: c.items.map(i => (i.estado === 'listo' ? { ...i, estado: 'enviado', listoEn: null, areasListas: [] } : i)) }
      }
      const en = Date.now()
      return { ...c, items: c.items.map(i => {
        if (i.estado !== 'enviado') return i
        const areas = Array.isArray(i.areas) && i.areas.length ? i.areas : areasDel(i, s)
        return { ...i, estado: 'listo', listoEn: en, areasListas: [...areas], areasEn: { ...(i.areasEn || {}), ...Object.fromEntries(areas.map(x => [x, en])) } }
      }) }
    })

    // COSTO Y MARGEN (en demo el admin también los ve, para poder probar la pantalla).
    case 'costo~': {
      const resto = (s.costos || []).filter(c => c.productoId !== a.productoId)
      return { ...s, costos: [...resto, { productoId: a.productoId, costo: round2(Number(a.costo) || 0), proveedorId: a.proveedorId || null }] }
    }
    case 'costo-pct': {
      const pct = Number(a.pct) || 0
      if (pct <= 0 || pct > 100) return s
      const elegidos = new Set(a.productoIds || [])
      const previos = new Map((s.costos || []).map(x => [x.productoId, x]))
      const nuevos = s.productos
        .filter(p => p.precio > 0 && (!elegidos.size || elegidos.has(p.id)))
        .filter(p => a.reemplazar || !(previos.get(p.id)?.costo > 0))
        .map(p => ({ productoId: p.id, costo: round2(p.precio * pct / 100), proveedorId: previos.get(p.id)?.proveedorId ?? null }))
      const ids = new Set(nuevos.map(x => x.productoId))
      return { ...s, costos: [...(s.costos || []).filter(x => !ids.has(x.productoId)), ...nuevos] }
    }
    case 'margen-aplicar': {
      const mapa = new Map((s.costos || []).map(c => [c.productoId, c]))
      const elegidos = new Set(a.productoIds || [])
      const factor = 1 - (Number(a.margenPct) || 0) / 100
      if (factor <= 0) return s
      return { ...s, productos: s.productos.map(p => {
        const c = mapa.get(p.id)
        if (!c || !(c.costo > 0) || !p.precio) return p
        if (elegidos.size && !elegidos.has(p.id)) return p
        return { ...p, precio: round2(c.costo / factor) }
      }) }
    }

    // INVENTARIO (demo): los mismos RPC de la base se reproducen acá para que la pantalla
    // funcione sin Supabase. Las recetas usan insumo_id, como las filas que devuelve el servidor.
    case 'insumo+': {
      const base = { id: uid(), nombre: '', unidad: '', stock: 0, stock_min: 0, costo: 0, activo: true, ...a.insumo }
      const previo = (s.insumos || []).find(x => x.id === (a.insumo?.id || base.id))
      let hayPrincipal = false
      const pres = (Array.isArray(a.insumo?.presentaciones) ? a.insumo.presentaciones : (previo?.presentaciones || []))
        .filter(p => String(p?.nombre || '').trim() && num(p?.cantidad) > 0)
        .map(p => {
          const principal = Boolean(p.principal) && p.activo !== false && !hayPrincipal
          if (principal) hayPrincipal = true
          return { id: p.id || uid(), nombre: String(p.nombre).trim(), cantidad: round3(p.cantidad),
            costo: p.costo === null || p.costo === '' || p.costo === undefined ? null : round2(num(p.costo)), activo: p.activo !== false, principal }
        })
      const rend = a.insumo?.rendimiento_esp === '' || a.insumo?.rendimiento_esp == null ? null : num(a.insumo.rendimiento_esp)
      const nuevo = { ...base, id: a.insumo?.id || base.id, nombre: String(base.nombre || '').trim(), unidad: String(base.unidad || '').trim(),
        stock: round3(num(base.stock)), stock_min: round3(num(base.stock_min)), costo: round4(num(base.costo)),
        presentaciones: pres, con_merma: Boolean(a.insumo?.con_merma), rendimiento_esp: rend > 0 && rend <= 100 ? rend : null }
      const existe = (s.insumos || []).some(x => x.id === nuevo.id)
      return { ...s, insumos: existe ? s.insumos.map(x => (x.id === nuevo.id ? { ...x, ...nuevo } : x)) : [...(s.insumos || []), nuevo] }
    }
    case 'insumo-': return { ...s, insumos: (s.insumos || []).filter(x => x.id !== a.id), recetas: (s.recetas || []).filter(r => r.insumo_id !== a.id) }
    case 'insumo-mov': return moverInsumo(s, a)
    case 'insumo-mermas': return (a.lineas || []).reduce((acc, l) => moverInsumo(acc, { ...l, tipo: 'merma', usuario: a.usuario }), s)
    case 'receta~': {
      const limpio = (a.lineas || []).filter(l => l.insumo_id && num(l.cantidad) > 0)
        .map(l => ({ productoId: a.productoId, insumo_id: l.insumo_id, cantidad: round3(num(l.cantidad)) }))
      const resto = (s.recetas || []).filter(r => r.productoId !== a.productoId)
      return { ...s, recetas: [...resto, ...limpio] }
    }

    case 'prov+': return { ...s, proveedores: [...(s.proveedores || []), { id: uid(), creadaEn: Date.now(), nombre: '', telefono: '', email: '', direccion: '', nota: '', activo: true, ...a.proveedor }] }
    case 'prov~': return { ...s, proveedores: (s.proveedores || []).map(p => (p.id === a.id ? { ...p, ...a.cambios } : p)) }
    case 'prov-': {
      // Con saldo pendiente no se borra: queda desactivado, igual que en la base.
      const conSaldo = (s.deudas || []).some(x => x.proveedorId === a.id && num(x.saldo) > 0)
      return conSaldo
        ? { ...s, proveedores: (s.proveedores || []).map(p => (p.id === a.id ? { ...p, activo: false } : p)) }
        : { ...s, proveedores: (s.proveedores || []).filter(p => p.id !== a.id), deudas: (s.deudas || []).filter(x => x.proveedorId !== a.id) }
    }

    case 'deuda+': {
      const monto = round2(Number(a.deuda?.monto) || 0)
      return { ...s, deudas: [...(s.deudas || []), {
        id: uid(), proveedorId: a.deuda?.proveedorId || null, fecha: a.deuda?.fecha || fechaLocal(),
        vencimiento: a.deuda?.vencimiento || null, concepto: a.deuda?.concepto || '',
        monto, pagado: 0, saldo: monto, nota: a.deuda?.nota || '', creadaEn: Date.now(), pagadaEn: null,
      }] }
    }
    case 'deuda~': return { ...s, deudas: (s.deudas || []).map(x => {
      if (x.id !== a.id) return x
      const mez = { ...x, ...a.cambios }
      const monto = round2(Number(mez.monto) || 0)
      const pagado = round2(Math.min(monto, Number(x.pagado) || 0))
      const saldo = round2(Math.max(0, monto - pagado))
      return { ...mez, monto, pagado, saldo, pagadaEn: saldo === 0 ? (x.pagadaEn || Date.now()) : null }
    }) }
    case 'deuda-abono': return { ...s, deudas: (s.deudas || []).map(x => {
      if (x.id !== a.id) return x
      const monto = round2(Math.max(0, Math.min(Number(a.monto) || 0, num(x.saldo))))
      const pagado = round2(num(x.pagado) + monto)
      const saldo = round2(Math.max(0, num(x.monto) - pagado))
      const nota = (a.nota || '').trim()
      return { ...x, pagado, saldo, nota: nota ? `${x.nota ? x.nota + ' · ' : ''}${nota}` : x.nota, ...(saldo === 0 ? { pagadaEn: Date.now() } : {}) }
    }) }
    case 'deuda-': return { ...s, deudas: (s.deudas || []).filter(x => x.id !== a.id) }

    case 'alerta+': return { ...s, alertas: [{
      id: uid(), tipo: a.alerta?.tipo || 'general', titulo: a.alerta?.titulo || '', mensaje: a.alerta?.mensaje || '',
      cuentaId: a.alerta?.cuentaId ?? null, mesaId: a.alerta?.mesaId ?? null, prioridad: Number(a.alerta?.prioridad) || 5,
      creadaPor: a.usuario || '', creadaEn: Date.now(), resueltaPor: undefined, resueltaEn: null,
    }, ...(s.alertas || [])] }
    case 'alerta-resolver': return { ...s, alertas: (s.alertas || []).map(x => (x.id === a.id
      ? { ...x, resueltaEn: a.resuelta ? Date.now() : null, resueltaPor: a.resuelta ? (a.usuario || 'demo') : undefined }
      : x)) }

    case 'alerta-mover': return { ...s, alertas: (s.alertas || []).map(x => (x.id === a.id
      ? { ...x, mesaId: a.mesaId ?? null, cuentaId: a.cuentaId === undefined ? x.cuentaId : a.cuentaId }
      : x)) }

    case 'reset': return inicial
    default: return s
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BITÁCORA DE DEMO. En la empresa real la auditoría la escribe el servidor (private.auditar dentro
// de cada RPC) y se lee con auditoria_listar. En demo no hay servidor, así que el propio reducer
// anota cada acción con los MISMOS nombres de acción que usa la base: la pantalla de Auditoría
// muestra la biblia del turno también sin conexión.
const etiquetaCuenta = (s, c) => {
  if (!c) return '—'
  const mesas = nombreDeCuenta(s, c)
  if (mesas) return mesas + (c.etiqueta ? ' ' + c.etiqueta : '')
  if (c.canal === 'llevar') return `Para llevar ${c.numero || ''}`.trim()
  if (c.tipo === 'directa') return `Mostrador ${c.numero || ''}`.trim()
  return 'Cuenta'
}
const enCuenta = (s, id) => (s?.cuentas || []).find(c => c.id === id)
const itemDe = (s, cuentaId, itemId) => (enCuenta(s, cuentaId)?.items || []).find(i => i.id === itemId)
const nombreInsumo = (s, id) => (s?.insumos || []).find(x => x.id === id)?.nombre || id || ''
const nombreProducto = (s, id) => (s?.productos || []).find(x => x.id === id)?.nombre || id || ''
const nombreMesa = (s, id) => (s?.mesas || []).find(m => m.id === id)?.nombre || id || ''
const nombreZona = (s, id) => (s?.zonas || []).find(z => z.id === id)?.nombre || id || ''
const nombreSeccion = (s, id) => (s?.secciones || []).find(x => x.id === id)?.nombre || id || ''
const nombreProveedor = (s, id) => (s?.proveedores || []).find(p => p.id === id)?.nombre || id || ''
const deudaDe = (s, id) => (s?.deudas || []).find(x => x.id === id)?.concepto || ''
const alertaDe = (s, id) => (s?.alertas || []).find(x => x.id === id)?.titulo || ''
const devDe = (s, id) => (s?.devoluciones || []).find(x => x.id === id) || {}
const nuevoDe = (prev, next, key) => (next[key] || []).filter(x => !(prev[key] || []).some(y => y.id === x.id))
const clavesDe = a => Object.keys(a.cambios || {})
const destinoDe = (n, a) => (a.cuentaDestinoId ? etiquetaCuenta(n, enCuenta(n, a.cuentaDestinoId)) : nombreMesa(n, a.mesaDestino))
const montoPagos = a => (a.pagos || []).reduce((t, x) => t + num(x.monto), 0)
const lineasDe = s => s.productos.filter(p => p.precio > 0 && p.activo !== false).length

// Cada entrada devuelve [acción, tipo de registro, etiqueta, detalle]. Se mira el estado anterior
// para los borrados (la fila ya no existe) y el nuevo para las altas (acaba de nacer).
const BITACORA = {
  'abrir': (p, n, a) => ['cuenta_abierta', 'cuenta', etiquetaCuenta(n, nuevoDe(p, n, 'cuentas')[0]), { comensales: a.comensales || 1 }],
  'abrir-descartar': (p, n, a) => ['cuenta_descartada', 'cuenta', etiquetaCuenta(p, enCuenta(p, a.cuentaId)), {}],
  'abrir-directa': (p, n, a) => ['cuenta_venta_directa', 'cuenta', etiquetaCuenta(n, nuevoDe(p, n, 'cuentas')[0]), { canal: a.canal || 'mostrador' }],
  'abrir-llevar': (p, n, a) => ['cuenta_abierta', 'cuenta', etiquetaCuenta(n, nuevoDe(p, n, 'cuentas')[0]), { canal: 'llevar', cliente: a.nombre || '' }],

  'item+': (p, n, a) => ['item_agregado', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)),
    { plato: nombreProducto(n, a.p?.id), cantidad: 1, indicaciones: a.indicaciones || '', comentario: a.nota || '' }],
  'enviar': (p, n, a) => {
    const antes = enCuenta(p, a.cuentaId)?.items || []
    const enviados = (enCuenta(n, a.cuentaId)?.items || []).filter(i => antes.find(x => x.id === i.id)?.estado === 'pendiente')
    return ['comanda_enviada', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)),
      { platos: enviados.map(i => `${i.nombre} x${i.qty}`).join(', '), cantidad: enviados.reduce((t, i) => t + i.qty, 0) }]
  },
  'qty': (p, n, a) => ['item_cantidad', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(n, a.cuentaId, a.itemId)?.nombre || '', cambio: a.d }],
  'nota': (p, n, a) => ['item_nota', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(n, a.cuentaId, a.itemId)?.nombre || '', comentario: a.nota || '' }],
  'anular': (p, n, a) => ['item_anulado', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(p, a.cuentaId, a.itemId)?.nombre || '', motivo: a.motivo || '' }],

  'cocina-salida': (p, n, a) => ['item_salida', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(n, a.cuentaId, a.itemId)?.nombre || '', area: a.area }],
  'cocina-deshacer': (p, n, a) => ['item_salida_deshacer', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(n, a.cuentaId, a.itemId)?.nombre || '', area: a.area }],
  'cocina-anular': (p, n, a) => ['item_anulacion_pedida', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(n, a.cuentaId, a.itemId)?.nombre || '', motivo: a.motivo || '' }],
  'cocina-resolver': (p, n, a) => ['item_anulacion_resuelta', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(n, a.cuentaId, a.itemId)?.nombre || '', aprobada: Boolean(a.aprobar) }],
  'devolver': (p, n, a) => ['devolucion', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { plato: itemDe(p, a.cuentaId, a.itemId)?.nombre || '', motivo: a.motivo || '' }],
  'devolver~': (p, n, a) => { const x = devDe(p, a.id); return ['devolucion_confirmada', 'devolucion', x.nombre || '', { area: x.area, nota: a.nota || '' }] },
  'listo': (p, n, a) => [a.lista === false ? 'pedido_deshace_listo' : 'pedido_listo', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), {}],

  'cobrar': (p, n, a) => { const c = enCuenta(n, a.cuentaId)
    return ['cuenta_cobrada', 'cuenta', etiquetaCuenta(n, c), { total: totalFinal(c), pagado: pagadoCuenta(c),
      metodos: [...new Set((c?.pagos || []).map(x => x.medio || x.metodo).filter(Boolean))].join(', ') }] },
  'abonar': (p, n, a) => ['cuenta_abonada', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { monto: montoPagos(a) }],
  'precuenta': (p, n, a) => ['cuenta_precuenta', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), {}],
  'reabrir': (p, n, a) => ['cuenta_reabierta', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), {}],
  'extras': (p, n, a) => ['cuenta_extras', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)),
    { propina: a.propina ?? enCuenta(n, a.cuentaId)?.propina, descuento: a.descuento ?? enCuenta(n, a.cuentaId)?.descuento }],
  'comensales~': (p, n, a) => ['comensales', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { comensales: a.comensales }],
  'fiscal~': (p, n, a) => ['cuenta_fiscal', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { nombre: a.nombre || '', numero: a.numero || '' }],
  'detalle': (p, n, a) => ['cuenta_detalle', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { detalle: a.detalle || '' }],

  'unir': (p, n, a) => ['mesa_unidas', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { mesas: (a.mesaIds || []).map(m => nombreMesa(n, m)).join(', ') }],
  'unir-sub': (p, n, a) => ['subcuentas_unidas', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { cuentas: (a.cuentaIds || []).length + 1 }],
  'separar': (p, n, a) => ['mesa_separada', 'mesa', nombreMesa(n, a.mesaId), { cuenta: etiquetaCuenta(n, enCuenta(n, a.cuentaId)) }],
  'dividir': (p, n, a) => ['cuenta_dividida', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), {}],
  'mover': (p, n, a) => ['item_movido', 'cuenta', etiquetaCuenta(p, enCuenta(p, a.cuentaId)),
    { platos: (a.itemIds || []).map(id => itemDe(p, a.cuentaId, id)?.nombre).filter(Boolean).join(', '), destino: destinoDe(n, a) }],
  'mover-parcial': (p, n, a) => ['item_movido', 'cuenta', etiquetaCuenta(p, enCuenta(p, a.cuentaId)),
    { plato: itemDe(p, a.cuentaId, a.itemId)?.nombre || '', cantidad: a.cantidad, destino: destinoDe(n, a), parcial: true }],
  'intercambiar': (p, n, a) => ['items_intercambiados', 'cuenta', etiquetaCuenta(p, enCuenta(p, a.cuentaA)),
    { de: itemDe(p, a.cuentaA, a.itemA)?.nombre || '', hacia: itemDe(p, a.cuentaB, a.itemB)?.nombre || '' }],
  'llevar~': (p, n, a) => ['llevar_edicion', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { cliente: a.nombre || '', telefono: a.tel || '' }],
  'llevar-mesa': (p, n, a) => ['llevar_a_mesa', 'cuenta', etiquetaCuenta(n, enCuenta(n, a.cuentaId)), { mesa: nombreMesa(n, a.mesaId) }],

  'turno+': (p, n) => ['turno_abierto', 'turno', `Turno ${n.caja?.turno?.abiertoPor || ''}`.trim(), { fondo: n.caja?.turno?.fondo }],
  'turno-': (p, n) => { const t = n.caja?.historial?.[0] || {}
    return ['turno_cerrado', 'turno', `Turno ${t.cerradoPor || ''}`.trim(), { contado: t.contado, traspaso: (t.traspaso || []).length }] },
  'caja-mov+': (p, n, a) => ['caja_movimiento', 'caja', a.tipo || '', { monto: a.monto, motivo: a.motivo || '' }],

  'cfg~': (p, n, a) => ['config_cambio', 'config', clavesDe(a).join(', '), { claves: clavesDe(a).join(', ') }],
  'producto+': (p, n) => ['menu_item_alta', 'producto', nuevoDe(p, n, 'productos')[0]?.nombre || '', { carta: lineasDe(n) }],
  'producto~': (p, n, a) => ['menu_item_edicion', 'producto', nombreProducto(n, a.id), { campos: clavesDe(a).join(', ') }],
  'producto-': (p, n, a) => ['menu_item_baja', 'producto', nombreProducto(p, a.id), {}],
  'seccion+': (p, n) => ['menu_grupo_alta', 'grupo', nuevoDe(p, n, 'secciones')[0]?.nombre || ''],
  'seccion~': (p, n, a) => ['menu_grupo_edicion', 'grupo', nombreSeccion(n, a.id), { campos: clavesDe(a).join(', ') }],
  'seccion-': (p, n, a) => ['menu_grupo_baja', 'grupo', nombreSeccion(p, a.id), { productos: (p.productos || []).filter(x => x.seccionId === a.id).length }],
  'area-': (p, n, a) => ['area_retirada', 'area', a.id, { reemplazo: a.reemplazo || 'cocina' }],
  'mesa+': (p, n) => ['salon_mesa_alta', 'mesa', nuevoDe(p, n, 'mesas')[0]?.nombre || ''],
  'mesa~': (p, n, a) => ['salon_mesa_edicion', 'mesa', nombreMesa(n, a.id), { campos: clavesDe(a).join(', ') }],
  'mesa-': (p, n, a) => ['salon_mesa_baja', 'mesa', nombreMesa(p, a.id), {}],
  'zona+': (p, n) => ['salon_zona_alta', 'zona', nuevoDe(p, n, 'zonas')[0]?.nombre || ''],
  'zona~': (p, n, a) => ['salon_zona_edicion', 'zona', nombreZona(n, a.id), { campos: clavesDe(a).join(', ') }],
  'zona-': (p, n, a) => ['salon_zona_baja', 'zona', nombreZona(p, a.id), { mesas: (p.mesas || []).filter(m => m.zona === a.id).length }],

  'usuario+': (p, n) => { const u = nuevoDe(p, n, 'usuariosDemo')[0] || {}; return ['equipo_alta', 'persona', u.nombre || u.usuario || '', { rol: u.rol }] },
  'usuario~': (p, n, a) => ['equipo_edicion', 'persona', a.usuario || '', { campos: clavesDe(a).join(', ') }],
  'usuario-': (p, n, a) => ['equipo_revoco', 'persona', a.usuario || '', {}],
  'rol~': (p, n, a) => ['equipo_cambio_rol', 'persona', a.usuario || '', { rol: a.rol }],

  'costo~': (p, n, a) => ['costo_guardado', 'producto', nombreProducto(n, a.productoId), { costo: a.costo, proveedor: nombreProveedor(n, a.proveedorId) }],
  'costo-pct': (p, n, a) => ['costo_pct_aplicado', 'producto', `${a.pct}%`, { reemplazar: Boolean(a.reemplazar) }],
  'margen-aplicar': (p, n, a) => ['margen_aplicado', 'producto', `${a.margenPct}%`, {}],

  'prov+': (p, n) => ['proveedor_guardo', 'proveedor', nuevoDe(p, n, 'proveedores')[0]?.nombre || ''],
  'prov~': (p, n, a) => ['proveedor_guardo', 'proveedor', nombreProveedor(n, a.id), { campos: clavesDe(a).join(', ') }],
  'prov-': (p, n, a) => ['proveedor_borro', 'proveedor', nombreProveedor(p, a.id), {}],
  'deuda+': (p, n) => { const d = nuevoDe(p, n, 'deudas')[0] || {}; return ['deuda_alta', 'deuda', d.concepto || '', { monto: d.monto, proveedor: nombreProveedor(n, d.proveedorId) }] },
  'deuda~': (p, n, a) => ['deuda_edicion', 'deuda', deudaDe(n, a.id), { campos: clavesDe(a).join(', ') }],
  'deuda-abono': (p, n, a) => ['deuda_abono', 'deuda', deudaDe(p, a.id), { monto: a.monto }],
  'deuda-': (p, n, a) => ['deuda_borra', 'deuda', deudaDe(p, a.id), {}],

  'insumo+': (p, n, a) => ['insumo_guardar', 'insumo', String(a.insumo?.nombre || '').trim(), { stock: a.insumo?.stock, unidad: a.insumo?.unidad }],
  'insumo-': (p, n, a) => ['insumo_borrar', 'insumo', nombreInsumo(p, a.id), {}],
  'insumo-mov': (p, n, a) => ['insumo_movimiento', 'insumo', nombreInsumo(p, a.id), { tipo: a.tipo, cantidad: a.cantidad }],
  'insumo-mermas': (p, n, a) => ['insumo_merma', 'insumo', (a.lineas || []).map(l => nombreInsumo(p, l.id)).join(', '), { lineas: (a.lineas || []).length }],
  'receta~': (p, n, a) => ['receta_guardar', 'producto', nombreProducto(n, a.productoId),
    { lineas: (a.lineas || []).filter(l => l.insumo_id && num(l.cantidad) > 0).length }],

  'alerta+': (p, n, a) => ['alerta_creado', 'alerta', a.alerta?.titulo || a.alerta?.tipo || '', { tipo: a.alerta?.tipo, prioridad: a.alerta?.prioridad }],
  'alerta-resolver': (p, n, a) => ['alerta_resuelta', 'alerta', alertaDe(p, a.id), { resuelta: Boolean(a.resuelta) }],
  'alerta-mover': (p, n, a) => ['alerta_movida', 'alerta', alertaDe(p, a.id), { mesa: nombreMesa(n, a.mesaId) }],

  'reset': () => ['demo_reinicio', 'config', 'Negocio de demostración', {}],
}

function filasDeBitacora(prev, next, a) {
  const builder = BITACORA[a.t]
  if (!builder) return []
  try {
    const fila = builder(prev, next, a)
    return Array.isArray(fila[0]) ? fila : [fila]
  } catch { return [] }
}

// El reducer de demo es el de la app más la bitácora. No registra cuando la acción no cambió nada
// (un toque duplicado, una mesa ya ocupada), para que la auditoría no se llene de ruido.
function reducerDemo(s, a) {
  const nuevo = reducer(s, a)
  if (!nuevo._demo || nuevo === s) return nuevo
  const filas = filasDeBitacora(s, nuevo, a)
  if (!filas.length) return nuevo
  const en = new Date().toISOString()
  const actor = a.usuario || a.nombre || 'demo'
  const nuevas = filas.map(([accion, entity_type, entity_label, detalle]) => ({
    id: uid(), en, accion, actor_nombre: actor, entity_type, entity_label: entity_label || '', detalle: detalle || {},
  }))
  return { ...nuevo, bitacora: [...nuevas, ...(nuevo.bitacora || [])].slice(0, 800) }
}


export const leerSesionSup = () => { try { const r = localStorage.getItem(KEY_SESION); return r ? JSON.parse(r) : null } catch { return null } }
export const guardarSesionSup = ses => { try { if (ses) localStorage.setItem(KEY_SESION, JSON.stringify(ses)); else localStorage.removeItem(KEY_SESION) } catch {  } window.dispatchEvent(new Event('pos-sesion')) }

// Estado mientras se carga la empresa real (o si falla la carga): TOTALMENTE vacío.
// Antes copiaba el estado de demo (mesas 1-5, Salón/Terraza, productos de ejemplo) y por eso, al entrar a
// una empresa, se veían unos segundos mesas que no eran suyas hasta que llegaban las de verdad.
const SUP_VACIO = {
  config: { nombre: '', moneda: 'Bs', ivaPct: 0, propinaPct: 10, propinaMostrar: true, gruposImpresion: [], impresoraPorSeccion: {} },
  zonas: [], mesas: [], secciones: [], productos: [], cuentas: [], devoluciones: [],
  caja: { turno: null, siguienteTurno: 1, historial: [] },
  usuariosDemo: [], costos: [], proveedores: [], deudas: [], alertas: [], insumos: [], recetas: [], movimientos: [], bitacora: [], _supCargando: true,
}

function useSupabaseStore(empresaId) {
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  const estadoRef = useRef(null)
  const colaRef = useRef(Promise.resolve())
  const mapaRef = useRef(new Map())
  const avisa = useCallback(m => setError(textoError(typeof m === 'string' ? { message: m } : m)), [])

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
      .catch(err => { if (vivo) setError('No se pudo cargar la empresa: ' + textoError(err)) })
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

    const dif = (arrA, arrB) => { const S = new Set((arrA || []).map(x => x.id)); return (arrB || []).filter(x => !S.has(x.id)).map(x => x.id) }
    const accion = {
      ...a,
      _nuevos: {
        cuentas: dif(prev.cuentas, nuevo.cuentas),
        secciones: dif(prev.secciones, nuevo.secciones),
        productos: dif(prev.productos, nuevo.productos),
        proveedores: dif(prev.proveedores, nuevo.proveedores),
        deudas: dif(prev.deudas, nuevo.deudas),
        alertas: dif(prev.alertas, nuevo.alertas),
      },
    }
    estadoRef.current = { ...nuevo, _empresaId: empresaId, _supCargando: false }
    setS(estadoRef.current)
    colaRef.current = colaRef.current.then(async () => {
      if (!estadoRef.current) return
      try {
        const res = await despacharSupabase(estadoRef.current, accion, { mapa: mapaRef.current, setError: avisa })
        estadoRef.current = { ...res, _empresaId: empresaId }
        setS(estadoRef.current)
        setError('')
      } catch (err) {
        avisa(err)
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
  const [sDemo, dDemo] = useReducer(reducerDemo, null, () => { try { return migrar(JSON.parse(localStorage.getItem(KEY))) } catch { return inicial } })
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

// Prep · Parcial · Listo · Cuenta · Pagada: el paso por el que va la mesa, para verlo de lejos.
// Es solo un indicador: cobrar nunca depende de estar listo.
export const pasoPedido = c => {
  if (!c) return ''
  if (c.estado === 'cerrada') return 'pagada'
  if (c.estado === 'precuenta') return 'cuenta'
  const vivos = (c.items || []).filter(i => i.estado !== 'anulado')
  const listos = vivos.filter(i => i.estado === 'listo').length
  if (!vivos.length) return 'prep'
  if (listos === vivos.length) return 'listo'
  return listos ? 'parcial' : 'prep'
}
