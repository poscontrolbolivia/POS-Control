// La bitácora server-side: toda acción que deja rastro tiene que sonar igual en la base,
// en el modo demo y en los tres idiomas. Se mide leyendo el SQL y el reducer, no a ojo.
import { readFileSync } from 'node:fs'

let mal = 0
const ok = (n, c) => { if (!c) { mal++; console.log('✗', n) } else console.log('✓', n) }
const R = p => readFileSync(new URL(p, import.meta.url), 'utf8')

const sql = R('../install/supabase-setup-final.sql')
const store = R('../src/context/StoreContext.jsx')
const page = R('../src/components/panel/audit/AuditPage.jsx')
const ACC = ['es', 'en', 'pt'].map(idioma => Object.keys(JSON.parse(R(`../src/i18n/locales/${idioma}.json`)))
  .filter(k => k.startsWith('auditoria.acc.')).map(k => k.slice('auditoria.acc.'.length)))

// ── Las 7 RPCs que se cobraban sin dejar fila en auditoria ──
const cuerpo = nombre => {
  const i = sql.indexOf(`create or replace function public.${nombre}(`)
  if (i < 0) return ''
  const j = sql.indexOf('create or replace function', i + 10)
  return sql.slice(i, j < 0 ? sql.length : j)
}
const ESPERADAS = {
  pre_cuenta: 'cuenta_precuenta',
  reabrir_cuenta: 'cuenta_reabierta',
  descartar_cuenta_vacia: 'cuenta_descartada',
  poner_detalle_cuenta: 'cuenta_detalle',
  abrir_para_llevar: 'cuenta_abierta',
  editar_cliente_llevar: 'llevar_edicion',
  costo_guardar: 'costo_guardado',
}
for (const [fn, accion] of Object.entries(ESPERADAS)) {
  ok(`${fn} anota ${accion} en la bitácora`, cuerpo(fn).includes(`private.auditar(v_emp, '${accion}'`))
}
ok('la bitácora nunca revierte la operación (cada RPC la envuelve en exception)',
  (sql.match(/exception when others then\n\s+null; -- una falla de la bitácora/g) || []).length >= 20)
// Una variable mal declarada dentro de ese bloque tampoco daría error visible: la bitácora simplemente dejaría de anotar.
for (const fn of Object.keys(ESPERADAS)) {
  const c = cuerpo(fn)
  const i = c.indexOf('private.auditar(v_emp')
  const bloque = c.slice(c.lastIndexOf('begin', i), i + 500)
  const declaradas = new Set([...c.matchAll(/^\s+(v_[a-z0-9_]+)\s+[a-z]/gmi)].map(m => m[1]))
  const usadas = [...new Set([...bloque.matchAll(/\b(v_[a-z0-9_]+)\b/g)].map(m => m[1]))]
  const sueltas = usadas.filter(v => !declaradas.has(v))
  ok(`${fn}: las ${usadas.length} variables de su anotación están declaradas${sueltas.length ? ` (faltan ${sueltas.join(', ')})` : ''}`, !sueltas.length)
}

// ── El trigger que anota lo que la app escribe directo por PostgREST ──
const vTrigger = (() => {
  const i = sql.indexOf('create or replace function private.auditar_fila()')
  const j = sql.indexOf('create trigger', i)
  return i < 0 ? '' : sql.slice(i, j < 0 ? sql.length : j)
})()
ok('existe la función trigger private.auditar_fila', sql.includes('create or replace function private.auditar_fila()'))
ok('el trigger es security definer (auditoria está cerrada a authenticated)',
  /private\.auditar_fila\(\)[\s\S]{0,200}security definer/.test(sql))
ok('el trigger no puede romper un guardado: toda la función tiene salida silenciosa',
  /exception when others then\n\s+-- [^\n]*\n\s+return null;/.test(vTrigger))
ok('sin usuario no hay bitácora (el instalador y los seeds no llenan la tabla)',
  vTrigger.includes('if auth.uid() is null then return null; end if;'))
ok('los triggers anidados quedan fuera (el contador de productos no genera filas)',
  vTrigger.includes('if pg_trigger_depth() > 1 then return null; end if;'))
ok('las empresas se anotan clave por clave del config, no el blob entero',
  /'config\.' \|\| k/.test(vTrigger) && vTrigger.includes(`left((v_new->'config'->k)::text, 200)`))
ok('el diff ignora las columnas que no cambió nadie',
  /and k not in \('id', 'empresa_id', 'creada_en'\)/.test(vTrigger))

const TABLAS = ['mesas', 'zonas', 'secciones_menu', 'productos', 'alertas', 'empresas']
for (const t of TABLAS) {
  const linea = (sql.match(new RegExp(`create trigger trg_bitacora_${t}[^\\n]*`)) || [''])[0]
  ok(`el trigger de ${t} cubre alta, edición y baja`,
    /after insert or update/.test(linea) && (t === 'empresas' ? /for each row/.test(linea) : /or delete/.test(linea)))
}
ok('las 6 tablas escritas por PostgREST están cubiertas',
  TABLAS.every(t => sql.includes(`on public.${t} `) || sql.includes(`on public.${t}`)) &&
  (sql.match(/create trigger trg_bitacora_/g) || []).length === 6)

