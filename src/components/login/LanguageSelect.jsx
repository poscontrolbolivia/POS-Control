import { useIdioma, IDIOMAS_INFO } from '../../i18n/index.jsx'
import './LanguageSelect.css'

export default function LanguageSelect({ soloSuper = false, esSuper = false }) {
  const { idiom, setIdioma, t } = useIdioma()
  if (soloSuper && !esSuper) return null
  return (
    <label className="sel-idioma">
      <span aria-hidden="true">🌐</span>
      <select name="idioma-titulo" value={idiom} onChange={e => setIdioma(e.target.value)} aria-label={t('topbar.idiomaTitulo')} title={t('topbar.idiomaTitulo')}>
        {IDIOMAS_INFO.map(i => <option key={i.codigo} value={i.codigo}>{i.nombre}</option>)}
      </select>
    </label>
  )
}
