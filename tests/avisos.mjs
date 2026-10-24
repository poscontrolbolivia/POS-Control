import assert from 'node:assert/strict'
import { debeAvisar } from '../src/services/avisos.js'

const ana = { rol: 'mesero', miId: 'u-ana', miNombre: 'ana' }
const luis = { rol: 'mesero', miId: 'u-luis', miNombre: 'luis' }
const caja = { rol: 'cajero', miId: 'u-caja', miNombre: 'caja' }
const cocina = { rol: 'cocina', misAreas: [] }
const barra = { rol: 'barra', misAreas: ['barra'] }
const admin = { rol: 'admin', miId: 'u-ana' }
const sup = { rol: 'admin', esSuper: true, miId: 'u-ana' }
const cuentaAna = { abiertaPorId: 'u-ana', abiertaPor: 'Ana' }

// Mesero: solo lo suyo
assert.equal(debeAvisar(ana, { tipo: 'listo', cuenta: cuentaAna }), true)
assert.equal(debeAvisar(luis, { tipo: 'listo', cuenta: cuentaAna }), false)
assert.equal(debeAvisar(ana, { tipo: 'cobrada', cuenta: { ...cuentaAna, cerradaPorId: 'u-caja' } }), true)
assert.equal(debeAvisar(luis, { tipo: 'cobrada', cuenta: { ...cuentaAna, cerradaPorId: 'u-caja' } }), false)
assert.equal(debeAvisar(ana, { tipo: 'porCobrar' }), false)
assert.equal(debeAvisar(ana, { tipo: 'comanda', areas: ['cocina'] }), false)
// No se avisa a quien cobró
assert.equal(debeAvisar({ ...ana, miId: 'u-ana' }, { tipo: 'cobrada', cuenta: { ...cuentaAna, cerradaPorId: 'u-ana' } }), false)
// Cajero: por cobrar sí; cobrada de otros no
assert.equal(debeAvisar(caja, { tipo: 'porCobrar' }), true)
assert.equal(debeAvisar(caja, { tipo: 'cobrada', cuenta: cuentaAna }), false)
assert.equal(debeAvisar(caja, { tipo: 'listo', cuenta: { abiertaPorId: 'u-caja' } }), true)
// Cocina y barra: solo sus áreas, nada de cuentas
assert.equal(debeAvisar(cocina, { tipo: 'comanda', areas: ['cocina'] }), true)
assert.equal(debeAvisar(cocina, { tipo: 'comanda', areas: ['barra'] }), true) // sin áreas asignadas ve todo
assert.equal(debeAvisar(barra, { tipo: 'comanda', areas: ['cocina'] }), false)
assert.equal(debeAvisar(barra, { tipo: 'comanda', areas: ['cocina', 'barra'] }), true)
assert.equal(debeAvisar(cocina, { tipo: 'porCobrar' }), false)
assert.equal(debeAvisar(cocina, { tipo: 'cobrada', cuenta: cuentaAna }), false)
assert.equal(debeAvisar(cocina, { tipo: 'listo', cuenta: cuentaAna }), false)
// Supervisores y súper admin: nada
for (const q of [admin, sup]) for (const tipo of ['comanda', 'porCobrar', 'listo', 'cobrada']) assert.equal(debeAvisar(q, { tipo, cuenta: cuentaAna, areas: ['cocina'] }), false)
// Sin sesión
assert.equal(debeAvisar(null, { tipo: 'porCobrar' }), false)
// Respaldo por nombre cuando no hay id
assert.equal(debeAvisar({ rol: 'mesero', miNombre: 'ana' }, { tipo: 'listo', cuenta: { abiertaPor: 'Ana' } }), true)
assert.equal(debeAvisar({ rol: 'mesero', miNombre: 'ana' }, { tipo: 'listo', cuenta: { abiertaPor: 'Luis' } }), false)
console.log('✓ avisos: reglas por rol')
