import { useState } from 'react'
import { useIdioma } from '../../../i18n/index.jsx'
import './ReabrirForm.css'

// Mesas que tenía una cuenta ya cobrada: por sus ids (demo) o, si la base ya no las guarda, por el texto
// de mesa que dejó escrito al cobrar («Mesa 2», «1, 3»).
export const mesasDeCuenta = (c, s) => {
  const mesas = s.mesas || []
  const porId = (c.mesaIds || []).map(id => mesas.find(x => x.id === id)).filter(Boolean)
  if (porId.length) return porId
  return String(c.mesaTexto || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(n => mesas.find(x => x.nombre === n)).filter(Boolean)
}

// Mesas sin ninguna cuenta abierta (aparte de la que se reabre).
export const mesasLibres = (s, cuentaId) => (s.mesas || [])
  .filter(mm => !(s.cuentas || []).some(x => x.id !== cuentaId && x.estado !== 'cerrada' && (x.mesaIds || []).includes(mm.id)))

// Formulario único para reabrir una cuenta cobrada (Caja y Reportes): pide el motivo y, si es de mesa y su
// mesa ya está ocupada, obliga a elegir otra mesa libre. Las cuentas para llevar y de mostrador no llevan mesa.
export default function ReabrirForm({ cuenta, s, onConfirmar, onCancelar }) {
  const { t, tOr } = useIdioma()
  const [motivo, setMotivo] = useState('')
  const [mesaId, setMesaId] = useState('')
  const [error, setError] = useState('')

  const esMesa = cuenta.tipo === 'mesa'
  const originales = esMesa ? mesasDeCuenta(cuenta, s) : []
  const libres = mesasLibres(s, cuenta.id)
  const libresIds = new Set(libres.map(x => x.id))
  const ocupadas = originales.filter(x => !libresIds.has(x.id))
  const obliga = esMesa && (originales.length === 0 || ocupadas.length > 0)
  const idsOriginales = new Set(originales.map(x => x.id))
  const opciones = libres.filter(x => obliga || !idsOriginales.has(x.id))
  const zonaDe = mm => (s.zonas || []).find(z => z.id === mm.zona)?.nombre
  const nombres = lista => lista.map(x => x.nombre).join(', ')

  const enviar = e => {
    e.preventDefault()
    const txt = motivo.trim()
    if (!txt) return setError(tOr('caja.reabrirMotivoFalta', 'Escribe el motivo para reabrir la cuenta.'))
    if (obliga && !mesaId) return setError(t('caja.reabrirMesaFalta'))
    setError('')
    onConfirmar({ motivo: txt, mesaIds: mesaId ? [mesaId] : undefined })
  }

  return (
    <form className="reabrir-form" onSubmit={enviar}>
      <b>{tOr('caja.reabrirTitulo', 'Reabrir cuenta cobrada')}</b>
      <small>{tOr('caja.reabrirAyuda', 'La cuenta vuelve a estar abierta con sus pagos.')}</small>
      {ocupadas.length > 0 && <p className="reabrir-aviso" role="status">{t('caja.reabrirMesaAviso', { mesa: nombres(ocupadas) })}</p>}
      {esMesa && (
        <label>{t('caja.reabrirMesa')}
          <select name="mesa-reabrir" value={mesaId} onChange={e => setMesaId(e.target.value)} required={obliga}>
            {obliga
              ? <option value="">{t('caja.reabrirMesaElige')}</option>
              : <option value="">{t('caja.reabrirMesaOriginal', { mesa: nombres(originales) })}</option>}
            {opciones.map(mm => <option key={mm.id} value={mm.id}>{mm.nombre}{zonaDe(mm) ? ` · ${zonaDe(mm)}` : ''}</option>)}
          </select>
        </label>
      )}
      {obliga && opciones.length === 0 && <p className="reabrir-aviso" role="status">{t('caja.reabrirSinMesasLibres')}</p>}
      <label>{tOr('caja.reabrirMotivo', 'Motivo (obligatorio)')}
        <input name="motivo-reabrir" maxLength={120} autoFocus autoComplete="off" placeholder={tOr('caja.reabrirMotivoEj', 'Ej.: devolución de un plato, error en el cobro')}
          value={motivo} onChange={e => setMotivo(e.target.value)} />
      </label>
      {error && <p className="reabrir-error" role="alert">⚠️ {error}</p>}
      <div className="reabrir-acc">
        <button className="danger solid" type="submit" disabled={obliga && opciones.length === 0}>↺ {tOr('caja.reabrirConfirmar', 'Reabrir cuenta')}</button>
        <button className="danger" type="button" onClick={onCancelar}>{t('comun.cancelar')}</button>
      </div>
    </form>
  )
}
