import { Link } from 'react-router-dom'
import { useIdioma } from '../i18n/index.jsx'
import LanguageSelect from '../components/login/LanguageSelect.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import LegalBackButton from '../components/LegalBackButton.jsx'
import './LegalPage.css'

export default function PrivacidadPage() {
  const { t } = useIdioma()
  return (
    <div className="legal-wrap">
      <div className="legal-cab">
        <LegalBackButton />
        <LanguageSelect />
      </div>
      <div className="legal-card">
        <div className="legal-marca">
          <BrandMark size={34} />
          <h1>{t('legal.privacy.title')}</h1>
        </div>
        <p className="legal-updated">{t('legal.updated')}</p>
        <p>{t('legal.privacy.intro')}</p>

        <h2 id="p1">1. {t('legal.privacy.t1')}</h2>
        <table className="legal-tabla">
          <thead>
            <tr><th>{t('legal.privacy.tableWho')}</th><th>{t('legal.privacy.tableWhat')}</th></tr>
          </thead>
          <tbody>
            <tr><td>{t('legal.privacy.rowStaff')}</td><td>{t('legal.privacy.rowStaffData')}</td></tr>
            <tr><td>{t('legal.privacy.rowSales')}</td><td>{t('legal.privacy.rowSalesData')}</td></tr>
            <tr><td>{t('legal.privacy.rowMenu')}</td><td>{t('legal.privacy.rowMenuData')}</td></tr>
          </tbody>
        </table>
        <p>{t('legal.privacy.s1Note')}</p>

        <h2 id="p2">2. {t('legal.privacy.t2')}</h2>
        <p>{t('legal.privacy.s2Intro')}</p>
        <ul><li>{t('legal.privacy.s2a')}</li></ul>
        <p>{t('legal.privacy.s2Note')}</p>

        <h2 id="p3">3. {t('legal.privacy.t3')}</h2>
        <p>{t('legal.privacy.s3')}</p>

        <h2 id="p4">4. {t('legal.privacy.t4')}</h2>
        <p>{t('legal.privacy.s4')}</p>

        <h2 id="p5">5. {t('legal.privacy.t5')}</h2>
        <p>{t('legal.privacy.s5')}</p>
        <p>{t('legal.privacy.s5b')}</p>

        <h2 id="p6">6. {t('legal.privacy.t6')}</h2>
        <p>{t('legal.privacy.s6')}</p>
        <p>{t('legal.privacy.s6b')}</p>

        <h2 id="p7">7. {t('legal.privacy.t7')}</h2>
        <p>{t('legal.privacy.s7')}</p>

        <div className="legal-contact">
          {t('legal.privacy.contact')}
          <br /><Link className="legal-crosslink" to="/terminos">{t('legal.privacy.seeTerms')}</Link>
        </div>
      </div>
    </div>
  )
}
