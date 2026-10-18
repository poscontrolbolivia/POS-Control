import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import es from './locales/es.json'
import en from './locales/en.json'
import pt from './locales/pt.json'

export const DICCIONARIOS = { es, en, pt }
export const IDIOMAS = ['es', 'en', 'pt']
export const IDIOMA_DEFECTO = 'es'

export const CLAVE_STORAGE = 'pos-idioma-app'

export const IDIOMAS_INFO = [
  { codigo: 'es', nombre: 'Español', corto: 'ES' },
  { codigo: 'en', nombre: 'English', corto: 'EN' },
  { codigo: 'pt', nombre: 'Português', corto: 'PT' },
]

let idiomaActual = leerPreferencia()

export function normalizarIdioma(v) {
  return IDIOMAS.includes(v) ? v : IDIOMA_DEFECTO
}

export function leerPreferenciaCruda() {
  try {
    const v = localStorage.getItem(CLAVE_STORAGE)
    return v === null ? null : normalizarIdioma(v)
  } catch {
    return null
  }
}

export function leerPreferencia() {
  if (leerPreferenciaCruda() !== null) return leerPreferenciaCruda()

  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : '').slice(0, 2).toLowerCase()
  return IDIOMAS.includes(nav) ? nav : IDIOMA_DEFECTO
}

function escribirPreferencia(idioma) {
  try { localStorage.setItem(CLAVE_STORAGE, idioma) } catch {  }
}

export function interpolar(texto, params) {
  if (!params || typeof texto !== 'string') return texto
  return texto.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])))
}

export function traducirEn(idioma, clave, params) {
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

  useEffect(() => {
    idiomaActual = idiom
    escribirPreferencia(idiom)
    if (typeof document !== 'undefined') document.documentElement.lang = idiom
  }, [idiom])

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
  const t = useCallback((clave, params) => traducirEn(idiom, clave, params), [idiom])

  const tOr = useCallback(
    (clave, alternativa, params) => (existeClave(clave) ? traducirEn(idiom, clave, params) : alternativa),
    [idiom],
  )

  const valor = useMemo(() => ({ idiom, setIdioma, t, tOr, idiomas: IDIOMAS_INFO }), [idiom, setIdioma, t, tOr])
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
