// ─────────────────────────────────────────────────────────────────────────────
// Idiomas de POS Control (carril IDIOMAS).
//
// · 3 idiomas: 'es' (referencia), 'en', 'pt'. Los diccionarios son objetos PLANOS con
//   claves con puntos; `es.js` es la fuente de verdad y en/pt deben ser su espejo
//   (lo vigila `node scripts/check-i18n.mjs`).
// · La preferencia vive en localStorage bajo la clave 'pos-idioma-app', la MISMA que usa
//   el carril SUPER ADMIN. Hoy el panel (`src/components/super/SuperPage.jsx`) monta este
//   mismo `SelectorIdioma`, así que hay un único escritor; `src/components/super/IdiomaSelector.jsx`
//   quedó sin usar pero sigue escribiendo la misma clave: los escuchas del Provider avisan.
// · Los componentes usan el hook useIdioma(). El código que NO es un componente de React
//   (ticket/Ticket.jsx, services/notificaciones.js) usa tGlobal(), que lee el idioma
//   activo desde el singleton de módulo: así imprimir un ticket respeta el idioma elegido
//   aunque la función se dispare desde un onClick.
// · t() nunca revienta ni devuelve cadena vacía: clave ausente ⇒ texto español; clave
//   inexistente también en español ⇒ devuelve la propia clave (visible para el dev).
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import es from './es.js'
import en from './en.js'
import pt from './pt.js'

export const DICCIONARIOS = { es, en, pt }
export const IDIOMAS = ['es', 'en', 'pt']
export const IDIOMA_DEFECTO = 'es'
// Clave compartida con el carril de super administración. NO cambiar el nombre.
export const CLAVE_STORAGE = 'pos-idioma-app'

// Etiquetas del selector (nombre propio del idioma: se muestran siempre en su idioma).
export const IDIOMAS_INFO = [
  { codigo: 'es', nombre: 'Español', corto: 'ES' },
  { codigo: 'en', nombre: 'English', corto: 'EN' },
  { codigo: 'pt', nombre: 'Português', corto: 'PT' },
]

// Idioma vigente fuera del árbol de React. Se sincroniza con el estado del Provider.
let idiomaActual = leerPreferencia()

// ── Utilidades puras (testables sin React) ──

/** Normaliza cualquier valor venido de localStorage / props a un idioma válido. */
export function normalizarIdioma(v) {
  return IDIOMAS.includes(v) ? v : IDIOMA_DEFECTO
}

/** Lee la preferencia persistida. Devuelve null si localStorage no está disponible. */
export function leerPreferenciaCruda() {
  try {
    const v = localStorage.getItem(CLAVE_STORAGE)
    return v === null ? null : normalizarIdioma(v)
  } catch {
    return null // modo privado / sandbox: sin persistencia
  }
}

/** Lee la preferencia persistida (con defecto en español). */
export function leerPreferencia() {
  if (leerPreferenciaCruda() !== null) return leerPreferenciaCruda()
  // Sin elección guardada: el idioma del navegador si lo soportamos, si no el defecto.
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : '').slice(0, 2).toLowerCase()
  return IDIOMAS.includes(nav) ? nav : IDIOMA_DEFECTO
}

function escribirPreferencia(idioma) {
  try { localStorage.setItem(CLAVE_STORAGE, idioma) } catch { /* sin persistencia: sigue en memoria */ }
}

/** Sustituye los marcadores {nombre} de una plantilla por los params recibidos. */
export function interpolar(texto, params) {
  if (!params || typeof texto !== 'string') return texto
  return texto.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])))
}

/** Devuelve el texto de `clave` en `idioma`, con español de respaldo y, si nada funciona, la clave. */
export function traducirEn(idioma, clave, params) {
  const txt = DICCIONARIOS[idioma] && DICCIONARIOS[idioma][clave]
  if (typeof txt === 'string') return interpolar(txt, params)
  const enEs = es[clave]
  if (typeof enEs === 'string') return interpolar(enEs, params) // clave aún no traducida: nunca vacío
  return String(clave ?? '')                                   // clave inexistente: la mostramos tal cual
}

/** ¿La clave existe en la fuente de verdad? (sirve para decidir una alternativa propia) */
export function existeClave(clave) {
  return typeof es[clave] === 'string'
}

/**
 * Traducción para código que no es componente de React (impresión de tickets,
 * notificaciones del sistema, servicios). Usa el idioma activo del Provider.
 */
export function tGlobal(clave, params) {
  return traducirEn(idiomaActual, clave, params)
}

/** Idioma activo visto desde fuera de React. */
export const idiomaActivo = () => idiomaActual

// ── Contexto / hook ──
const Ctx = createContext(null)

export function IdiomaProvider({ children }) {
  const [idiom, setIdiom] = useState(leerPreferencia)

  // Publicamos el idioma para el código fuera de React y lo reflejamos en <html lang>,
  // que usan lectores de pantalla, el navegador (corrector ortográfico) y CSS.
  useEffect(() => {
    idiomaActual = idiom
    escribirPreferencia(idiom)
    if (typeof document !== 'undefined') document.documentElement.lang = idiom
  }, [idiom])

  // El carril de super administración tiene su propio selector autónomo
  // (`components/super/IdiomaSelector.jsx`) que escribe 'pos-idioma-app' sin pasar por
  // aquí. Estos escuchas nos ponen al día: entre pestañas ('storage'), al volver a
  // enfocar la ventana y con un sondeo ligero de respaldo (el evento 'storage' NO se
  // dispara cuando escribe la MISMA pestaña, y un `<select>` suelto no avisa a React).
  // Lo ideal es controlarlo: <IdiomaSelector value={idiom} onChange={setIdioma} />.
  useEffect(() => {
    const sincronizar = () => {
      const guardado = leerPreferenciaCruda()
      if (guardado) setIdiom(guardado) // null = localStorage no disponible: NO pisamos el estado
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

  // tOr: igual que t(), pero si la clave NO existe en ningún diccionario devuelve la
  // alternativa que pida el llamador (se usa para identificadores de datos: roles,
  // estados de cuenta y métodos de pago que en la base siguen escritos en español).
  const tOr = useCallback(
    (clave, alternativa, params) => (existeClave(clave) ? traducirEn(idiom, clave, params) : alternativa),
    [idiom],
  )

  const valor = useMemo(() => ({ idiom, setIdioma, t, tOr, idiomas: IDIOMAS_INFO }), [idiom, setIdioma, t, tOr])
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

/** Hook de idioma: { idiom, setIdioma, t, tOr, idiomas }. */
export function useIdioma() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    // Red de seguridad: si un componente se monta fuera del Provider (tests, storybook),
    // la app sigue funcionando en español en lugar de romper.
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
