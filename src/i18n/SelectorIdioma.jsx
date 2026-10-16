// Selector compacto de idioma de la APP (ES / EN / PT). Se usa en dos sitios:
//   · Topbar (cualquier pantalla)  · panel de super (SuperPage.jsx, en su cabecera).
//
// CÓMO SE RESTRINGE AL SUPER ADMIN:
//   El componente ya acepta `soloSuper` y `esSuper`. Hoy el dueño pidió que cualquiera
//   pueda cambiar el idioma, así que Topbar lo renderiza con `soloSuper={false}`.
//   Para dejarlo solo en manos del super basta con cambiar esa línea a:
//       <SelectorIdioma soloSuper esSuper={Boolean(sesion?.es_super)} />
//   El flag `es_super` ya es real: lo escribe `esSuper()` (RPC `public.es_super()`) en
//   `src/services/super/superApi.js` durante el login, y `entrarEnEmpresa()` lo conserva.
//   Con `soloSuper` y sin `esSuper` el selector simplemente no se renderiza: el resto de
//   la app sigue funcionando porque IdiomaProvider lee 'pos-idioma-app' igual que antes.
//
// No hay router: cambiar el idioma es estado de React + localStorage; el Provider además
// se pone al día si otra pestaña (o el selector suelto del carril super) escribe la clave.
import { useIdioma, IDIOMAS_INFO } from './index.jsx'
import './selector.css'

export default function SelectorIdioma({ soloSuper = false, esSuper = false, compacto = true }) {
  const { idiom, setIdioma, t } = useIdioma()

  if (soloSuper && !esSuper) return null

  return (
    <div className="sel-idioma" role="group" aria-label={t('topbar.idiomaTitulo')}>
      <span className="sel-idioma-icono" aria-hidden="true">🌐</span>
      {IDIOMAS_INFO.map(i => (
        <button
          key={i.codigo}
          type="button"
          className={'sel-idioma-btn' + (i.codigo === idiom ? ' on' : '')}
          onClick={() => setIdioma(i.codigo)}
          title={i.nombre}
          aria-pressed={i.codigo === idiom}
        >
          {compacto ? i.corto : i.nombre}
        </button>
      ))}
    </div>
  )
}
