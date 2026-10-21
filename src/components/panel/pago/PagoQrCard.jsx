import { useIdioma } from '../../../i18n/index.jsx'
import { urlImagenNegocio } from '../../../services/imageUpload.js'
import { formatearMonto } from '../../../services/money.js'
import { MONEDA } from '../../../services/config.js'
import './PagoQrCard.css'

// Tarjeta del QR de pago para el momento del cobro (Caja y Venta rápida).
// Se ve tanto en el móvil del cliente como en el PC de caja: imagen con contain
// y fondo blanco para que el QR no se deforme ni pierda nitidez.
// Props: { config, monto, metodo, empresaNombre, onCerrar? }
export default function PagoQrCard({ config, monto, metodo, empresaNombre, onCerrar }) {
  const { tOr } = useIdioma()
  const qrUrl = urlImagenNegocio(config, 'qr')
  const logoUrl = urlImagenNegocio(config, 'logo')
  const moneda = config?.moneda || MONEDA

  return (
    <div className="pqc">
      <div className="pqc-cab">
        {logoUrl ? <img className="pqc-logo" src={logoUrl} alt="" /> : null}
        {empresaNombre ? <span className="pqc-negocio">{empresaNombre}</span> : null}
      </div>

      {qrUrl ? (
        <>
          <div className="pqc-qr">
            <img src={qrUrl} alt={tOr('pago.qrAlt', 'Código QR de pago del negocio')} />
          </div>
          <p className="pqc-monto">
            <span>{tOr('pago.qrTotal', 'Total a pagar')}</span>
            <b>{formatearMonto(monto, moneda)}</b>
            {metodo ? <span className="pqc-metodo">· {metodo}</span> : null}
          </p>
          <p className="pqc-ayuda">{tOr('pago.qrAyuda', 'Escanea con tu app bancaria y confirma el pago.')}</p>
        </>
      ) : (
        <div className="pqc-vacio" role="status">
          <p>{tOr('pago.qrFalta', 'Este negocio todavía no tiene una imagen de QR de pago.')}</p>
          <p>
            <a href="#config">{tOr('pago.qrIrConfig', 'Súbela en Configuración → Datos del negocio')}</a>
          </p>
        </div>
      )}

      {onCerrar ? (
        <button type="button" className="ghost pqc-cerrar" onClick={onCerrar}>{tOr('pago.qrCerrar', 'Cerrar')}</button>
      ) : null}
    </div>
  )
}
