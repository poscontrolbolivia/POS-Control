// Foto del comprobante de un pago con QR (la pantalla del celular del cliente). Es opcional.
// Se guarda en el bucket PRIVADO «pos-comprobantes» (comprobantes/<empresa>/<uuid>.webp|jpg) y la ruta viaja en pagos.detalle.comprobante.
// En modo demo (sin servidor) la foto queda como data URL solo en memoria.
export const BUCKET_COMPROBANTES = 'pos-comprobantes'
const LADO_MAX = 1280
const MAX_ENTRADA = 12 * 1024 * 1024
const LIMITE = 300000

const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) }))
const toBlob = (cv, mime, q) => new Promise(r => cv.toBlob(r, mime, q))

export async function comprimirComprobante(file) {
  if (!file || !(file.type || '').startsWith('image/')) throw new Error('not-image')
  if (file.size > MAX_ENTRADA) throw new Error('too-big')
  const bmp = typeof createImageBitmap === 'function' ? await createImageBitmap(file).catch(() => null) : null
  let img = bmp, w = bmp?.width, h = bmp?.height
  if (!img) {
    const url = URL.createObjectURL(file)
    try {
      img = await new Promise((ok, no) => { const e = new Image(); e.onload = () => ok(e); e.onerror = () => no(new Error('unreadable')); e.src = url })
      w = img.naturalWidth; h = img.naturalHeight
    } finally { URL.revokeObjectURL(url) }
  }
  if (!w || !h) throw new Error('unreadable')
  const k = Math.min(1, LADO_MAX / Math.max(w, h))
  const cv = document.createElement('canvas')
  cv.width = Math.round(w * k); cv.height = Math.round(h * k)
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
  try { img.close?.() } catch { /* nada */ }
  let blob = await toBlob(cv, 'image/webp', 0.8)
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(cv, 'image/jpeg', 0.8)
  let q = 0.8
  while (blob && blob.size > LIMITE && q > 0.35) { q -= 0.1; blob = (await toBlob(cv, blob.type, q)) || blob }
  if (!blob || blob.size > LIMITE) throw new Error('too-big')
  return blob
}

export const blobADataUrl = blob => new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => no(new Error('unreadable')); f.readAsDataURL(blob) })

export async function subirComprobante(sb, empresaId, blob) {
  if (!sb || !empresaId) throw new Error('offline')
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'webp'
  const path = `comprobantes/${empresaId}/${uuid()}.${ext}`
  const { error } = await sb.storage.from(BUCKET_COMPROBANTES).upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw new Error(error.message || 'upload')
  return path
}

// URL temporal (5 min) para ver un comprobante guardado; una data URL (demo) se devuelve tal cual.
export async function urlComprobante(sb, ref) {
  if (!ref) return null
  if (String(ref).startsWith('data:')) return ref
  const { data, error } = await sb.storage.from(BUCKET_COMPROBANTES).createSignedUrl(ref, 300)
  if (error) throw new Error(error.message || 'signed')
  return data.signedUrl
}
