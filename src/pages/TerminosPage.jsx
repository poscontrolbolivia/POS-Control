import { Link } from 'react-router-dom'
import { useIdioma } from '../i18n/index.jsx'
import LanguageSelect from '../components/login/LanguageSelect.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import LegalBackButton from '../components/LegalBackButton.jsx'
import './LegalPage.css'

// Cada sección: título t{n}, resumen opcional, lista opcional y párrafos (claves legal.terms.*).
const SECCIONES = [
  { n: 1, p: ['s1'] },
  { n: 2, ul: ['s2a', 's2b', 's2c', 's2d'] },
  { n: 3, p: ['s3'] },
  { n: 4, p: ['s4', 's4b'] },
  { n: 5, p: ['s5', 's5b'] },
  { n: 6, p: ['s6', 's6b'] },
  { n: 7, p: ['s7', 's7b'] },
  { n: 8, p: ['s8', 's8b'] },
  { n: 9, sum: 's9Summary', p: ['s9'] },
  { n: 10, sum: 's10Summary', p: ['s10', 's10b'] },
  { n: 11, sum: 's11Summary', p: ['s11'] },
  { n: 12, p: ['s12'] },
  { n: 13, p: ['s13'] },
  { n: 14, p: ['s14'] },
  { n: 15, p: ['s15'] },
  { n: 16, p: ['s16'] },
]

export default function TerminosPage() {
  const { t } = useIdioma()
  const k = x => t('legal.terms.' + x)
  return (
    <div className="legal-wrap">
      <div className="legal-cab">
        <LegalBackButton />
        <LanguageSelect />
      </div>
      <div className="legal-card">
        <div className="legal-marca">
          <BrandMark size={34} />
          <h1>{k('title')}</h1>
        </div>
        <p className="legal-updated">{t('legal.updated')}</p>
        <p>{k('intro')}</p>

        <div className="legal-toc">
          <p>{k('tocTitle')}</p>
          <ol>
            {SECCIONES.map(({ n }) => <li key={n}><a href={`#s${n}`}>{k('t' + n)}</a></li>)}
          </ol>
        </div>

        {SECCIONES.map(({ n, sum, ul, p }) => (
          <section key={n}>
            <h2 id={`s${n}`}>{n}. {k('t' + n)}</h2>
            {sum && <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {k(sum)}</div>}
            {ul && <ul>{ul.map(x => <li key={x}>{k(x)}</li>)}</ul>}
            {(p || []).map(x => <p key={x}>{k(x)}</p>)}
          </section>
        ))}

        <div className="legal-contact">
          <p>{k('contact')}</p>
          <Link className="legal-crosslink" to="/privacidad">{k('seePrivacy')}</Link>
        </div>
      </div>
    </div>
  )
}
