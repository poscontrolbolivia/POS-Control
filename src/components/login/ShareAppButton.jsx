import { useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'

const ShareIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" /><line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
  </svg>
)
const CheckIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
)

// Comparte el enlace de la app: panel nativo (celular) o copia al portapapeles (PC).
export default function ShareAppButton({ marca = 'POS Control' }) {
  const { t } = useIdioma()
  const [estado, setEstado] = useState('idle') // idle | copiado | error
  const url = location.origin
  const avisar = e => { setEstado(e); setTimeout(() => setEstado('idle'), 2200) }

  const compartir = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: marca, text: t('login.textoCompartir', { marca }), url }) } catch { /* canceló */ }
      return
    }
    try { await navigator.clipboard.writeText(url); avisar('copiado') } catch { avisar('error') }
  }
  const etiqueta = estado === 'copiado' ? t('login.enlaceCopiado') : estado === 'error' ? t('login.noSePudoCopiar') : t('login.compartir')
  return (
    <span className="lg-share">
      <button type="button" className="lg-share-btn" onClick={compartir} title={etiqueta} aria-label={etiqueta}>
        {estado === 'copiado' ? CheckIcon : ShareIcon}
      </button>
      {estado !== 'idle' && (
        <span className={'lg-share-toast' + (estado === 'error' ? ' err' : '')} role="status">
          {estado === 'copiado' ? t('login.enlaceCopiadoToast') : t('login.noSePudoCopiarToast')}
        </span>
      )}
    </span>
  )
}
