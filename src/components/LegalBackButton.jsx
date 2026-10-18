import { Link } from 'react-router-dom'
import { useIdioma } from '../i18n/index.jsx'

export default function LegalBackButton() {
  const { t } = useIdioma()
  return (
    <Link className="legal-back" to="/">
      ← {t('legal.back')}
    </Link>
  )
}
