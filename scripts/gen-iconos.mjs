// Genera todos los iconos de la PWA a partir del logo de la app.
//
//   node scripts/gen-iconos.mjs "G:\Punto de venta\logo-pos\Designer.png"
//
// Escribe en public/icons/: favicon-32, favicon-48, apple-touch-icon (180), icon-192,
// icon-512 e icon-maskable-192/512 (el escudo dentro de la zona segura del 80 % que
// recortan Android/iOS). Imprime el color de fondo muestreado del logo: es el que va en
// "background_color" del manifest para que el arranque de la PWA no haga corte de color.
//
// Nota técnica: con sharp no se puede encadenar extract() + trim() sobre el mismo pipeline
// (libvips devuelve "bad extract area"), por eso se normaliza primero a un cuadrado opaco
// en memoria y sobre ese buffer se mide y se escala.
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// sharp es la única dependencia del script y NO va en package.json: hace falta solo cuando
// cambia el logo, no para construir ni correr la app.
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
const LIENZO = 1024 // cuadrado de trabajo: todos los iconos salen de aquí
mkdirSync(SALIDA, { recursive: true })

const md = await sharp(ORIGEN).rotate().metadata() // rotate() sin argumento: aplica el EXIF
const lado = Math.min(md.width, md.height)
const base = await sharp(ORIGEN).rotate()
  .extract({ left: Math.round((md.width - lado) / 2), top: Math.round((md.height - lado) / 2), width: lado, height: lado })
  .resize(LIENZO, LIENZO)
  .flatten({ background: '#ffffff' }) // el logo no tiene canal alfa: icono opaco y sin sorpresas
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

// "maskable": al poner el logo al 90 % el dibujo queda en ~72 % del lienzo, dentro de la
// zona segura; el resto se rellena con el propio fondo del logo.
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
