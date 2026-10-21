// Respaldo completo de una empresa: datos.json + las fotos reales (productos y comprobantes QR) dentro de un .zip.
// JSZip se carga solo al exportar/importar (no pesa en el arranque de la app).
import { sb, SIN_SESION } from './client.js'

export const BUCKET_PRODUCTOS = 'pos-imagenes'
export const BUCKET_COMPROBANTES = 'pos-comprobantes'
const EXT_MIME = { webp: 'image/webp', jpg: 'image/jpeg' }
const PARALELO = 4

const rutaValida = p => typeof p === 'string' && p && !/^(https?:|data:)/i.test(p) && !p.includes('..')

// Fotos que referencia un respaldo: la ruta del producto, la del logo y QR del negocio, y la del comprobante de cada pago.
export function fotosDe(datos) {
  const lista = []
  const vistos = new Set()
  const meter = (bucket, path) => {
    if (!rutaValida(path)) return
    const k = bucket + '/' + path
    if (!vistos.has(k)) { vistos.add(k); lista.push({ bucket, path }) }
  }
  const cfg = datos?.empresa?.config || {}
  meter(BUCKET_PRODUCTOS, cfg.logoPath)
  meter(BUCKET_PRODUCTOS, cfg.qrPath)
  for (const p of datos?.productos || []) meter(BUCKET_PRODUCTOS, p?.imagen_path)
  for (const pg of datos?.pagos || []) meter(BUCKET_COMPROBANTES, pg?.detalle?.comprobante)
  return lista
}

async function enLotes(items, trabajo, onProgreso) {
  let hechas = 0
  const salida = []
  for (let i = 0; i < items.length; i += PARALELO) {
    const lote = items.slice(i, i + PARALELO)
    const res = await Promise.all(lote.map(it => trabajo(it).catch(e => ({ error: e?.message || String(e), it }))))
    salida.push(...res)
    hechas += lote.length
    onProgreso?.(hechas, items.length)
  }
  return salida
}

export async function crearZipRespaldo(datos, onProgreso) {
  if (!sb) throw new Error(SIN_SESION)
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const fotos = fotosDe(datos)
  zip.file('datos.json', JSON.stringify(datos, null, 2))
  const res = await enLotes(fotos, async f => {
    const { data, error } = await sb.storage.from(f.bucket).download(f.path)
    if (error || !data) throw new Error(`${f.bucket}/${f.path}: ${error?.message || 'vacía'}`)
    zip.file(`fotos/${f.bucket}/${f.path}`, data)
    return { ok: true }
  }, onProgreso)
  const fallidas = res.filter(r => r?.error).map(r => r.error)
  zip.file('LEEME.txt', [
    'Respaldo completo de POS Control.',
    'datos.json  → toda la empresa (menú, mesas, cuentas, pagos, turnos, inventario, devoluciones, proveedores, costos, cuentas por pagar, alertas, equipo).',
    'fotos/      → las fotos de productos, el logo y el QR de pago del negocio y los comprobantes (el archivo real, no solo la ruta).',
    'Para restaurarlo: panel Super admin → Importar → elige este .zip.',
    'Las contraseñas no se pueden exportar: el equipo recibe una clave temporal al importar.',
    fallidas.length ? `\nNo se pudieron bajar ${fallidas.length} foto(s):\n` + fallidas.join('\n') : '',
  ].join('\n'))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { blob, total: fotos.length, fallidas }
}

export async function leerArchivoRespaldo(file) {
  if (!file) throw new Error('No se seleccionó ningún archivo.')
  const esZip = /\.zip$/i.test(file.name || '') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
  if (!esZip) {
    try { return { datos: JSON.parse(await file.text()), zip: null } } catch { throw new Error('El archivo no contiene JSON válido. Usa un .json o un .zip exportado por este panel.') }
  }
  const JSZip = (await import('jszip')).default
  let zip
  try { zip = await JSZip.loadAsync(file) } catch { throw new Error('No se pudo abrir el .zip. ¿Está dañado?') }
  const entrada = zip.file('datos.json')
  if (!entrada) throw new Error('El .zip no trae datos.json: no es un respaldo de este panel.')
  try { return { datos: JSON.parse(await entrada.async('string')), zip } } catch { throw new Error('El datos.json del .zip no es JSON válido.') }
}

// Sube al almacenamiento de la empresa NUEVA las fotos que el importador renombró ({bucket, de, a}).
export async function subirFotosImportadas(zip, fotos, onProgreso) {
  if (!sb) throw new Error(SIN_SESION)
  const res = await enLotes(fotos || [], async f => {
    const entrada = zip.file(`fotos/${f.bucket}/${f.de}`)
    if (!entrada) throw new Error(`falta en el zip: ${f.de}`)
    const ext = (f.a.match(/\.(webp|jpg)$/) || [])[1]
    const blob = new Blob([await entrada.async('arraybuffer')], { type: EXT_MIME[ext] || 'image/webp' })
    const { error } = await sb.storage.from(f.bucket).upload(f.a, blob, { contentType: blob.type, upsert: true })
    if (error) throw new Error(`${f.a}: ${error.message}`)
    return { ok: true }
  }, onProgreso)
  const fallidas = res.filter(r => r?.error).map(r => r.error)
  return { subidas: res.length - fallidas.length, fallidas }
}
