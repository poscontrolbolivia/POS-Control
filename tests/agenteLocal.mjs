// Chrome restringe las peticiones a la red local: la app debe declarar el espacio de direcciones y no
// insistir cuando el agente no está (celulares, PC sin agente).
let fallos = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fallos++ }
const mem = {}
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }, removeItem: k => { delete mem[k] } }
const llamadas = []
let responder = () => { throw new TypeError('Failed to fetch') }
globalThis.fetch = async (url, op) => { llamadas.push({ url, op }); return responder() }
const A = await import('../src/services/printAgent.js')

// PC de escritorio
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' }, configurable: true })
await A.estadoAgente().catch(() => {})
ok(llamadas[0]?.op.targetAddressSpace === 'loopback', 'agente en 127.0.0.1 → targetAddressSpace: loopback')
const antes = llamadas.length
await A.estadoAgente({ fondo: true }).catch(() => {})
await A.listarImpresorasAgente({ fondo: true }).catch(() => {})
ok(llamadas.length === antes, 'tras un fallo, las consultas de fondo no repiten durante 1 minuto')
await A.estadoAgente().catch(() => {})
ok(llamadas.length === antes + 1, 'una consulta pedida por el usuario sí se intenta')
A.reiniciarFalloAgente()
responder = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
await A.estadoAgente({ fondo: true })
ok(llamadas.length === antes + 2, 'si el agente responde, vuelve a consultar')
A.fijarUrlAgente('http://192.168.1.50:9101')
await A.estadoAgente()
ok(llamadas.at(-1).op.targetAddressSpace === 'local', 'agente en la red del local → targetAddressSpace: local')
A.fijarUrlAgente('https://agente.ejemplo.com')
await A.estadoAgente()
ok(!('targetAddressSpace' in llamadas.at(-1).op), 'dirección pública: sin targetAddressSpace')

// Celular sin agente configurado: ni una petición
A.fijarUrlAgente('')
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }, configurable: true })
const n = llamadas.length
await A.estadoAgente().then(() => ok(false, 'el celular no debía consultar'), () => ok(llamadas.length === n, 'celular con la dirección por defecto: no hace ninguna petición'))
console.log(fallos ? `${fallos} ✗` : 'agenteLocal: todo ✓'); process.exit(fallos ? 1 : 0)
