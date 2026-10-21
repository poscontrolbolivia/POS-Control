import { useIdioma } from '../i18n/index.jsx'
import './PantallaCarga.css'

// Pantalla completa mientras se traen los datos de la empresa: así nunca se ve el salón a medias.
// Si la carga falla, muestra el motivo con «Reintentar» y «Salir» para no quedar atrapado.
export default function PantallaCarga({ error = '', onSalir }) {
  const { t } = useIdioma()
  return (
    <div className="pc-pantalla" role="status" aria-live="polite">
      {!error ? <div className="pc-aro" aria-hidden="true" /> : <div className="pc-error-icono" aria-hidden="true">!</div>}
      <p className="pc-texto">{error || t('app.cargandoEmpresa')}</p>
      {error && (
        <div className="pc-acciones">
          <button type="button" className="primary" onClick={() => window.location.reload()}>{t('app.reintentar')}</button>
          {onSalir && <button type="button" className="ghost" onClick={onSalir}>{t('app.salir')}</button>}
        </div>
      )}
    </div>
  )
}