// ── El trigger lee las filas como jsonb: un nombre escrito mal no da error, simplemente nunca anota ──
const columnas = tabla => {
  const i = sql.indexOf(`create table if not exists public.${tabla} (`)
  const set = new Set()
  if (i < 0) return set
  let fondo = i, profundidad = 0, j = sql.indexOf('(', i)
  for (; j < sql.length; j++) {
    if (sql[j] === '(') profundidad++
    else if (sql[j] === ')') { profundidad--; if (!profundidad) { fondo = j; break } }
  }
  for (const linea of sql.slice(i, fondo).split('\n')) {
    const m = linea.match(/^\s+([a-z_]+)\s+\S/)
    if (m && !/^(check|constraint|unique|primary|foreign)$/i.test(m[1])) set.add(m[1])
  }
  for (const a of sql.matchAll(new RegExp(`alter table public\\.${tabla}\\s+add column (?:if not exists )?([a-z_]+)`, 'g'))) set.add(a[1])
  return set
}
const DEL_TRIGGER = [...vTrigger.matchAll(/->>?\s*'([a-z_]+)'/g)].map(m => m[1])
const todasCols = new Set(TABLAS.flatMap(t => [...columnas(t)]))
const sueltas = [...new Set(DEL_TRIGGER)].filter(c => !todasCols.has(c))
ok(`el trigger solo lee columnas que existen en esas tablas (${[...new Set(DEL_TRIGGER)].length} nombres)${sueltas.length ? ` — no existen: ${sueltas.join(', ')}` : ''}`, sueltas.length === 0)
// Las que distinguen una alerta resuelta de una movida tienen que estar en SU tabla, no en cualquiera.
for (const [t, c] of [['alertas', 'resuelta_en'], ['alertas', 'mesa_id'], ['alertas', 'titulo'], ['empresas', 'config']]) {
  ok(`${t} sí tiene la columna ${c}`, columnas(t).has(c))
}
for (const t of TABLAS) ok(`${t} tiene con qué nombrar la fila en la bitácora`, columnas(t).has('nombre') || columnas(t).has('titulo'))

// ── Los caminos que ya anotan una fila de resumen no duplican por renglón ──
const SILÊNCIO = `perform set_config('pos.sin_bitacora', 'on', true);`
ok('el import de respaldo silencia el trigger (ya anota super_importo)',
  sql.slice(sql.lastIndexOf('create or replace function public.super_importar_empresa(')).includes(SILÊNCIO))
ok('el margen en masa silencia el trigger (ya anota margen_aplicado)', cuerpo('costos_margen_aplicar').includes(SILÊNCIO))
ok('retirar área silencia el trigger (ya anota area_retirada)', cuerpo('retirar_area').includes(SILÊNCIO))
ok('el trigger respeta el silenciado', vTrigger.includes(`current_setting('pos.sin_bitacora', true)`))

// ── Paridad: lo que se emite (base, trigger o demo) tiene etiqueta en los tres idiomas ──
const accionesSql = [...sql.matchAll(/private\.auditar\(\s*[^,]+,\s*'([a-z0-9_]+)'/g)].map(m => m[1])
// El trigger arma 'salon_mesa_' + 'alta|edicion|baja': se comprueban las doce combinaciones.
const prefijos = [...vTrigger.matchAll(/'(salon_mesa_|salon_zona_|menu_grupo_|menu_item_)'/g)].map(m => m[1])
const accionesTrigger = [...vTrigger.matchAll(/'(config_cambio|alta_empresa|alerta_[a-z_]+)'/g)].map(m => m[1])
  .concat(prefijos.flatMap(p => [`${p}alta`, `${p}edicion`, `${p}baja`]))
ok('el trigger compone 4 familias de 3 acciones', prefijos.length === 4 && accionesTrigger.length >= 16)
const demo = store.slice(store.indexOf('const BITACORA = {'), store.indexOf('function filasDeBitacora'))
const accionesDemo = [...demo.matchAll(/\['([a-z0-9_]+)',\s*'[a-z_]+',/g)].map(m => m[1])
// La purga por retención corre sin usuario, así que no puede llamar a private.auditar: escribe su fila directo.
const purga = /insert into public\.auditoria \([^)]*\)\s*\n\s*values \(null, null, 'purga_retencion'/.test(sql)
ok('la purga por retención deja su propia fila en la bitácora', purga)
const todas = [...new Set([...accionesSql, ...accionesTrigger, ...accionesDemo, ...(purga ? ['purga_retencion'] : [])])].sort()

for (const [i, idioma] of ['es', 'en', 'pt'].entries()) {
  const faltan = todas.filter(a => !ACC[i].includes(a))
  ok(`los ${idioma} tienen etiqueta para las ${todas.length} acciones de la bitácora${faltan.length ? ` (faltan: ${faltan.join(', ')})` : ''}`, faltan.length === 0)
}
const desfasadas = ACC[0].filter(k => !todas.includes(k))
ok(`ninguna etiqueta i18n queda huérfana${desfasadas.length ? ` (${desfasadas.join(', ')})` : ''}`, desfasadas.length === 0)
ok('es/en/pt tienen el mismo set de acciones',
  ACC[0].slice().sort().join() === ACC[1].slice().sort().join() && ACC[1].slice().sort().join() === ACC[2].slice().sort().join())
ok('sin acción demo que ya no exista en la base',
  !accionesDemo.includes('cuenta_abono') && !accionesDemo.includes('costo_guardo') && !accionesDemo.includes('comanda_envio'))

// La tabla sigue cerrada a authenticated: se lee solo por auditoria_listar, que exige admin.
ok('la lectura sigue siendo solo para admin', /auditoria_listar[\s\S]{0,900}exigir_rol\(array\['admin'\]/.test(sql))
ok('AuditPage conserva el diccionario en español de respaldo', page.includes('cuenta_precuenta: ') && page.includes('alerta_baja: '))

console.log(mal ? `\n${mal} fallo(s)` : '\ntodo OK')
process.exit(mal ? 1 : 0)
