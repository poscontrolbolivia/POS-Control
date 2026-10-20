// El reporte de cierre se mide: cantidades por plato/bebida, promedio por persona, totales y el PDF generado.
import { createServer } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let fallos = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fallos++ }
const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } })
try {
  const R = await server.ssrLoadModule('/src/services/reporteCierre.js')
  const base = { tipo: 'mesa', estado: 'cerrada', cerradaEn: 2000, descuento: 0, propina: 0 }
  const cuentas = [
    { ...base, id: 'a', numero: 1, comensales: 2, items: [
      { productoId: 'p1', nombre: 'Parrilla', precio: 100, qty: 2, estado: 'enviado', areas: ['cocina'] },
      { productoId: 'p2', nombre: 'Gaseosa', precio: 10, qty: 2, estado: 'enviado', areas: ['barra'] },
      { productoId: 'p3', nombre: 'Anulado', precio: 50, qty: 1, estado: 'anulado', areas: ['cocina'] }],
      pagos: [{ metodo: 'qr', monto: 220, comprobante: 'comprobantes/e/x.webp' }] },
    { ...base, id: 'b', numero: 2, comensales: 1, descuento: 10, propina: 5, items: [
      { productoId: 'p1', nombre: 'Parrilla', precio: 100, qty: 1, estado: 'enviado', areas: ['cocina'] }],
      pagos: [{ metodo: 'efectivo', monto: 95 }] },
  ]
  const turno = { abiertoEn: 1000, abiertoPor: 'Ana', modo: 'compartida', fondo: 50, movimientos: [] }
  const resumen = { tickets: cuentas, ventas: { efectivo: 95, qr: 220, tarjeta: 0, otros: 0 }, ingresos: 0, egresos: 0, esperado: 145 }
  const r = R.armarReporte({ turno, resumen, config: { nombre: 'Demo', cocina: 1 }, productos: [], contado: 140, cerradoPor: 'Ana' })
  const plato = r.secciones.find(s => s.id === 'cocina'), beb = r.secciones.find(s => s.id === 'barra')
  ok(plato && plato.filas[0].nombre === 'Parrilla' && plato.filas[0].qty === 3, 'platos: Parrilla suma 3 entre cuentas')
  ok(!plato.filas.some(f => f.nombre === 'Anulado'), 'los ítems anulados no cuentan')
  ok(beb && beb.unidades === 2, 'bebidas: 2 unidades')
  ok(r.personas === 3, 'personas = 3')
  ok(r.bruto === 320 && r.descuentos === 10 && r.propinas === 5 && r.total === 315, 'totales: 320 − 10 + 5 = 315')
  ok(r.promedioPersona === 103.33, 'promedio por persona = 310 / 3')
  ok(r.diferencia === -5, 'diferencia = contado 140 − esperado 145')
  ok(r.comprobantes.length === 1, 'un comprobante QR listado')
  ok(r.porCajero === false, 'modo compartida → cierre del día')
  const t = (k, p) => (p ? `${k}${JSON.stringify(p)}` : k)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cierre-'))
  const previo = process.cwd(); process.chdir(dir)
  try {
    await R.descargarPdfCierre(r, { t, m: n => `Bs ${n}`, sb: null })
    const f = fs.readdirSync(dir).find(x => x.endsWith('.pdf'))
    ok(Boolean(f) && fs.statSync(path.join(dir, f)).size > 2000, 'el PDF se genera y pesa más de 2 KB')
    ok(f?.startsWith('cierre-dia-'), 'nombre del archivo: cierre-dia-…')
  } finally { process.chdir(previo) }
} catch (e) { console.log('✗ error', e); fallos++ } finally { await server.close() }
console.log(fallos ? `${fallos} ✗` : 'cierre: todo ✓'); process.exit(fallos ? 1 : 0)
