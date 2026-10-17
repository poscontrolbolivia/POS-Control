// Prueba de AISLAMIENTO entre empresas (RLS, RPC, Storage y Realtime) contra tu Supabase real.
//
// Uso (Node 22+). Crea ANTES dos negocios de PRUEBA desde la app con «Crear mi negocio»
// (dos correos distintos; cada uno queda como admin de su empresa). NO uses cuentas reales:
// el script intenta leer, insertar, modificar y borrar datos de la otra empresa.
//
//   A_EMAIL=a@prueba.com A_PASS=clave123 B_EMAIL=b@prueba.com B_PASS=clave123 npm run test:aislamiento
//
// Resultado: ✓ (bien) / ✗ (FALLO de aislamiento) / ℹ (nota). Sale con código 1 si hay algún ✗.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/config.js'

const { A_EMAIL, A_PASS, B_EMAIL, B_PASS } = process.env
if (!A_EMAIL || !A_PASS || !B_EMAIL || !B_PASS) {
  console.error('Faltan A_EMAIL, A_PASS, B_EMAIL, B_PASS (dos negocios de PRUEBA). Ver el encabezado de tests/aislamiento.mjs')
  process.exit(2)
}

const nuevo = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const espera = ms => new Promise(r => setTimeout(r, ms))
let fallos = 0
const ok = (nombre, bien, detalle = '') => { if (!bien) fallos++; console.log(`${bien ? '✓' : '✗'} ${nombre}${detalle ? ' — ' + detalle : ''}`) }
const info = txt => console.log(`ℹ ${txt}`)

async function entrar(email, pass) {
  const sb = nuevo()
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass })
  if (error) throw new Error(`No se pudo entrar con ${email}: ${error.message}`)
  const { data: m, error: e2 } = await sb.from('membresias').select('empresa_id, rol').eq('user_id', data.user.id)
  if (e2) throw new Error(e2.message)
  if (!m || m.length !== 1) throw new Error(`${email} debe pertenecer a UNA sola empresa (tiene ${m?.length ?? 0})`)
  return { sb, userId: data.user.id, empresa: m[0].empresa_id, rol: m[0].rol }
}

const TABLAS = ['zonas', 'mesas', 'secciones_menu', 'productos', 'cuentas', 'cuenta_items', 'cuenta_mesas', 'pagos', 'turnos_caja', 'trabajos_impresion', 'membresias']

const A = await entrar(A_EMAIL, A_PASS)
const B = await entrar(B_EMAIL, B_PASS)
if (A.empresa === B.empresa) { console.error('A y B son la MISMA empresa: crea dos negocios distintos.'); process.exit(2) }
if (B.rol !== 'admin') { console.error('B debe ser admin de su empresa (cuenta creada con «Crear mi negocio»).'); process.exit(2) }
info(`Empresa A = ${A.empresa} · Empresa B = ${B.empresa}`)

