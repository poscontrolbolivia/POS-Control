import { Link } from 'react-router-dom'
import { useIdioma } from '../i18n/index.jsx'
import LanguageSelect from '../components/login/LanguageSelect.jsx'
import BrandMark from '../components/login/BrandMark.jsx'
import LegalBackButton from '../components/LegalBackButton.jsx'
import './LegalPage.css'

// Cada sección: título t{n}, tabla o lista opcionales y párrafos (claves legal.privacy.*).
const FILAS = ['Staff', 'Sales', 'Menu', 'Customer', 'Audit', 'Tech']
const SECCIONES = [
  { n: 1, p: ['s1'] },
  { n: 2, p: ['s2', 's2b'] },
  { n: 3, tabla: true, despues: ['s3Note'] },
  { n: 4, antes: ['s4Intro'], ul: ['s4a'], despues: ['s4Note'] },
  { n: 5, p: ['s5'] },
  { n: 6, p: ['s6'] },
  { n: 7, p: ['s7', 's7b'] },
  { n: 8, p: ['s8', 's8b'] },
  { n: 9, p: ['s9', 's9b'] },
  { n: 10, p: ['s10'] },
  { n: 11, p: ['s11'] },
  { n: 12, p: ['s12'] },
  { n: 13, p: ['s13'] },
]

export default function PrivacidadPage() {
  const { t } = useIdioma()
  const k = x => t('legal.privacy.' + x)
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

        {SECCIONES.map(({ n, p, antes, ul, tabla, despues }) => (
          <section key={n}>
            <h2 id={`s${n}`}>{n}. {k('t' + n)}</h2>
            {(antes || []).map(x => <p key={x}>{k(x)}</p>)}
            {tabla && (
              <div style={{ overflowX: 'auto' }}>
                <table className="legal-tabla">
                  <thead><tr><th>{k('tableWho')}</th><th>{k('tableWhat')}</th></tr></thead>
                  <tbody>{FILAS.map(f => <tr key={f}><td>{k('row' + f)}</td><td>{k('row' + f + 'Data')}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {ul && <ul>{ul.map(x => <li key={x}>{k(x)}</li>)}</ul>}
            {(p || []).map(x => <p key={x}>{k(x)}</p>)}
            {(despues || []).map(x => <p key={x}>{k(x)}</p>)}
          </section>
        ))}

        <div className="legal-contact">
          <p>{k('contact')}</p>
          <Link className="legal-crosslink" to="/terminos">{k('seeTerms')}</Link>
        </div>
      </div>
    </div>
  )
}
