import { sb, rpcSuper, esUuid, mensajeError, CONFIG_FALTA, SIN_SESION } from './client.js'
import { MONEDA } from '../config.js'
import { sb as sbSesion, fijarEmpresaSesion } from '../supabaseClient.js'
import { crearZipRespaldo, subirFotosImportadas, leerArchivoRespaldo, fotosDe } from './respaldoZip.js'

const KEY_SESION = 'pos-sesion'
const KEY_ANTERIOR = 'pos-super-sesion-anterior'

const leer = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null } catch { return null } }
const escribir = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { return false } return true }
const avisar = () => { try { window.dispatchEvent(new Event('pos-sesion')) } catch {  } }

export async function esSuper() {
  if (!sb) return false
  try { return Boolean(await rpcSuper('es_super')) } catch { return false }
}

export async function listarEmpresas() {
  const filas = await rpcSuper('super_listar_empresas')
  return Array.isArray(filas) ? filas : []
}

export async function exportarEmpresa(id) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  const datos = await rpcSuper('super_exportar_empresa', { p_empresa: id })
  if (!datos || typeof datos !== 'object') throw new Error('La base devolvió un respaldo vacío.')
  return datos
}

// `zip` (opcional): el .zip leído con leerArchivoRespaldo; con él se restauran también las fotos.
export async function importarEmpresa(datos, codigo, clave, { zip = null, onProgreso } = {}) {
  const revision = validarSnapshot(datos)
  if (!revision.ok) throw new Error(revision.problemas.join(' '))
  const cod = String(codigo || '').trim().toLowerCase()
  if (!cod) throw new Error('Escribe el código nuevo de la empresa (el que el cliente tecleará al entrar).')
  const params = { p_datos: datos, p_codigo: cod, p_con_fotos: Boolean(zip) }
  const k = String(clave || '').trim()
  if (k) params.p_clave_inicial = k
  const resp = await rpcSuper('super_importar_empresa', params)
  const nuevoId = typeof resp === 'string' ? resp : resp?.empresa_id
  if (!esUuid(nuevoId)) throw new Error('La base no devolvió el identificador de la empresa creada.')
  let fotos = { subidas: 0, fallidas: [] }
  if (zip && Array.isArray(resp?.fotos) && resp.fotos.length) {
    try { fotos = await subirFotosImportadas(zip, resp.fotos, onProgreso) }
    catch (e) { fotos = { subidas: 0, fallidas: [mensajeError(e)] } }
  }
  return { id: nuevoId, fotos }
}

// Exportación completa: datos.json + las fotos reales en un .zip.
export async function exportarEmpresaZip(id, onProgreso) {
  const datos = await exportarEmpresa(id)
  const { blob, total, fallidas } = await crearZipRespaldo(datos, onProgreso)
  return { datos, blob, total, fallidas }
}

export { leerArchivoRespaldo }

export async function verCuota(id) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  const d = await rpcSuper('super_ver_cuota', { p_empresa: id })
  if (!d || typeof d !== 'object') throw new Error('La base no devolvió la cuota de esta empresa.')
  return {
    max_productos: d.max_productos === undefined ? null : d.max_productos,
    plan: String(d.plan || 'gratis'),
    premium_hasta: d.premium_hasta || null,
    max_miembros: d.max_miembros === undefined ? null : d.max_miembros,
    productos_actuales: Number(d.productos_actuales || 0),
    miembros_actuales: Number(d.miembros_actuales || 0),
  }
}

export async function cambiarPlan(id, plan, dias = null) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  if (plan !== 'gratis' && plan !== 'pago') throw new Error('El plan debe ser «gratis» (Básico) o «pago» (Premium).')
  const n = dias === null || dias === undefined || dias === '' ? null : Number(dias)
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 3650)) throw new Error('Los días deben ser un número entero entre 1 y 3650.')
  await rpcSuper('super_cambiar_plan', n === null || plan !== 'pago' ? { p_empresa: id, p_plan: plan } : { p_empresa: id, p_plan: plan, p_dias: n })
  return true
}

export async function ajustarCuota(id, { maxProductos = null, maxMiembros = null, plan = 'gratis', notas = '' } = {}) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  if (plan !== 'gratis' && plan !== 'pago') throw new Error('El plan debe ser «gratis» o «pago».')
  const vacio = maxProductos === null || maxProductos === undefined || String(maxProductos).trim() === ''
  const max = vacio ? null : Number(maxProductos)
  if (max !== null && (!Number.isInteger(max) || max < 1)) {
    throw new Error('El máximo de artículos debe ser un número entero positivo o quedarse vacío (sin límite).')
  }
  const vacioM = maxMiembros === null || maxMiembros === undefined || String(maxMiembros).trim() === ''
  const maxM = vacioM ? null : Number(maxMiembros)
  if (maxM !== null && (!Number.isInteger(maxM) || maxM < 1)) {
    throw new Error('El máximo de personas debe ser un número entero positivo o quedarse vacío (sin límite).')
  }
  await rpcSuper('super_ajustar_empresa', { p_empresa: id, p_max_productos: max, p_plan: plan, p_notas: String(notas || ''), p_max_miembros: maxM })
  return true
}

