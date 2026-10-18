import { useCallback, useEffect, useRef, useState } from 'react'
import { useIdioma } from '../i18n/index.jsx'
import { isStandalonePwa, esIos } from '../services/pwa.js'
import './Banners.css'

const REVISAR_CADA_MS = 10 * 60 * 1000
const AUTO_AL_ABRIR_MS = 15 * 1000
const AUTO_TRAS_OCULTA_MS = 30 * 60 * 1000
const RECORDAR_MS = 15 * 60 * 1000
const LLAVE_FORZADO = 'pos-actualizado-en'

async function idRemoto() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = await r.json()
    return typeof d?.id === 'string' ? d.id : null
  } catch { return null }
}

async function recargaForzada() {
  try {
    const ultima = Number(sessionStorage.getItem(LLAVE_FORZADO)) || 0
    if (Date.now() - ultima < 2 * 60 * 1000) return
    sessionStorage.setItem(LLAVE_FORZADO, String(Date.now()))
  } catch {  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || []
    await Promise.all(regs.map(r => r.unregister()))
    if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)))
  } catch {  }
  window.location.reload()
}

function useActualizacion() {
  const [desactualizada, setDesactualizada] = useState(false)
  const [oculta, setOculta] = useState(false)
  const inicio = useRef(Date.now())
  const auto = useRef(false)

  useEffect(() => {
    if (import.meta.env.DEV || typeof __BUILD_ID__ === 'undefined') return undefined
    let ocultaDesde = 0
    const revisar = async () => {
      try { (await navigator.serviceWorker?.getRegistration?.())?.update?.() } catch {  }
      const remoto = await idRemoto()
      if (remoto && remoto !== __BUILD_ID__) setDesactualizada(true)
    }
    const alVer = () => {
      if (document.hidden) { ocultaDesde = Date.now(); return }
      if (ocultaDesde && Date.now() - ocultaDesde > AUTO_TRAS_OCULTA_MS) auto.current = true
      ocultaDesde = 0
      revisar()
    }
    revisar()
    const id = setInterval(() => { if (!document.hidden) revisar() }, REVISAR_CADA_MS)
    document.addEventListener('visibilitychange', alVer)
    window.addEventListener('online', revisar)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVer); window.removeEventListener('online', revisar) }
  }, [])

  const actualizar = useCallback(() => { recargaForzada() }, [])

  useEffect(() => {
    if (desactualizada && (auto.current || Date.now() - inicio.current < AUTO_AL_ABRIR_MS)) actualizar()
  }, [desactualizada, actualizar])

  const luego = () => { setOculta(true); setTimeout(() => setOculta(false), RECORDAR_MS) }
  return { hayNueva: desactualizada && !oculta, actualizar, luego }
}

export default function PwaBanners() {
  const { t } = useIdioma()
  const { hayNueva, actualizar, luego } = useActualizacion()
  const [instalador, setInstalador] = useState(null)
  const [ios] = useState(() => !isStandalonePwa() && esIos())
  const [cerrado, setCerrado] = useState(false)

  useEffect(() => {
    if (isStandalonePwa() || ios) return undefined
    const alPedir = e => { e.preventDefault(); setInstalador(e) }
    const alInstalar = () => setInstalador(null)
    window.addEventListener('beforeinstallprompt', alPedir)
    window.addEventListener('appinstalled', alInstalar)
    return () => { window.removeEventListener('beforeinstallprompt', alPedir); window.removeEventListener('appinstalled', alInstalar) }
  }, [ios])

  const instalar = async () => {
    if (!instalador) return
    instalador.prompt()
    try { await instalador.userChoice } catch {  }
    setInstalador(null)
  }

  const mostrarInstalar = !cerrado && !isStandalonePwa() && (instalador || ios)

  return (
    <>
      {hayNueva && (
        <div role="alert" className="app-banner">
          <span>{t('install.updateText')}</span>
          <div className="app-banner__actions">
            <button type="button" className="app-banner__btn-primary" onClick={actualizar}>{t('install.updateBtn')}</button>
            <button type="button" className="app-banner__btn-secondary" onClick={luego}>{t('install.later')}</button>
          </div>
        </div>
      )}
      {mostrarInstalar && (
        <div role="status" className="app-banner">
          {instalador ? (
            <>
              <span>{t('install.text')}</span>
              <div className="app-banner__actions">
                <button type="button" className="app-banner__btn-primary" onClick={instalar}>{t('install.installBtn')}</button>
                <button type="button" className="app-banner__btn-secondary" onClick={() => setCerrado(true)}>{t('install.later')}</button>
              </div>
            </>
          ) : (
            <>
              <span>{t('install.iosText')}</span>
              <button type="button" className="app-banner__btn-ok" onClick={() => setCerrado(true)}>{t('install.understood')}</button>
            </>
          )}
        </div>
      )}
    </>
  )
}
