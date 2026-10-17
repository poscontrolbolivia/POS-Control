// ESTACIÓN DE IMPRESIÓN: la PC del local (Chrome/Edge, pestaña abierta) reclama los trabajos de la
// cola de Supabase y los imprime en la impresora de cada grupo (Cocina, Barra, Caja…).
//   · salida 'serial'  → térmica USB/serie por Web Serial + ESC/POS (services/impresora.js)
//   · salida 'windows' → impresora de Windows (incluye PDFCreator); con Chrome --kiosk-printing sale sin diálogo
// Funciona como singleton a nivel de app (arranca desde PanelPage), así que sigue imprimiendo aunque se
// cambie de módulo. La preferencia (activa + salida por grupo) vive en localStorage de ESE equipo.
// Aviso inmediato por Supabase Realtime + consulta cada pocos segundos como respaldo.
import { sb, obtenerEmpresaActiva } from './supabase.js'
import { gruposDe } from './impresion.js'
import { estadoImpresora, imprimirSilencioso, reutilizarImpresoras, suscribirImpresora } from './impresora.js'
import { imprimirEnWindows } from './impresionWindows.js'
import { reclamarImpresion, finalizarImpresion, listarImpresion } from './colaImpresion.js'

const LLAVE = 'pos-estacion'
const SONDEO_MS = 3000          // sin Realtime
const SONDEO_RT_MS = 12000      // con Realtime conectado (solo respaldo)

const leerPref = () => { try { return { activa: false, salidas: {}, ...JSON.parse(localStorage.getItem(LLAVE) || '{}') } } catch { return { activa: false, salidas: {} } } }
const guardarPref = p => { try { localStorage.setItem(LLAVE, JSON.stringify(p)) } catch { /* sin almacenamiento */ } }

let pref = leerPref()
let getConfig = () => ({})
let corriendo = false       // el bucle está en marcha
let enCiclo = false
let timer = null
let canal = null
let wakeLock = null
let desuscribirSerial = null
const escuchas = new Set()
const estado = { realtime: false, error: '', ultimoCiclo: 0, impresos: 0, fallidos: 0, jobs: [], imprimiendo: '' }

const notificar = () => escuchas.forEach(f => { try { f() } catch { /* ignore */ } })
export const suscribirEstacion = fn => { escuchas.add(fn); return () => escuchas.delete(fn) }

export const salidaDe = grupoId => (pref.salidas?.[grupoId] === 'windows' ? 'windows' : 'serial')
export function fijarSalida(grupoId, salida) {
  pref = { ...pref, salidas: { ...pref.salidas, [grupoId]: salida === 'windows' ? 'windows' : 'serial' } }
  guardarPref(pref); notificar()
}

export const estadoEstacion = () => ({ ...estado, activa: pref.activa, corriendo })

/** ¿Este grupo puede imprimir ahora en esta PC? */
export const grupoListo = grupoId => salidaDe(grupoId) === 'windows' || estadoImpresora(grupoId).conectada

/** Imprime un trabajo {lineas, ancho, corte, beep} por la salida configurada del grupo. */
export async function imprimirTrabajo(grupoId, payload) {
  const p = payload || {}
  const ancho = Number(p.ancho) || 32
  if (salidaDe(grupoId) === 'windows') return imprimirEnWindows({ lineas: p.lineas || [], ancho })
  return imprimirSilencioso({ grupo: grupoId, lineas: p.lineas || [], ancho, corte: p.corte !== false, beep: Boolean(p.beep) })
}

async function pedirDespierto() {
  try {
    if (navigator.wakeLock && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener?.('release', () => { wakeLock = null })
    }
  } catch { wakeLock = null }
}
const alVolver = () => { if (document.visibilityState === 'visible') { pedirDespierto(); ciclo() } }

async function ciclo() {
  if (!corriendo || enCiclo) return
  enCiclo = true
  try {
    const grupos = gruposDe(getConfig())
    const listos = grupos.map(g => g.id).filter(grupoListo)
    if (listos.length) {
      const trabajos = await reclamarImpresion(listos, 8)
      for (const t of Array.isArray(trabajos) ? trabajos : []) {
        estado.imprimiendo = t.titulo || t.grupo
        notificar()
        try {
          await imprimirTrabajo(t.grupo, t.payload)
          await finalizarImpresion(t.id, true)
          estado.impresos++
        } catch (e) {
          estado.fallidos++
          try { await finalizarImpresion(t.id, false, String(e?.message || e || 'Error de impresión')) } catch { /* se recupera por tiempo */ }
        }
      }
    }
    estado.imprimiendo = ''
    estado.jobs = await listarImpresion(30)
    estado.error = ''
    estado.ultimoCiclo = Date.now()
  } catch (e) {
    estado.error = String(e?.message || e || 'Error de conexión')
  } finally {
    enCiclo = false
    notificar()
  }
}

/** Refresca solo la lista (para la pantalla), sin imprimir. */
export async function refrescarLista() {
  try { estado.jobs = await listarImpresion(30); estado.error = ''; notificar() } catch (e) { estado.error = String(e?.message || e); notificar() }
}
export const dispararCiclo = () => { ciclo() }

function programar() {
  clearTimeout(timer)
  if (!corriendo) return
  timer = setTimeout(async () => { await ciclo(); programar() }, estado.realtime ? SONDEO_RT_MS : SONDEO_MS)
}

function conectarRealtime() {
  const empresaId = obtenerEmpresaActiva()
  if (!sb || !empresaId) return
  try {
    canal = sb.channel('impresion-' + empresaId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trabajos_impresion', filter: `empresa_id=eq.${empresaId}` }, () => ciclo())
      .subscribe(st => {
        const ok = st === 'SUBSCRIBED'
        if (ok !== estado.realtime) { estado.realtime = ok; notificar(); programar() }
      })
  } catch { estado.realtime = false }
}

/** Enciende el bucle. `config`: función que devuelve la config vigente de la empresa (grupos, etc.). */
export async function iniciarEstacion(obtenerConfig) {
  if (obtenerConfig) getConfig = obtenerConfig
  if (corriendo) return
  corriendo = true
  pref = { ...pref, activa: true }; guardarPref(pref)
  estado.error = ''
  // Reasigna las impresoras USB ya autorizadas antes (sin pedir permiso otra vez).
  try { await reutilizarImpresoras(gruposDe(getConfig()).map(g => ({ id: g.id, baud: g.baud }))) } catch { /* ignore */ }
  desuscribirSerial = suscribirImpresora(notificar)
  document.addEventListener('visibilitychange', alVolver)
  pedirDespierto()
  conectarRealtime()
  notificar()
  await ciclo()
  programar()
}

/** Apaga el bucle. `recordar:false` (acción del usuario) también apaga el autoarranque. */
export function detenerEstacion({ recordar = false } = {}) {
  corriendo = false
  clearTimeout(timer); timer = null
  document.removeEventListener('visibilitychange', alVolver)
  try { desuscribirSerial?.() } catch { /* ignore */ }
  desuscribirSerial = null
  if (canal) { try { sb?.removeChannel(canal) } catch { /* ignore */ } canal = null }
  estado.realtime = false
  try { wakeLock?.release?.() } catch { /* ignore */ }
  wakeLock = null
  if (!recordar) { pref = { ...pref, activa: false }; guardarPref(pref) }
  notificar()
}

/** Para PanelPage: arranca solo si esta PC quedó configurada como estación. */
export const estacionRecordada = () => Boolean(leerPref().activa)
export function actualizarConfig(fn) { getConfig = fn }
