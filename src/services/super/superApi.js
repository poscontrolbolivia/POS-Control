// Capa de acceso a datos del carril SUPER ADMIN.
// Todo pasa por RPCs `security definer` de supabase/setup.sql;
// la base es la que decide si el que llama es super (public.es_super()). Este archivo no escribe tablas.
// El flujo "entrar/salir de una empresa" usa el cliente COMPARTIDO de src/services/supabase.js
// (exporta fijarEmpresaSesion), porque ese cliente manda el header X-Session-Id que ancla la
// conexión de Postgres donde public.fijar_empresa deja el GUC app.empresa_id. El cliente propio
// de ./cliente.js (sin ese header) sigue para listado/exportación/importación/cuota: RPCs sueltas
// que no dependen del GUC.
import { sb, rpcSuper, esUuid, mensajeError, CONFIG_FALTA, SIN_SESION } from './cliente.js'
import { sb as sbSesion, fijarEmpresaSesion } from '../supabase.js'

// ─────────────── claves de localStorage que ya usa la app (acuerdo con el otro carril) ───────────────
// 'pos-sesion'            → la lee StoreProvider (src/services/store.jsx) y dispara 'pos-sesion'
// 'pos-empresa-activa-id' → la escribe fijarEmpresa() de src/services/supabase.js (dueña del
//                           acuerdo) para inyectar p_empresa_id en cada RPC de negocio
const KEY_SESION = 'pos-sesion'
const KEY_ANTERIOR = 'pos-super-sesion-anterior' // snapshot de tu sesión real, para poder "Salir"

const leer = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null } catch { return null } }
const escribir = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { return false } return true }
const avisar = () => { try { window.dispatchEvent(new Event('pos-sesion')) } catch { /* sin window (SSR/test) */ } }

// ─────────────────────────────── RPCs, una por función ───────────────────────────────

// esSuper(): nunca lanza. Sin configuración o sin sesión ⇒ false (la app simplemente no muestra el módulo).
export async function esSuper() {
  if (!sb) return false
  try { return Boolean(await rpcSuper('es_super')) } catch { return false }
}

// listarEmpresas(): [{ id, nombre, codigo, moneda, usuarios, mesas, productos, cuentas, creada_en }]
export async function listarEmpresas() {
  const filas = await rpcSuper('super_listar_empresas')
  return Array.isArray(filas) ? filas : []
}

// exportarEmpresa(id): snapshot jsonb completo de una empresa.
export async function exportarEmpresa(id) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  const datos = await rpcSuper('super_exportar_empresa', { p_empresa: id })
  if (!datos || typeof datos !== 'object') throw new Error('La base devolvió un respaldo vacío.')
  return datos
}

// importarEmpresa(datos, codigo, clave): recrea la empresa en ESTA base. Devuelve el uuid nuevo.
// La clave inicial solo se envía si viene escrita; si no, la RPC usa su defecto ('pos12345').
export async function importarEmpresa(datos, codigo, clave) {
  const revision = validarSnapshot(datos)
  if (!revision.ok) throw new Error(revision.problemas.join(' '))
  const cod = String(codigo || '').trim().toLowerCase()
  if (!cod) throw new Error('Escribe el código nuevo de la empresa (el que el cliente tecleará al entrar).')
  const params = { p_datos: datos, p_codigo: cod }
  const k = String(clave || '').trim()
  if (k) params.p_clave_inicial = k
  const nuevoId = await rpcSuper('super_importar_empresa', params)
  if (!esUuid(nuevoId)) throw new Error('La base no devolvió el identificador de la empresa creada.')
  return nuevoId
}

// ─────────── cuota del plan por empresa (RPCs de la migración setup.sql) ───────────

// verCuota(id): { max_productos (null = sin límite), plan ('gratis'|'pago'), productos_actuales }.
// La RPC solo responde a un super; cualquier otro usuario recibe 'requiere super'.
export async function verCuota(id) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  const d = await rpcSuper('super_ver_cuota', { p_empresa: id })
  if (!d || typeof d !== 'object') throw new Error('La base no devolvió la cuota de esta empresa.')
  return {
    max_productos: d.max_productos === undefined ? null : d.max_productos,
    plan: String(d.plan || 'gratis'),
    productos_actuales: Number(d.productos_actuales || 0),
  }
}

// ajustarCuota(id, { maxProductos, plan, notas }): fija el máximo de artículos a la venta y el plan.
// p_max_productos null (campo vacío) o plan 'pago' ⇒ sin límite, según setup.sql.
export async function ajustarCuota(id, { maxProductos = null, plan = 'gratis', notas = '' } = {}) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  if (plan !== 'gratis' && plan !== 'pago') throw new Error('El plan debe ser «gratis» o «pago».')
  const vacio = maxProductos === null || maxProductos === undefined || String(maxProductos).trim() === ''
  const max = vacio ? null : Number(maxProductos)
  if (max !== null && (!Number.isInteger(max) || max < 1)) {
    throw new Error('El máximo de artículos debe ser un número entero positivo o quedarse vacío (sin límite).')
  }
  await rpcSuper('super_ajustar_empresa', { p_empresa: id, p_max_productos: max, p_plan: plan, p_notas: String(notas || '') })
  return true
}

// registrarExporte(id): anotación en el log de auditoría tras una descarga de respaldo exitosa.
export async function registrarExporte(id) {
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  await rpcSuper('super_registrar_exporte', { p_empresa: id })
}

