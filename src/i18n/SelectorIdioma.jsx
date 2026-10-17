// Selector de idioma de la APP (ES / EN / PT) como desplegable, con el mismo aspecto que el de
// tema. Se usa en login, Configuración, panel de super y páginas legales.
// El idioma es una preferencia DEL DISPOSITIVO: se guarda en localStorage ('pos-idioma-app') y
// vale para TODA la app en ese navegador. Sin elección guardada se usa el idioma del navegador.
// Props `soloSuper`/`esSuper` se conservan: con soloSuper y sin esSuper no se muestra.
import { useIdioma, IDIOMAS_INFO } from './index.jsx'
import './selector.css'

export default function SelectorIdioma({ soloSuper = false, esSuper = false }) {
  const { idiom, setIdioma, t } = useIdioma()
  if (soloSuper && !esSuper) return null
  return (
    <label className="sel-idioma">
      <span aria-hidden="true">🌐</span>
      <select value={idiom} onChange={e => setIdioma(e.target.value)} aria-label={t('topbar.idiomaTitulo')} title={t('topbar.idiomaTitulo')}>
        {IDIOMAS_INFO.map(i => <option key={i.codigo} value={i.codigo}>{i.nombre}</option>)}
      </select>
    </label>
  )
}
