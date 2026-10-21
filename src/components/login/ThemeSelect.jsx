import { useTema } from '../../services/theme.js'
import { useIdioma } from '../../i18n/index.jsx'

export default function ThemeSelect() {
  const { t } = useIdioma()
  const [tema, setTema] = useTema()
  return (
    <label className="lg-tema">
      <span>{t('tema.titulo')}</span>
      <select name="titulo" value={tema} onChange={e => setTema(e.target.value)} aria-label={t('tema.titulo')}>
        <option value="light">{t('tema.claro')}</option>
        <option value="night">{t('tema.nocturno')}</option>
        <option value="forest">{t('tema.bosque')}</option>
      </select>
    </label>
  )
}
