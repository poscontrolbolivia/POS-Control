// Prueba de los LÍMITES del plan Básico contra tu Supabase real.
// Necesita UN negocio de PRUEBA recién creado (plan Básico: 3 personas, 20 artículos) y, para la
// parte del super, una cuenta super (crear_super). NO uses una empresa real: crea filas y usuarios.
//
//   A_EMAIL=a@prueba.com A_PASS=clave123 npm run test:cuotas
//   (opcional) SUPER_EMAIL=... SUPER_PASS=...   → prueba también Premium y entrar sin membresía
//
// Sale con código 1 si hay algún ✗.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/config.js'

const { A_EMAIL, A_PASS, SUPER_EMAIL, SUPER_PASS } = process.env
if (!A_EMAIL || !A_PASS) { console.error('Faltan A_EMAIL y A_PASS (negocio de PRUEBA, admin).'); process.exit(2) }
const nuevo = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
let fallos = 0
const ok = (n, bien, d = '') => { if (!bien) fallos++; console.log(`${bien ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`) }
const login = async (e, p) => { const sb = nuevo(); const { data, error } = await sb.auth.signInWithPassword({ email: e, password: p }); if (error) throw new Error(`${e}: ${error.message}`); return { sb, uid: data.user.id } }

const A = await login(A_EMAIL, A_PASS)
const { data: memb } = await A.sb.from('membresias').select('empresa_id, rol').eq('user_id', A.uid)
if (!memb || memb.length !== 1 || memb[0].rol !== 'admin') { console.error('A debe ser admin de UNA sola empresa.'); process.exit(2) }
const emp = memb[0].empresa_id

// 1. La cuota no es legible por el comercio
const lim = await A.sb.from('limites').select('*')
ok('A no puede leer public.limites', !!lim.error || (lim.data || []).length === 0, lim.error?.message || `${(lim.data || []).length} filas`)
const plan = await A.sb.rpc('mi_plan', { p_empresa_id: emp })
ok('mi_plan() no revela max_productos ni max_miembros', !plan.error && !('max_productos' in (plan.data || {})) && !('max_miembros' in (plan.data || {})), plan.error?.message || JSON.stringify(plan.data))

// 2. Tope de personas (3 en total, el admin cuenta): se pueden invitar 2, la 3ª falla
const sufijo = randomUUID().slice(0, 8)
const invitar = n => A.sb.rpc('equipo_invitar', { p_nombre: `Cuota ${n}`, p_correo: `cuota-${sufijo}-${n}@prueba.invalid`, p_rol: 'mesero', p_clave: 'clave1234' })
const { data: antes } = await A.sb.rpc('equipo_listar')
const hueco = Math.max(0, 3 - (antes || []).length)
for (let i = 1; i <= hueco; i++) { const r = await invitar(i); ok(`invitar #${i} dentro del cupo`, !r.error, r.error?.message || '') }
const extra = await invitar(99)
ok('invitar por encima del cupo se rechaza', !!extra.error && extra.error.code === '22000', extra.error ? `${extra.error.code}: ${extra.error.message}` : 'NO falló')
ok('el aviso no contiene números', !!extra.error && !/\d/.test(extra.error.message), extra.error?.message || '')

// 3. Tope de artículos (20)
const creados = []
let primeroFallo = null
for (let i = 1; i <= 25 && !primeroFallo; i++) {
  const r = await A.sb.from('productos').insert({ empresa_id: emp, nombre: `CUOTA-${sufijo}-${i}`, precio: 1 }).select('id').single()
  if (r.error) primeroFallo = { i, e: r.error } ; else creados.push(r.data.id)
}
ok('el catálogo se frena (≤ 20 activos en total)', !!primeroFallo && primeroFallo.e.code === '22000', primeroFallo ? `falló al crear el #${primeroFallo.i}: ${primeroFallo.e.message}` : 'NO se frenó en 25')
if (creados.length) await A.sb.from('productos').delete().in('id', creados)

// 4. Super: Premium sin límite y entrar sin membresía
if (SUPER_EMAIL && SUPER_PASS) {
  const S = await login(SUPER_EMAIL, SUPER_PASS)
  const es = await S.sb.rpc('es_super'); ok('el super es super', es.data === true, es.error?.message || '')
  const prem = await S.sb.rpc('super_cambiar_plan', { p_empresa: emp, p_plan: 'pago' }); ok('super pasa la empresa a Premium', !prem.error, prem.error?.message || '')
  const r = await invitar(100); ok('con Premium el equipo ya no tiene tope', !r.error, r.error?.message || '')
  const fij = await S.sb.rpc('fijar_empresa', { p_empresa: emp }); ok('super fija una empresa de la que NO es miembro', !fij.error, fij.error?.message || '')
  const vuelta = await S.sb.rpc('super_cambiar_plan', { p_empresa: emp, p_plan: 'gratis' }); ok('super devuelve la empresa a Básico', !vuelta.error, vuelta.error?.message || '')
  const clase = await A.sb.rpc('super_cambiar_plan', { p_empresa: emp, p_plan: 'pago' }); ok('un admin NO puede subirse de plan', !!clase.error, clase.error?.message || 'NO falló')
} else console.log('ℹ Sin SUPER_EMAIL/SUPER_PASS: se omite la parte del super.')

console.log(fallos ? `\n✗ ${fallos} fallo(s)` : '\n✓ todo bien')
process.exit(fallos ? 1 : 0)
