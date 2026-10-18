import { SUPABASE_URL } from './config.js'

export const LADO_VISUAL_PX = 45
export const LADO_ALMACENADO_PX = LADO_VISUAL_PX * 2
export const BUCKET = 'pos-imagenes'

const MAX_BYTES_ENTRADA = 8 * 1024 * 1024
const LIMITE_STORAGE_BYTES = 209715
const CALIDAD_INICIAL = 0.85

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

export const rutaImagenProducto = (empresaId, productoId, ext = 'webp') =>
  `productos/${empresaId}/${productoId}.${ext}`

const extParaMime = mime => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp')

export function imagenPublica(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

const cacheSesion = new Map()
export function registrarCacheImagen(productoId, url) {
  if (!productoId) return
  if (url) cacheSesion.set(productoId, url)
  else cacheSesion.delete(productoId)
}

export function urlImagenProducto(p) {
  if (!p) return null
  if (p.imagen_path) return imagenPublica(p.imagen_path)
  if (p.imagen_dataurl) return p.imagen_dataurl
  return cacheSesion.get(p.id) || null
}

async function decodificar(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { img: bmp, ancho: bmp.width, alto: bmp.height }
    } catch {  }
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
  try { img.close?.() } catch {  }

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

export async function blobADataUrl(blob) {
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('No se pudo leer la imagen comprimida.'))
      fr.readAsDataURL(blob)
    })
  }

  const buf = await blob.arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return `data:${blob.type};base64,${btoa(bin)}`
}

export async function subirImagen(sb, empresaId, productoId, blob, mime = 'image/webp') {
  if (!sb) throw new Error('Sin conexión con el servidor: no se pueden subir fotos en el modo demo.')
  if (!empresaId || !productoId) throw new Error('Falta identificar la empresa o el artículo.')
  const ext = extParaMime(mime)
  const path = rutaImagenProducto(empresaId, productoId, ext)
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: mime || 'image/webp', upsert: true })
  if (error) throw new Error('No se pudo subir la foto: ' + (error.message || String(error)))
  return path
}

export async function borrarImagen(sb, path) {
  if (!sb) throw new Error('Sin conexión con el servidor: no se pueden borrar fotos en el modo demo.')
  if (!path) return
  const { error } = await sb.storage.from(BUCKET).remove([path])
  if (error) throw new Error('No se pudo borrar la foto: ' + (error.message || String(error)))
}

export async function fijarImagenPath(sb, empresaId, productoId, path) {
  if (!sb) return
  const { error } = await sb.from('productos').update({ imagen_path: path }).eq('id', productoId).eq('empresa_id', empresaId)
  if (error) throw new Error('No se pudo guardar la foto del artículo: ' + (error.message || String(error)))
}

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

  const dataUrl = await blobADataUrl(blob)
  registrarCacheImagen(productoId, dataUrl)
  return { imagen_path: null, imagen_dataurl: dataUrl }
}

export async function quitarImagenGuardada({ sb, modo, empresaId, productoId, imagen_path }) {
  if (modo === 'supabase') {
    if (imagen_path) await borrarImagen(sb, imagen_path)
    await fijarImagenPath(sb, empresaId, productoId, null)
  }
  registrarCacheImagen(productoId, null)
  return { imagen_path: null, imagen_dataurl: null }
}
