import { useIdioma } from '../../../i18n/index.jsx'
import { useStore } from '../../../context/StoreContext.jsx'
import { formatearMonto } from '../../../services/money.js'
import { round2 } from '../../../services/format.js'
import { calcularResumen } from './calcularResumen.js'
import ClosingsHistory from './ClosingsHistory.jsx'
import './CashPage.css'

// Historial de cierres de caja. Con base conectada lee los turnos cerrados (ClosingsHistory);
// en modo demo (localStorage) muestra una lista simple. Vive dentro del menú «Caja».
export default function CierresPanel({ sesion }) {
  const { s } = useStore()
  const moneda = s.config?.moneda || 'Bs'
  return sesion?.supabase
    ? <ClosingsHistory moneda={moneda} />
    : <CierresDemo historial={s.caja?.historial || []} cuentas={s.cuentas} moneda={moneda} />
}

function CierresDemo({ historial, cuentas, moneda }) {
  const { t } = useIdioma()
  const m = n => formatearMonto(n, moneda)
  if (!historial.length) return <p className="caja-nota">{t('cierres.vacio')}</p>
  return (
    <ul className="caja-lista">
      {historial.map((h, i) => {
        const r = calcularResumen(h, cuentas)
        const dif = round2((Number(h.contado) || 0) - r.esperado)
        return (
          <li key={h.id}>
            <b>{t('caja.turnoNumero', { n: historial.length - i })}</b>
            <span className="caja-hora">{new Date(h.cerradoEn || h.abiertoEn).toLocaleString()}</span>
            <span className="sp" />
            {h.traspaso?.length > 0 && <span className="caja-hora">{t('caja.traspasoHist', { n: h.traspaso.length })}</span>}
            <span>{t('caja.vendidoM', { monto: m(r.vendido) })}</span>
            <span className={'caja-diff ' + (Math.abs(dif) < 0.005 ? 'ok' : dif > 0 ? 'sobra' : 'falta')}>
              {Math.abs(dif) < 0.005 ? t('caja.cuadrado') : dif > 0 ? t('caja.sobraM', { monto: m(dif) }) : t('caja.faltaM', { monto: m(-dif) })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
