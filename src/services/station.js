import { sb, obtenerEmpresaActiva } from './supabaseClient.js'
import { gruposDe } from './printing.js'
import { estadoImpresora, imprimirSilencioso, generarBytes, generarTexto, reutilizarImpresoras, suscribirImpresora } from './printer.js'
import { imprimirEnWindows } from './printWindows.js'
import { imprimirPorAgente, listarImpresorasAgente } from './printAgent.js'
import { reclamarImpresion, finalizarImpresion, listarImpresion } from './printQueue.js'

const LLAVE = 'pos-estacion'
const SONDEO_MS = 3000
const SONDEO_RT_MS = 12000

const leerPref = () => { try { return { activa: false, salidas: {}, impresoras: {}, modos: {}, ...JSON.parse(localStorage.getItem(LLAVE) || '{}') } } catch { return { activa: false, salidas: {}, impresoras: {}, modos: {} } } }
const guardarPref = p => { try { localStorage.setItem(LLAVE, JSON.stringify(p)) } catch {  } }

let pref = leerPref()
let getConfig = () => ({})
let corriendo = false
let enCiclo = false
let timer = null
let canal = null
let wakeLock = null
let desuscribirSerial = null
const escuchas = new Set()
const estado = { realtime: false, error: '', ultimoCiclo: 0, impresos: 0, fallidos: 0, jobs: [], imprimiendo: '' }

const notificar = () => escuchas.forEach(f => { try { f() } catch {  } })
export const suscribirEstacion = fn => { escuchas.add(fn); return () => escuchas.delete(fn) }

const SALIDAS = ['serial', 'agente', 'windows']
export const salidaDe = grupoId => (SALIDAS.includes(pref.salidas?.[grupoId]) ? pref.salidas[grupoId] : 'serial')
export function fijarSalida(grupoId, salida) {
  pref = { ...pref, salidas: { ...pref.salidas, [grupoId]: SALIDAS.includes(salida) ? salida : 'serial' } }
  guardarPref(pref); notificar()
}

// Un grupo puede tirar en varias impresoras del agente a la vez; el valor viejo (texto suelto) sigue sirviendo.
const comoLista = v => (Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []))
export const impresorasDe = grupoId => comoLista(pref.impresoras?.[grupoId])
export function fijarImpresoras(grupoId, nombres) {
  const impresoras = { ...pref.impresoras }
  const lista = [...new Set(comoLista(nombres))]
  if (lista.length) impresoras[grupoId] = lista; else delete impresoras[grupoId]
  pref = { ...pref, impresoras }
  guardarPref(pref); notificar()
}

export async function autoConfigurarAgente(grupos = []) {
  const escritorio = typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  const nuevos = grupos.filter(g => !pref.salidas?.[g.id])
  if (!escritorio || !nuevos.length) return false
  try {
    const { predeterminada } = await listarImpresorasAgente({ fondo: true })
    if (!predeterminada) return false
    const salidas = { ...pref.salidas }
    const impresoras = { ...pref.impresoras }
    nuevos.forEach(g => { salidas[g.id] = 'agente'; impresoras[g.id] = [predeterminada] })
    pref = { ...pref, salidas, impresoras }
    guardarPref(pref); notificar()
    return true
  } catch { return false }
}

export const modoAgenteDe = grupoId => (pref.modos?.[grupoId] === 'texto' ? 'texto' : 'raw')
export function fijarModoAgente(grupoId, modo) {
  pref = { ...pref, modos: { ...pref.modos, [grupoId]: modo === 'texto' ? 'texto' : 'raw' } }
  guardarPref(pref); notificar()
}

export const estadoEstacion = () => ({ ...estado, activa: pref.activa, corriendo })

export const grupoListo = grupoId => {
  const s = salidaDe(grupoId)
  return s === 'windows' || (s === 'agente' ? impresorasDe(grupoId).length > 0 : estadoImpresora(grupoId).conectada)
}

export async function imprimirTrabajo(grupoId, payload) {
  const p = payload || {}
  const ancho = Number(p.ancho) || 32
  const corte = p.corte !== false
  const copias = Math.min(3, Math.max(1, Number(p.copias) || 1))
  const salida = salidaDe(grupoId)
  for (let i = 0; i < copias; i++) {
    if (salida === 'windows') await imprimirEnWindows({ lineas: p.lineas || [], ancho })
    else if (salida === 'agente') {
      const modo = modoAgenteDe(grupoId)
      const datos = modo === 'texto'
        ? new TextEncoder().encode(generarTexto({ lineas: p.lineas || [], ancho, corte }))
        : generarBytes({ lineas: p.lineas || [], ancho, corte, beep: Boolean(p.beep) })
      for (const nombre of impresorasDe(grupoId)) await imprimirPorAgente(nombre, datos, modo)
    }
    else await imprimirSilencioso({ grupo: grupoId, lineas: p.lineas || [], ancho, corte, beep: Boolean(p.beep) })
  }
  return salida
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
          try { await finalizarImpresion(t.id, false, String(e?.message || e || 'Error de impresión')) } catch {  }
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

export async function iniciarEstacion(obtenerConfig) {
  if (obtenerConfig) getConfig = obtenerConfig
  if (corriendo) return
  corriendo = true
  pref = { ...pref, activa: true }; guardarPref(pref)
  estado.error = ''

  try { await reutilizarImpresoras(gruposDe(getConfig()).map(g => ({ id: g.id, baud: g.baud }))) } catch {  }
  desuscribirSerial = suscribirImpresora(notificar)
  document.addEventListener('visibilitychange', alVolver)
  pedirDespierto()
  conectarRealtime()
  notificar()
  await ciclo()
  programar()
}

export function detenerEstacion({ recordar = false } = {}) {
  corriendo = false
  clearTimeout(timer); timer = null
  document.removeEventListener('visibilitychange', alVolver)
  try { desuscribirSerial?.() } catch {  }
  desuscribirSerial = null
  if (canal) { try { sb?.removeChannel(canal) } catch {  } canal = null }
  estado.realtime = false
  try { wakeLock?.release?.() } catch {  }
  wakeLock = null
  if (!recordar) { pref = { ...pref, activa: false }; guardarPref(pref) }
  notificar()
}

export const estacionRecordada = () => Boolean(leerPref().activa)
export function actualizarConfig(fn) { getConfig = fn }
