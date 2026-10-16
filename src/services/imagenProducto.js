// Compresión y gestión de las fotos de artículo (carril IMÁGENES).
//
// REGLA DE TAMAÑO (pedido del dueño, v0.4):
//   · En pantalla el miniato mide LADO_VISUAL_PX (45 px).
//   · En Storage se guarda LADO_ALMACENADO_PX (2× → 90 px) para que se vea nítido
//     en móviles retina. Ajustar LADO_VISUAL_PX mueve los dos números a la vez.
//   · Nunca viaja un archivo mayor a ~200 KB (límite real del bucket: 209715 B).
//     El recorte a 90 px + webp deja los archivos en unos pocos KB con sobra.
//
// CONTRATO de backend (migración 002): columna pública.productos.imagen_path guarda la
// ruta de Storage con la forma EXACTA `productos/{empresa_id}/{producto_id}.webp` y el
// bucket público se llama `pos-imagenes`. La URL pública es
// `${SUPABASE_URL}/storage/v1/object/public/pos-imagenes/${imagen_path}`.

import { SUPABASE_URL } from '../config.js'

// ──────────────────────────────── constantes de tamaño ────────────────────────────────
export const LADO_VISUAL_PX = 45                              // px CSS del miniato en tiles/rows
export const LADO_ALMACENADO_PX = LADO_VISUAL_PX * 2          // 2×: nítido en pantallas retina (90)
export const BUCKET = 'pos-imagenes'

const MAX_BYTES_ENTRADA = 8 * 1024 * 1024   // 8 MB: se rechaza ANTES de decodificar
const LIMITE_STORAGE_BYTES = 209715          // límite del bucket (≈205 KB)
const CALIDAD_INICIAL = 0.85

// ─────────────────────────────── helpers puros (testeables) ───────────────────────────

// Recorte "cover" centrado: de una imagen srcW×srcH toma el cuadrado central de lado
// min(srcW,srcH) y lo escala a `lado` px. Devuelve los 8 números para drawImage.
export function recubrirCuadrado(srcW, srcH, lado) {
  const sSize = Math.min(srcW, srcH)
  return {
    sx: (srcW - sSize) / 2,
    sy: (srcH - sSize) / 2,
    sSize,
    dx: 0,
    dy: 0,
    dSize: lado,
  }
}

// Ruta canónica del objeto dentro del bucket (forma del contrato).
export const rutaImagenProducto = (empresaId, productoId, ext = 'webp') =>
  `productos/${empresaId}/${productoId}.${ext}`

// Extensión a partir del mime real que devolvió el navegador.
const extParaMime = mime => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp')

// URL pública de una ruta guardada. Acepta ruta relativa (contractual) o URL absoluta.
export function imagenPublica(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

// Cache de sesión (productoId → url). Refleja la foto al instante en TODA la app, incluso
// en modo Supabase donde `tiendaSupabase.mapProducto` aún no trae imagen_path al recargar.
const cacheSesion = new Map()
export function registrarCacheImagen(productoId, url) {
  if (!productoId) return
  if (url) cacheSesion.set(productoId, url)
  else cacheSesion.delete(productoId)
}

// Resuelve la imagen de un producto para cualquier tile/row:
//   1) imagen_path (Supabase: columna Storage) → URL pública
//   2) imagen_dataurl (modo demo: data URL persistida en el estado local)
//   3) cache de sesión (recién subida, antes de que la recarguemos desde la base)
export function urlImagenProducto(p) {
  if (!p) return null
  if (p.imagen_path) return imagenPublica(p.imagen_path)
  if (p.imagen_dataurl) return p.imagen_dataurl
  return cacheSesion.get(p.id) || null
}

// ─────────────────────────────────── compresión ───────────────────────────────────────

// Decodifica el archivo: prefiere createImageBitmap (rápido, sin tocar el DOM) y cae a
// <img> + object URL si el navegador no lo soporta o el formato se le resiste.
async function decodificar(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { img: bmp, ancho: bmp.width, alto: bmp.height }
    } catch { /* formato raro: probamos con <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('No se pudo leer la imagen. Prueba con un archivo diferente.'))
      el.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('La imagen está vacía o es inválida.')
    return { img, ancho: img.naturalWidth, alto: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const blobDeCanvas = (canvas, mime, calidad) =>
  new Promise(resolve => canvas.toBlob(resolve, mime, calidad))

// Comprime un File a un cuadrado `lado`×`lado`. Devuelve { blob, mime }.
// Rechaza no-imágenes y archivos > 8 MB ANTES de decodificar. Si el navegador no codifica
// webp (p. ej. Safari), cae a jpeg. Si aun así pasa del límite del bucket, rebaja calidad.
export async function comprimirImagen(file, lado = LADO_ALMACENADO_PX) {
  if (!file) throw new Error('Selecciona un archivo de imagen.')
  const tipo = (file.type || '').toLowerCase()
  if (!tipo.startsWith('image/')) throw new Error('Ese archivo no es una imagen.')
  if (file.size > MAX_BYTES_ENTRADA) throw new Error('La imagen pesa demasiado (máximo 8 MB).')

  const { img, ancho, alto } = await decodificar(file)
  const rec = recubrirCuadrado(ancho, alto, lado)
  const canvas = document.createElement('canvas')
  canvas.width = lado
  canvas.height = lado
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, rec.sx, rec.sy, rec.sSize, rec.sSize, rec.dx, rec.dy, rec.dSize, rec.dSize)
  try { img.close?.() } catch { /* noop */ }

  // El navegador devuelve PNG si no reconoce 'image/webp': detectamos por el tipo real.
  let blob = await blobDeCanvas(canvas, 'image/webp', CALIDAD_INICIAL)
  let mime = blob?.type || ''
  if (mime !== 'image/webp') {
    blob = await blobDeCanvas(canvas, 'image/jpeg', CALIDAD_INICIAL)
    mime = blob?.type || 'image/jpeg'
  }
  if (!blob) throw new Error('El navegador no pudo comprimir la imagen.')

  let calidad = CALIDAD_INICIAL
  while (blob.size > LIMITE_STORAGE_BYTES && calidad > 0.4) {
    calidad -= 0.1
    blob = await blobDeCanvas(canvas, mime, calidad) || blob
    mime = blob?.type || mime
  }
  if (blob.size > LIMITE_STORAGE_BYTES) {
    throw new Error('La imagen sigue muy pesada tras comprimirla. Prueba con otra de menor resolución.')
  }
  return { blob, mime: blob.type || mime }
}

