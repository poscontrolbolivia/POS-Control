import { Link } from 'react-router-dom'
import { useIdioma } from '../../i18n/index.jsx'

// Pie legal: siempre muestra el nombre del SOFTWARE (POS Control™), nunca el de una empresa.
export default function AppFooter() {
  const { t } = useIdioma()
  return (
    <footer className="lg-footer">
      <div className="lg-footer-marca">
        <span>POS Control™</span>
        <span className="lg-footer-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.4 2.4 3.4-.4.4 3.4L21 10l-2.8 2.6.4 3.4-3.4-.4L12 18l-2.4-2.4-3.4.4-.4-3.4L3 10l2.8-2.6-.4-3.4 3.4.4z" />
            <path d="M9.8 12.2l1.6 1.6 3-3.4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('login.softwareVerificado')}
        </span>
      </div>
      <div className="lg-footer-links">
        <Link to="/terminos">{t('legal.terms.title')}</Link> · <Link to="/privacidad">{t('legal.privacy.title')}</Link>
      </div>
      <div className="lg-footer-copy">{t('login.derechos', { anio: new Date().getFullYear() })}</div>
    </footer>
  )
}
