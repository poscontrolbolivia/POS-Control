import { mkdirSync } from 'node:fs'
import path from 'node:path'

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('Falta sharp para generar los iconos. Instalar sin guardarlo en package.json:\n  npm i --no-save sharp')
  process.exit(1)
}

const ORIGEN = process.argv[2]
if (!ORIGEN) {
  console.error('Falta la ruta del logo. Uso: node scripts/gen-iconos.mjs <ruta-logo.png>')
  process.exit(1)
}
const SALIDA = path.join('public', 'icons')
const LIENZO = 1024
mkdirSync(SALIDA, { recursive: true })

const md = await sharp(ORIGEN).rotate().metadata()
const lado = Math.min(md.width, md.height)
const base = await sharp(ORIGEN).rotate()
  .extract({ left: Math.round((md.width - lado) / 2), top: Math.round((md.height - lado) / 2), width: lado, height: lado })
  .resize(LIENZO, LIENZO)
  .flatten({ background: '#ffffff' })
  .png()
  .toBuffer()

const px = await sharp(base).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer()
const hex = '#' + [...px].map(n => n.toString(16).padStart(2, '0')).join('')

const t = await sharp(base).trim({ threshold: 8 }).toBuffer({ resolveWithObject: true })
const contenido = Math.max(t.info.width, t.info.height) / LIENZO
console.log(`logo ${md.width}×${md.height} → lienzo ${LIENZO}px · fondo ${hex} · dibujo ${Math.round(contenido * 100)} % del lienzo`)

const png = async (pxLado, nombre) => {
  await sharp(base).resize(pxLado, pxLado).png({ compressionLevel: 9 }).toFile(path.join(SALIDA, nombre))
  console.log('  ·', nombre)
}
await png(32, 'favicon-32.png')
await png(48, 'favicon-48.png')
await png(180, 'apple-touch-icon.png')
await png(192, 'icon-192.png')
await png(512, 'icon-512.png')

const mascara = async (pxLado, nombre) => {
  const interior = await sharp(base).resize(Math.round(pxLado * 0.9), Math.round(pxLado * 0.9)).png().toBuffer()
  await sharp({ create: { width: pxLado, height: pxLado, channels: 3, background: hex } })
    .composite([{ input: interior, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(SALIDA, nombre))
  console.log('  ·', nombre)
}
await mascara(192, 'icon-maskable-192.png')
await mascara(512, 'icon-maskable-512.png')