// Modo demo: sin Storage. Convertimos el blob a data URL para guardarla en el estado local
// (localStorage) y que sobreviva recargas. Es pequeño (~3-6 KB a 90 px).
export async function blobADataUrl(blob) {
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('No se pudo leer la imagen comprimida.'))
      fr.readAsDataURL(blob)
    })
  }
  // Fallback (Fetch API): la mayoría de navegadores modernos.
  const buf = await blob.arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return `data:${blob.type};base64,${btoa(bin)}`
}

// ──────────────────────────────── Storage (Supabase) ──────────────────────────────────

// Sube el blob al bucket público devolviendo la ruta canónica del contrato.
export async function subirImagen(sb, empresaId, productoId, blob, mime = 'image/webp') {
  if (!sb) throw new Error('Sin conexión con el servidor: no se pueden subir fotos en el modo demo.')
  if (!empresaId || !productoId) throw new Error('Falta identificar la empresa o el artículo.')
  const ext = extParaMime(mime)
  const path = rutaImagenProducto(empresaId, productoId, ext)
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: mime || 'image/webp', upsert: true })
  if (error) throw new Error('No se pudo subir la foto: ' + (error.message || String(error)))
  return path
}

// Borra el objeto de Storage (silencia "no existe" para poder reintentar el limpiado).
export async function borrarImagen(sb, path) {
  if (!sb) throw new Error('Sin conexión con el servidor: no se pueden borrar fotos en el modo demo.')
  if (!path) return
  const { error } = await sb.storage.from(BUCKET).remove([path])
  if (error) throw new Error('No se pudo borrar la foto: ' + (error.message || String(error)))
}

// Escribe la columna public.productos.imagen_path. Se hace DIRECTO porque tiendaSupabase.js
// (fuera del alcance de este carril) aún no mapea imagen_path en su UPDATE de productos.
export async function fijarImagenPath(sb, empresaId, productoId, path) {
  if (!sb) return // modo demo: la ruta va en el estado local, no en la base
  const { error } = await sb.from('productos').update({ imagen_path: path }).eq('id', productoId).eq('empresa_id', empresaId)
  if (error) throw new Error('No se pudo guardar la foto del artículo: ' + (error.message || String(error)))
}

// ──────────────────────────────── orquestación UI ─────────────────────────────────────

// Pipeline completo que usa MenuAdmin: comprimir → subir (o data URL en demo) → persistir.
// Devuelve la "ruta" a guardar en el estado local: { imagen_path } en Supabase o
// { imagen_dataurl } en demo. Lanza Error con mensaje en español que la UI muestra.
export async function procesarYGuardarImagen({ sb, modo, empresaId, productoId, file }) {
  const { blob, mime } = await comprimirImagen(file)
  if (modo === 'supabase') {
    if (!sb || !empresaId) throw new Error('No hay empresa activa para subir la foto.')
    const path = await subirImagen(sb, empresaId, productoId, blob, mime)
    await fijarImagenPath(sb, empresaId, productoId, path)
    const url = imagenPublica(path)
    registrarCacheImagen(productoId, url)
    return { imagen_path: path, imagen_dataurl: null }
  }
  // demo: sin Storage. La data URL reemplaza a la anterior en el propio estado local.
  const dataUrl = await blobADataUrl(blob)
  registrarCacheImagen(productoId, dataUrl)
  return { imagen_path: null, imagen_dataurl: dataUrl }
}

// Quita la foto: borra el objeto de Storage + limpia la columna (Supabase) y el estado local.
export async function quitarImagenGuardada({ sb, modo, empresaId, productoId, imagen_path }) {
  if (modo === 'supabase') {
    if (imagen_path) await borrarImagen(sb, imagen_path)
    await fijarImagenPath(sb, empresaId, productoId, null)
  }
  registrarCacheImagen(productoId, null)
  return { imagen_path: null, imagen_dataurl: null }
}