// ─────────────── "Entrar a una empresa" (mecanismo del cliente, sin service key) ───────────────
// Entrar hace DOS cosas:
//  1) fijarEmpresaSesion(id) — cliente compartido (header X-Session-Id): escribe
//     'pos-empresa-activa-id' (para el p_empresa_id de las RPCs de negocio) Y fija el GUC
//     app.empresa_id en la conexión anclada, que es lo que ahora dejan leer los SELECT
//     directos del salón/caja (mesas, cuentas, turnos) vía RLS. La propia RPC valida permisos:
//     rechaza a quien no sea super ni miembro, y ese error se traduce abajo al español del panel.
//  2) cambia la sesión del cliente: guarda la tuya en 'pos-super-sesion-anterior' y publica la
//     nueva con operando: true (el store escucha el evento 'pos-sesion').
export async function entrarEnEmpresa(empresa) {
  if (!empresa || !esUuid(empresa.id)) throw new Error('Empresa no válida.')
  try {
    await fijarEmpresaSesion(empresa.id)
  } catch (e) {
    throw new Error(mensajeError(e)) // 'requiere super' / 'no pertenece a esa empresa' → texto útil
  }
  const anterior = leer(KEY_SESION)
  if (anterior) escribir(KEY_ANTERIOR, anterior)
  const nueva = {
    ...(anterior || {}),
    empresaId: empresa.id,
    empresa: empresa.nombre,
    supabase: true,
    es_super: true, // el Topbar/App usan este flag (ver docs/HANDOFF-SUPER.md §2.2)
    operando: true,
    // El dueño inspecciona con permisos de admin en la pantalla; la base sigue decidiendo:
    // con la migración 002, private.mi_rol() devuelve 'admin' al super mientras empresa_activa()
    // apunte a la empresa que está viendo.
    rol: 'admin',
  }
  if (!escribir(KEY_SESION, nueva)) throw new Error('El navegador bloqueó localStorage: no se puede cambiar de empresa.')
  avisar()
  return nueva
}

// salirDeEmpresa(): restaura la sesión real del super, fija de nuevo SU empresa en la conexión
// anclada (para que los SELECT directos dejen de ver la empresa ajena) y avisa al store.
// Si el super no tenía empresa (entró al panel sin membresías), simplemente se limpia el pin.
export async function salirDeEmpresa() {
  const anterior = leer(KEY_ANTERIOR)
  escribir(KEY_SESION, anterior)
  escribir(KEY_ANTERIOR, null)
  let errorPin = null
  try {
    await fijarEmpresaSesion(anterior?.empresaId || null)
  } catch (e) {
    errorPin = mensajeError(e) // la sesión local ya quedó restaurada; avisamos sin bloquear
  }
  avisar()
  return { previa: anterior, errorPin }
}

// empresaViendo(): estado persistente del modo "operando" (sobrevive a una recarga).
export function empresaViendo() {
  const sesion = leer(KEY_SESION)
  const anterior = leer(KEY_ANTERIOR)
  if (!sesion?.operando || !sesion.empresaId) return null
  return { id: sesion.empresaId, nombre: sesion.empresa || 'la empresa', puedeSalir: Boolean(anterior) }
}

// sondearAcceso(id): ¿la app puede LEER ya los datos de esa empresa? Usa el cliente COMPARTIDO
// (header X-Session-Id) porque la prueba tiene que caer en la misma conexión donde
// fijarEmpresaSesion dejó el GUC app.empresa_id. Si la lista dice "9 mesas" pero el sondeo
// devuelve menos, falta el parche de la migración 002 y lo avisamos en la UI.
export async function sondearAcceso(id) {
  if (!sbSesion) throw new Error(CONFIG_FALTA)
  if (!esUuid(id)) throw new Error('El identificador de la empresa no es válido.')
  const { count, error } = await sbSesion.from('mesas').select('id', { count: 'exact', head: true }).eq('empresa_id', id)
  if (error) throw new Error(mensajeError(error))
  return Number(count || 0)
}

// true si el usuario ya tiene sesión de Supabase (aunque no sea super).
export { SIN_SESION as ERROR_SIN_SESION }
export const hayCliente = () => Boolean(sb)

// ─────────────────────────────── validación del respaldo ───────────────────────────────

// validarSnapshot(datos): comprueba las claves mínimas que exige la UI y la RPC de importación.
// Devuelve { ok, problemas, resumen } sin lanzar excepciones.
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

// resumir(datos): contados para mostrar ANTES de importar.
function resumir(datos) {
  const n = k => (Array.isArray(datos[k]) ? datos[k].length : 0)
  const empresa = datos.empresa && typeof datos.empresa === 'object' ? datos.empresa : {}
  return {
    nombre: String(empresa.nombre || '—'),
    codigoOriginal: String(empresa.codigo || '—'),
    moneda: String(empresa.moneda || 'Bs'),
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
  }
}

// ─────────────────────────────── descarga del jsonb ───────────────────────────────

// nombreArchivo(codigo): pos-control-<codigo>-AAAA-MM-DD.json
export function nombreArchivo(codigo) {
  const limpio = String(codigo || 'sin-codigo').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-codigo'
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `pos-control-${limpio}-${d.getFullYear()}-${mm}-${dd}.json`
}

// descargarJson(datos, codigo): guardado sin diálogos nativos (objectURL + <a download>).
export function descargarJson(datos, codigo) {
  const texto = typeof datos === 'string' ? datos : JSON.stringify(datos, null, 2)
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo(codigo)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // El navegador ya tiene el fichero en marcha: liberamos la URL un poco después.
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// leerTextoArchivo(file): texto de un <input type=file>, con error en español si no es JSON.
export async function leerTextoArchivo(file) {
  if (!file) throw new Error('No se seleccionó ningún archivo.')
  try {
    const texto = await file.text()
    return JSON.parse(texto)
  } catch {
    throw new Error('El archivo no contiene JSON válido. Usa un .json exportado por este panel.')
  }
}
