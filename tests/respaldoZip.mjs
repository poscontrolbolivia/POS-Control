// Respaldo .zip: referencias de fotos, lectura de datos.json y que un .json sigue funcionando.
import JSZip from 'jszip'
import { fotosDe, leerArchivoRespaldo } from '../src/services/super/respaldoZip.js'
import { validarSnapshot } from '../src/services/super/superApi.js'
let ok = 0, mal = 0
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n) } }

const datos = {
  version: 3, empresa: { nombre: 'Café', codigo: 'cafe' }, zonas: [], mesas: [], insumos: [{ id: 'i' }], devoluciones: [{}],
  productos: [
    { id: 'p1', imagen_path: 'productos/e/p1.webp' }, { id: 'p2', imagen_path: 'productos/e/p1.webp' },
    { id: 'p3', imagen_path: null }, { id: 'p4', imagen_path: 'https://x/y.png' }, { id: 'p5', imagen_path: '../malo.webp' },
  ],
  pagos: [{ detalle: { comprobante: 'comprobantes/e/c1.jpg' } }, { detalle: {} }, { detalle: { comprobante: 'data:image/png;base64,AAA' } }],
}
const f = fotosDe(datos)
t('2 fotos únicas y válidas', f.length === 2)
t('producto en pos-imagenes', f.some(x => x.bucket === 'pos-imagenes' && x.path === 'productos/e/p1.webp'))
t('comprobante en pos-comprobantes', f.some(x => x.bucket === 'pos-comprobantes' && x.path === 'comprobantes/e/c1.jpg'))
const r = validarSnapshot(datos)
t('snapshot v3 válido', r.ok && r.resumen.insumos === 1 && r.resumen.devoluciones === 1 && r.resumen.fotos === 2)

const zip = new JSZip()
zip.file('datos.json', JSON.stringify(datos))
zip.file('fotos/pos-imagenes/productos/e/p1.webp', new Uint8Array([1, 2, 3]))
const blob = await zip.generateAsync({ type: 'uint8array' })
const leido = await leerArchivoRespaldo(new File([blob], 'respaldo.zip', { type: 'application/zip' }))
t('zip: datos.json leído', leido.datos.empresa.nombre === 'Café' && leido.zip)
t('zip: la foto está dentro', (await leido.zip.file('fotos/pos-imagenes/productos/e/p1.webp').async('uint8array')).length === 3)
const j = await leerArchivoRespaldo(new File([JSON.stringify(datos)], 'respaldo.json', { type: 'application/json' }))
t('json sigue funcionando', j.datos.version === 3 && j.zip === null)
const vacio = new JSZip(); vacio.file('otro.txt', 'x')
let err = ''
try { await leerArchivoRespaldo(new File([await vacio.generateAsync({ type: 'uint8array' })], 'x.zip')) } catch (e) { err = e.message }
t('zip sin datos.json da error claro', /datos\.json/.test(err))
console.log(`respaldoZip: ${ok} ✓ ${mal} ✗`)
if (mal) process.exit(1)
