import { Link } from 'react-router-dom'
import { useIdioma } from '../i18n/index.jsx'
import LanguageSelect from '../components/login/LanguageSelect.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import LegalBackButton from '../components/LegalBackButton.jsx'
import './LegalPage.css'

const SECCIONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

export default function TerminosPage() {
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
          <h1>{t('legal.terms.title')}</h1>
        </div>
        <p className="legal-updated">{t('legal.updated')}</p>
        <p>{t('legal.terms.intro')}</p>

        <div className="legal-toc">
          <p>{t('legal.terms.tocTitle')}</p>
          <ol>
            {SECCIONES.map(n => <li key={n}><a href={`#s${n}`}>{t(`legal.terms.t${n}`)}</a></li>)}
          </ol>
        </div>

        <h2 id="s1">1. {t('legal.terms.t1')}</h2>
        <p>{t('legal.terms.s1')}</p>

        <h2 id="s2">2. {t('legal.terms.t2')}</h2>
        <ul>
          <li>{t('legal.terms.s2a')}</li>
          <li>{t('legal.terms.s2b')}</li>
          <li>{t('legal.terms.s2c')}</li>
        </ul>

        <h2 id="s3">3. {t('legal.terms.t3')}</h2>
        <p>{t('legal.terms.s3')}</p>

        <h2 id="s4">4. {t('legal.terms.t4')}</h2>
        <p>{t('legal.terms.s4')}</p>

        <h2 id="s5">5. {t('legal.terms.t5')}</h2>
        <p>{t('legal.terms.s5')}</p>

        <h2 id="s6">6. {t('legal.terms.t6')}</h2>
        <p>{t('legal.terms.s6')}</p>

        <h2 id="s7">7. {t('legal.terms.t7')}</h2>
        <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {t('legal.terms.s7Summary')}</div>
        <p>{t('legal.terms.s7')}</p>

        <h2 id="s8">8. {t('legal.terms.t8')}</h2>
        <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {t('legal.terms.s8Summary')}</div>
        <p>{t('legal.terms.s8')}</p>
        <p>{t('legal.terms.s8b')}</p>

        <h2 id="s9">9. {t('legal.terms.t9')}</h2>
        <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {t('legal.terms.s9Summary')}</div>
        <p>{t('legal.terms.s9')}</p>

        <h2 id="s10">10. {t('legal.terms.t10')}</h2>
        <p>{t('legal.terms.s10')}</p>

        <h2 id="s11">11. {t('legal.terms.t11')}</h2>
        <p>{t('legal.terms.s11')}</p>

        <div className="legal-contact">
          {t('legal.terms.contact')}
          <br /><Link className="legal-crosslink" to="/privacidad">{t('legal.terms.seePrivacy')}</Link>
        </div>
      </div>
    </div>
  )
}
