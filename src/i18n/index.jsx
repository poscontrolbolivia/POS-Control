import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import es from './locales/es.json'

// Español va en el paquete principal (es el idioma de respaldo). Inglés y portugués se descargan solo
// cuando alguien los usa: el arranque baja unos 200 kB y el service worker los guarda para después.
const CARGADORES = {
  en: () => import('./locales/en.json'),
  pt: () => import('./locales/pt.json'),
}
const DICCIONARIOS = { es }
const enCarga = {}

function cargarIdioma(id) {
  if (DICCIONARIOS[id]) return Promise.resolve()
  if (!CARGADORES[id]) return Promise.reject(new Error('idioma desconocido'))
  if (!enCarga[id]) {
    enCarga[id] = CARGADORES[id]()
      .then(m => { DICCIONARIOS[id] = m.default })
      .finally(() => { delete enCarga[id] })
  }
  return enCarga[id]
}
const IDIOMAS = ['es', 'en', 'pt']
const IDIOMA_DEFECTO = 'es'

const CLAVE_STORAGE = 'pos-idioma-app'

export const IDIOMAS_INFO = [
  { codigo: 'es', nombre: 'Español', corto: 'ES' },
  { codigo: 'en', nombre: 'English', corto: 'EN' },
  { codigo: 'pt', nombre: 'Português', corto: 'PT' },
]

let idiomaActual = leerPreferencia()
// Si la preferencia es en/pt, la descarga arranca ya, en paralelo con el resto de la app.
if (idiomaActual !== IDIOMA_DEFECTO) cargarIdioma(idiomaActual).catch(() => {})

function normalizarIdioma(v) {
  return IDIOMAS.includes(v) ? v : IDIOMA_DEFECTO
}

function leerPreferenciaCruda() {
  try {
    const v = localStorage.getItem(CLAVE_STORAGE)
    return v === null ? null : normalizarIdioma(v)
  } catch {
    return null
  }
}

function leerPreferencia() {
  if (leerPreferenciaCruda() !== null) return leerPreferenciaCruda()

  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : '').slice(0, 2).toLowerCase()
  return IDIOMAS.includes(nav) ? nav : IDIOMA_DEFECTO
}

function escribirPreferencia(idioma) {
  try { localStorage.setItem(CLAVE_STORAGE, idioma) } catch {  }
}

function interpolar(texto, params) {
  if (!params || typeof texto !== 'string') return texto
  return texto.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])))
}

function traducirEn(idioma, clave, params) {
  const txt = DICCIONARIOS[idioma] && DICCIONARIOS[idioma][clave]
  if (typeof txt === 'string') return interpolar(txt, params)
  const enEs = es[clave]
  if (typeof enEs === 'string') return interpolar(enEs, params)
  return String(clave ?? '')
}

export function existeClave(clave) {
  return typeof es[clave] === 'string'
}

export function tGlobal(clave, params) {
  return traducirEn(idiomaActual, clave, params)
}

export const idiomaActivo = () => idiomaActual

const Ctx = createContext(null)

export function IdiomaProvider({ children }) {
  const [idiom, setIdiom] = useState(leerPreferencia)
  // Idioma que se ve: cambia solo cuando su diccionario ya llegó, así no hay parpadeo en español.
  const [visible, setVisible] = useState(() => (DICCIONARIOS[idiom] ? idiom : null))

  useEffect(() => {
    let vivo = true
    escribirPreferencia(idiom)
    const aplicar = () => { if (vivo) setVisible(DICCIONARIOS[idiom] ? idiom : IDIOMA_DEFECTO) }
    if (DICCIONARIOS[idiom]) aplicar()
    else cargarIdioma(idiom).then(aplicar, aplicar)
    return () => { vivo = false }
  }, [idiom])

  useEffect(() => {
    if (!visible) return
    idiomaActual = visible
    if (typeof document !== 'undefined') document.documentElement.lang = visible
  }, [visible])

  useEffect(() => {
    const sincronizar = () => {
      const guardado = leerPreferenciaCruda()
      if (guardado) setIdiom(guardado)
    }
    window.addEventListener('storage', sincronizar)
    window.addEventListener('focus', sincronizar)
    const sondeo = setInterval(sincronizar, 1500)
    return () => {
      window.removeEventListener('storage', sincronizar)
      window.removeEventListener('focus', sincronizar)
      clearInterval(sondeo)
    }
  }, [])

  const setIdioma = useCallback(nuevo => setIdiom(normalizarIdioma(nuevo)), [])
  const idiomaVisible = visible || IDIOMA_DEFECTO
  const t = useCallback((clave, params) => traducirEn(idiomaVisible, clave, params), [idiomaVisible])

  const tOr = useCallback(
    (clave, alternativa, params) => (existeClave(clave) ? traducirEn(idiomaVisible, clave, params) : alternativa),
    [idiomaVisible],
  )

  const valor = useMemo(() => ({ idiom, setIdioma, t, tOr, idiomas: IDIOMAS_INFO }), [idiom, setIdioma, t, tOr])
  if (!visible) return null
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useIdioma() {
  const ctx = useContext(Ctx)
  if (!ctx) {

    return {
      idiom: IDIOMA_DEFECTO,
      setIdioma: normalizarIdioma,
      t: (clave, params) => traducirEn(IDIOMA_DEFECTO, clave, params),
      tOr: (clave, alternativa, params) => (existeClave(clave) ? traducirEn(IDIOMA_DEFECTO, clave, params) : alternativa),
      idiomas: IDIOMAS_INFO,
    }
  }
  return ctx
}

export default IdiomaProvider