export async function registrarExporte(id) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  await rpcSuper('super_registrar_exporte', { p_empresa: id })
}

export async function entrarEnEmpresa(empresa) {
  if (!empresa || !esUuid(empresa.id)) throw new Error('Empresa no válida.')
  try {
    await fijarEmpresaSesion(empresa.id)
  } catch (e) {
    throw new Error(mensajeError(e))
  }
  const anterior = leer(KEY_SESION)
  if (anterior) escribir(KEY_ANTERIOR, anterior)
  const nueva = {
    ...(anterior || {}),
    empresaId: empresa.id,
    empresa: empresa.nombre,
    supabase: true,
    es_super: true,
    operando: true,

    rol: 'admin',
  }
  if (!escribir(KEY_SESION, nueva)) throw new Error('El navegador bloqueó localStorage: no se puede cambiar de empresa.')
  avisar()
  return nueva
}

export async function salirDeEmpresa() {
  const anterior = leer(KEY_ANTERIOR)
  escribir(KEY_SESION, anterior)
  escribir(KEY_ANTERIOR, null)
  let errorPin = null
  try {
    await fijarEmpresaSesion(anterior?.empresaId || null)
  } catch (e) {
    errorPin = mensajeError(e)
  }
  avisar()
  return { previa: anterior, errorPin }
}

export function empresaViendo() {
  const sesion = leer(KEY_SESION)
  const anterior = leer(KEY_ANTERIOR)
  if (!sesion?.operando || !sesion.empresaId) return null
  return { id: sesion.empresaId, nombre: sesion.empresa || 'la empresa', puedeSalir: Boolean(anterior) }
}

export async function sondearAcceso(id) {
  if (!sbSesion) throw new Error(CONFIG_FALTA)
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  const { count, error } = await sbSesion.from('mesas').select('id', { count: 'exact', head: true }).eq('empresa_id', id)
  if (error) throw new Error(mensajeError(error))
  return Number(count || 0)
}

export { SIN_SESION as ERROR_SIN_SESION }
export const hayCliente = () => Boolean(sb)

export function validarSnapshot(datos) {
  const problemas = []
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return { ok: false, problemas: ['El contenido no es un objeto JSON válido.'], resumen: null }
  }
  const lista = ['zonas', 'mesas', 'productos'].filter(k => !Array.isArray(datos[k]))
  const cuentaEmpresa = !datos.empresa || typeof datos.empresa !== 'object'
  if (cuentaEmpresa) problemas.push('El respaldo no tiene el objeto "empresa".')
  if (lista.length) problemas.push(`El respaldo no tiene la lista "${lista.join('", "')}" (debe ser un array, aunque esté vacío).`)
  if (!cuentaEmpresa && !String(datos.empresa?.nombre || '').trim()) problemas.push('La empresa del respaldo no tiene nombre.')
  return { ok: problemas.length === 0, problemas, resumen: problemas.length ? null : resumir(datos) }
}

function resumir(datos) {
  const n = k => (Array.isArray(datos[k]) ? datos[k].length : 0)
  const empresa = datos.empresa && typeof datos.empresa === 'object' ? datos.empresa : {}
  return {
    nombre: String(empresa.nombre || '—'),
    codigoOriginal: String(empresa.codigo || '—'),
    moneda: String(empresa.moneda || MONEDA),
    exportadoEn: empresa.exportado_en || datos.exportado_en || null,
    zonas: n('zonas'),
    mesas: n('mesas'),
    secciones: n('secciones'),
    productos: n('productos'),
    cuentas: n('cuentas'),
    items: n('cuenta_items'),
    pagos: n('pagos'),
    turnos: n('turnos'),
    equipo: n('equipo'),
    insumos: n('insumos'),
    recetas: n('recetas'),
    devoluciones: n('devoluciones'),
    proveedores: n('proveedores'),
    costos: n('costos_producto'),
    deudas: n('cuentas_por_pagar'),
    alertas: n('alertas'),
    fotos: fotosDe(datos).length,
    version: Number(datos.version || 1),
  }
}

function nombreArchivo(codigo, ext = 'json') {
  const limpio = String(codigo || 'sin-codigo').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-codigo'
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `pos-control-${limpio}-${d.getFullYear()}-${mm}-${dd}.${ext}`
}

export function descargarJson(datos, codigo) {
  const texto = typeof datos === 'string' ? datos : JSON.stringify(datos, null, 2)
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo(codigo)
  document.body.appendChild(a)
  a.click()
  a.remove()

  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function descargarBlob(blob, codigo, ext = 'zip') {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo(codigo, ext)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

