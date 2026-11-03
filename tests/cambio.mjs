import assert from 'node:assert/strict'
import { imputarPagos, cobroInvalido } from '../src/services/cobro.js'
import { camposComanda } from '../src/services/comanda.js'
import { mostradorPendientes } from '../src/services/despacho.js'

const tr = k => k
const suma = (pagos, met) => pagos.filter(p => p.metodo === met).reduce((a, p) => a + p.monto, 0)

// Un solo pago en efectivo de más: a la caja entra solo el total; lo demás es cambio.
{
  const r = imputarPagos([{ metodo: 'efectivo', monto: '200' }], 120)
  assert.equal(r.cambio, 80)
  assert.equal(suma(r.pagos, 'efectivo'), 120, 'la caja anota el total, no lo recibido')
  assert.equal(r.pagos[0].recibido, 200)
  assert.equal(r.saldo, 0)
}

// Efectivo escrito primero + QR: el cajón debe anotar solo lo que queda de verdad (120 - 50 = 70) y devolver 30.
{
  const r = imputarPagos([{ metodo: 'efectivo', monto: '100' }, { metodo: 'qr', monto: '50' }], 120)
  assert.equal(r.cambio, 30)
  assert.equal(suma(r.pagos, 'efectivo'), 70, 'el efectivo anotado ya descuenta el cambio')
  assert.equal(suma(r.pagos, 'qr'), 50)
  assert.equal(r.pagos.reduce((a, p) => a + p.monto, 0), 120, 'lo anotado suma exactamente el total')
  assert.equal(r.excedente, 0)
}

// Mismo cobro con las líneas al revés: mismo resultado.
{
  const r = imputarPagos([{ metodo: 'qr', monto: '50' }, { metodo: 'efectivo', monto: '100' }], 120)
  assert.equal(r.cambio, 30)
  assert.equal(suma(r.pagos, 'efectivo'), 70)
}

// Dos pagos en efectivo.
{
  const r = imputarPagos([{ metodo: 'efectivo', monto: '50' }, { metodo: 'efectivo', monto: '100' }], 120)
  assert.equal(r.cambio, 30)
  assert.equal(suma(r.pagos, 'efectivo'), 120)
}

// Pago justo: sin cambio. Pago corto: queda saldo.
assert.equal(imputarPagos([{ metodo: 'efectivo', monto: '120' }], 120).cambio, 0)
assert.equal(imputarPagos([{ metodo: 'efectivo', monto: '100' }], 120).saldo, 20)

// QR o tarjeta de más no se pueden devolver: se rechaza el cobro.
{
  const r = imputarPagos([{ metodo: 'qr', monto: '150' }], 120)
  assert.equal(r.excedente, 30)
  assert.equal(r.cambio, 0)
  assert.equal(suma(r.pagos, 'qr'), 120)
  assert.equal(cobroInvalido([{ metodo: 'qr', monto: '150' }], tr, 120), 'venta.sobraNoEfectivo')
  assert.equal(cobroInvalido([{ metodo: 'qr', monto: '120' }], tr, 120), '')
  assert.equal(cobroInvalido([{ metodo: 'efectivo', monto: '500' }], tr, 120), '', 'efectivo de más es cambio, no error')
}

// Cuenta por cobrar sin trabajador sigue sin poder cobrarse.
assert.equal(cobroInvalido([{ metodo: 'cxc', monto: '10' }], tr), 'venta.cxcElegir')

// Comanda: cliente y teléfono van justo después de la mesa y solo si existen.
{
  const claves = campos => campos.map(c => c.clave)
  assert.deepEqual(claves(camposComanda({ salon: 'Para llevar', mesa: 'Mostrador', cliente: 'Elsa', telefono: '712', enviadoPor: 'ana', en: 1 })),
    ['comanda.salon', 'comanda.mesa', 'comanda.cliente', 'comanda.telefono', 'comanda.enviado', 'comanda.hora'])
  assert.deepEqual(claves(camposComanda({ salon: 'Mostrador', mesa: '#3', enviadoPor: 'ana', en: 1 })),
    ['comanda.salon', 'comanda.mesa', 'comanda.enviado', 'comanda.hora'])
}

// Despacho: la venta del mostrador ya cobrada conserva nombre y teléfono del cliente.
{
  const f = mostradorPendientes([{ id: 'c1', tipo: 'directa', canal: 'mostrador', numero: 7, estado: 'cerrada', cerradaEn: 5,
    clienteNombre: 'Elsa', clienteTel: '71234567', items: [{ id: 'i1', nombre: 'Pollo', qty: 1, estado: 'enviado' }] }])
  assert.equal(f[0].cliente, 'Elsa')
  assert.equal(f[0].cliente_tel, '71234567')
}

console.log('✓ cambio de caja, comanda con cliente y Despacho')
