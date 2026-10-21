import { useEffect, useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { estadoAgente, descargarInstalador } from '../../services/printAgent.js'

export default function AgentStatus() {
  const { t } = useIdioma()
  const [info, setInfo] = useState(undefined)
  const [msg, setMsg] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const sondear = async (manual = false) => {
    if (!manual && typeof document !== 'undefined' && document.hidden) return
    try { setInfo(await estadoAgente({ fondo: !manual })) } catch { setInfo(null) }
  }
  useEffect(() => {
    sondear()
    const p = setInterval(sondear, 30000)
    return () => clearInterval(p)
  }, [])

  const instalar = async () => {
    setOcupado(true); setMsg(null)
    try { await descargarInstalador(); setMsg({ ok: true, txt: t('agente.descargadoOk') }) }
    catch (e) { setMsg({ ok: false, txt: String(e?.message || e) }) }
    finally { setOcupado(false) }
  }

  const linea = ag => ag
    ? (ag.impresoras ? t('agente.estadoOk', { version: ag.version || '?', pc: ag.pc || '?', n: ag.impresoras }) : t('agente.estadoSinLista', { version: ag.version || '?', pc: ag.pc || '?' }))
    : t('agente.ayuda')

  return (
    <div className="adm-card ag-card">
      <div className="adm-card-cab">
        <h3>🔌 {t('agente.cardTitulo')}</h3>
        <span className={'imp-chip ' + (info ? 'ok' : info === null ? 'err' : 'off')}>
          {info ? '●' : info === null ? t('agente.estadoOff') : '…'}
        </span>
        <span className="sp" />
        <button type="button" className="ghost" onClick={() => sondear(true)}>↻ {t('agente.volverProbar')}</button>
        <button type="button" className="primary" disabled={ocupado} onClick={instalar}>
          {ocupado ? t('agente.descargando') : '⬇ ' + t('agente.descargar')}
        </button>
      </div>
      <p className="adm-sub" style={{ margin: 0 }}>{linea(info)}</p>
      {info?.log && <p className="imp-dato" style={{ margin: 0 }}>📄 {info.log}</p>}
      {!info && <p className="imp-dato" style={{ margin: 0 }}>{t('agente.pasos')}</p>}
      {msg && <div className={'adm-msg' + (msg.ok ? ' ok' : ' warn')}>{msg.ok ? '✅ ' : '⚠️ '}{msg.txt}</div>}
    </div>
  )
}