// ── datos de B para atacar ──
const zB = await B.sb.from('zonas').insert({ empresa_id: B.empresa, nombre: 'AISL-B', orden: 99 }).select().single()
const pB = await B.sb.from('productos').insert({ empresa_id: B.empresa, nombre: 'AISL-B-prod', precio: 1 }).select().single()
if (zB.error || pB.error) { console.error('B no pudo crear sus datos de prueba:', zB.error?.message || pB.error?.message); process.exit(2) }
const idZonaB = zB.data.id, idProdB = pB.data.id
const rutaB = `productos/${B.empresa}/${randomUUID()}.webp`
const subB = await B.sb.storage.from('pos-imagenes').upload(rutaB, new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' }), { contentType: 'image/webp' })
if (subB.error) info(`B no pudo subir su imagen de prueba (${subB.error.message}); se omiten las pruebas de imágenes con archivo real`)

try {
  // 1-2. Lecturas
  for (const t of TABLAS) {
    const { data, error } = await A.sb.from(t).select('empresa_id')
    const ajenas = (data || []).filter(r => r.empresa_id !== A.empresa).length
    ok(`A lee ${t}: solo filas de su empresa`, !error && ajenas === 0, error ? error.message : `${data.length} filas, ${ajenas} ajenas`)
    const b = await A.sb.from(t).select('empresa_id').eq('empresa_id', B.empresa)
    ok(`A pide ${t} de la empresa B: 0 filas`, (b.data || []).length === 0, b.error?.message || '')
  }
  const emp = await A.sb.from('empresas').select('id')
  ok('A solo ve su propia fila en empresas', !emp.error && emp.data.every(e => e.id === A.empresa) && emp.data.length === 1)
  const mA = await A.sb.from('membresias').select('user_id')
  const per = await A.sb.from('perfiles').select('user_id')
  const permitidos = new Set((mA.data || []).map(x => x.user_id))
  ok('A no ve perfiles de gente de otra empresa', (per.data || []).every(p => permitidos.has(p.user_id) || p.user_id === A.userId) && !(per.data || []).some(p => p.user_id === B.userId))

  // 3. Escrituras
  const i1 = await A.sb.from('zonas').insert({ empresa_id: B.empresa, nombre: 'HACK', orden: 1 })
  ok('A no puede INSERTAR una zona en la empresa B', !!i1.error, i1.error?.message || 'se insertó (¡grave!)')
  const i2 = await A.sb.from('productos').insert({ empresa_id: B.empresa, nombre: 'HACK', precio: 1 })
  ok('A no puede INSERTAR un producto en la empresa B', !!i2.error, i2.error?.message || 'se insertó (¡grave!)')
  const u = await A.sb.from('zonas').update({ nombre: 'HACK' }).eq('id', idZonaB).select()
  const vz = await B.sb.from('zonas').select('nombre').eq('id', idZonaB).single()
  ok('A no puede MODIFICAR una zona de B', (u.data || []).length === 0 && vz.data?.nombre === 'AISL-B', `nombre ahora: ${vz.data?.nombre}`)
  const d = await A.sb.from('productos').delete().eq('id', idProdB).select()
  const vp = await B.sb.from('productos').select('id').eq('id', idProdB)
  ok('A no puede BORRAR un producto de B', (d.data || []).length === 0 && (vp.data || []).length === 1)

  // 4. RPC
  const r1 = await A.sb.rpc('fijar_empresa', { p_empresa: B.empresa })
  ok('A no puede «fijar» la empresa B (fijar_empresa)', !!r1.error, r1.error?.message || 'aceptó (revisar)')
  const r2 = await A.sb.rpc('mi_plan', { p_empresa_id: B.empresa })
  ok('A no puede usar RPC con p_empresa_id = B (mi_plan)', !!r2.error, r2.error?.message || 'respondió (revisar)')
  const r3 = await A.sb.rpc('exportar_mi_empresa', { p_empresa_id: B.empresa })
  ok('A no puede exportar los datos de B', !!r3.error || !r3.data, r3.error?.message || 'devolvió datos (¡grave!)')
  const r4 = await A.sb.rpc('super_exportar_empresa', { p_empresa: B.empresa })
  ok('A no puede usar super_exportar_empresa', !!r4.error, r4.error?.message || 'devolvió datos (¡grave!)')
  const r5 = await A.sb.rpc('super_listar_empresas')
  ok('A no puede listar todas las empresas (super_listar_empresas)', !!r5.error || (Array.isArray(r5.data) && r5.data.length <= 1), r5.error?.message || '')
  const r6 = await A.sb.rpc('super_purgar_ahora')
  ok('A no puede ejecutar la purga (super_purgar_ahora)', !!r6.error, r6.error?.message || 'se ejecutó (¡grave!)')

  // 5. Sin sesión
  const an = nuevo()
  for (const t of ['productos', 'cuentas', 'zonas', 'empresas', 'membresias', 'perfiles']) {
    const x = await an.from(t).select('*').limit(5)
    ok(`Sin sesión no se lee ${t}`, !!x.error || (x.data || []).length === 0, x.error?.message || '0 filas')
  }
  const x2 = await an.rpc('exportar_mi_empresa', { p_empresa_id: B.empresa })
  ok('Sin sesión no se exporta nada', !!x2.error)
  const lista = await an.rpc('empresas_para_login')
  info(`Lista pública del login (a propósito): ${lista.error ? 'error ' + lista.error.message : (lista.data || []).length + ' empresas con código y nombre visibles sin sesión'}`)

  // 6. Storage
  if (!subB.error) {
    const rutaA = `productos/${B.empresa}/${randomUUID()}.webp`
    const s1 = await A.sb.storage.from('pos-imagenes').upload(rutaA, new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'image/webp' }), { contentType: 'image/webp' })
    ok('A no puede SUBIR una imagen a la carpeta de B', !!s1.error, s1.error?.message || 'se subió (¡grave!)')
    if (!s1.error) await B.sb.storage.from('pos-imagenes').remove([rutaA])
    const l = await A.sb.storage.from('pos-imagenes').list(`productos/${B.empresa}`)
    ok('A no puede LISTAR la carpeta de B', !!l.error || (l.data || []).length === 0, l.error?.message || `${(l.data || []).length} archivos`)
    const rm = await A.sb.storage.from('pos-imagenes').remove([rutaB])
    const sigue = await B.sb.storage.from('pos-imagenes').list(`productos/${B.empresa}`)
    ok('A no puede BORRAR una imagen de B', (sigue.data || []).some(f => rutaB.endsWith(f.name)), rm.error?.message || '')
    const pub = await fetch(`${SUPABASE_URL}/storage/v1/object/public/pos-imagenes/${rutaB}`)
    info(`El bucket es PÚBLICO: abrir la URL exacta de una imagen ${pub.ok ? 'funciona sin sesión' : 'no funcionó'} (los nombres son UUID no adivinables; si quieres imágenes privadas hay que pasar a URLs firmadas).`)
  }

  // 7. Realtime: A no debe recibir cambios de B
  const vistos = []
  const canal = A.sb.channel('aislamiento-test').on('postgres_changes', { event: '*', schema: 'public', table: 'zonas' }, p => vistos.push(p.new?.empresa_id ?? p.old?.empresa_id))
  const estado = await new Promise(res => { const t = setTimeout(() => res('TIMEOUT'), 8000); canal.subscribe(s => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(s)) { clearTimeout(t); res(s) } }) })
  if (estado !== 'SUBSCRIBED') info(`Realtime no se pudo suscribir (${estado}); prueba omitida`)
  else {
    const z2 = await B.sb.from('zonas').insert({ empresa_id: B.empresa, nombre: 'AISL-RT', orden: 98 }).select().single()
    await espera(4000)
    ok('A no recibe por Realtime los cambios de B', !vistos.includes(B.empresa), `${vistos.length} eventos recibidos`)
    info('Si la tabla zonas no está en la publicación realtime de Supabase, esta prueba no demuestra nada (no llegaría ningún evento).')
    if (z2.data) await B.sb.from('zonas').delete().eq('id', z2.data.id)
  }
  await A.sb.removeChannel(canal)
} finally {
  await B.sb.from('zonas').delete().eq('id', idZonaB)
  await B.sb.from('productos').delete().eq('id', idProdB)
  if (!subB.error) await B.sb.storage.from('pos-imagenes').remove([rutaB])
}

console.log(fallos ? `\n✗ ${fallos} FALLO(S) de aislamiento: NO publiques hasta corregirlos.` : '\n✓ Aislamiento correcto en todas las pruebas ejecutadas.')
process.exit(fallos ? 1 : 0)
