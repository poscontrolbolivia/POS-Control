import { useIdioma } from '../../i18n/index.jsx'
import './VistaMapaLista.css'

// Selector único «Mapa / Lista» para todas las pantallas que muestran mesas de las dos formas
// (Salón, Caja, Reportes). Siempre a la derecha de su encabezado y con los mismos iconos y textos.
// valor: 'mapa' | 'lista'. bloquearLista: se usa al editar el mapa, que solo existe en vista mapa.
export default function VistaMapaLista({ valor, onCambiar, bloquearLista = false, etiqueta }) {
  const { t, tOr } = useIdioma()
  return (
    <div className="vista-ml" role="group" aria-label={etiqueta || tOr('salon.vista', 'Vista de mesas')}>
      <button type="button" className={'tab' + (valor === 'mapa' ? ' on' : '')} aria-pressed={valor === 'mapa'} onClick={() => onCambiar('mapa')}>
        <span aria-hidden="true">🧩</span> {t('salon.vistaMapa')}
      </button>
      <button type="button" className={'tab' + (valor === 'lista' ? ' on' : '')} aria-pressed={valor === 'lista'} disabled={bloquearLista} onClick={() => onCambiar('lista')}>
        <span aria-hidden="true">☰</span> {t('salon.vistaLista')}
      </button>
    </div>
  )
}
