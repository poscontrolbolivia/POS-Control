import { useEffect, useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { soporteSerial, conectarImpresora, estadoImpresora } from '../../services/printer.js'
import { salidaDe, fijarSalida, impresoraDe, fijarImpresora, modoAgenteDe, fijarModoAgente, grupoListo, imprimirTrabajo, dispararCiclo } from '../../services/station.js'
import { listarImpresorasAgente, urlAgente, fijarUrlAgente } from '../../services/printAgent.js'

export default function PrinterOutput({ g, cfg, onCambio }) {
  const { t } = useIdioma()
  const salida = salidaDe(g.id)
  const est = estadoImpresora(g.id)
  const listo = grupoListo(g.id)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState(null)
  const [ag, setAg] = useState({ cargando: false, ok: null, impresoras: [], pred: '', error: '' })
  const [url, setUrl] = useState(urlAgente())

  const avisar = (txt, ok) => { setMsg({ txt, ok }); setTimeout(() => setMsg(null), 6000) }
  const cambio = () => { onCambio?.(); dispararCiclo() }

  const buscar = async () => {
    setAg(a => ({ ...a, cargando: true }))
    try {
      const r = await listarImpresorasAgente()
      setAg({ cargando: false, ok: true, impresoras: r.impresoras || [], pred: r.predeterminada || '', error: '' })
    } catch (e) { setAg({ cargando: false, ok: false, impresoras: [], pred: '', error: String(e?.message || e) }) }
  }
  useEffect(() => { if (salida === 'agente') buscar() }, [salida])

  const conectar = async () => {
    setOcupado(true)
    try { await conectarImpresora({ grupo: g.id, baud: g.baud }); avisar(t('impresoras.conectadaOk'), true); cambio() }
    catch (e) {
      const cancelada = String(e?.name || '') === 'NotFoundError'
      avisar(cancelada ? t('impresoras.cancelada') : `${t('impresoras.noConecta')} ${String(e?.message || e)}`, false)
    } finally { setOcupado(false) }
  }

  const probar = async () => {
    setOcupado(true)
    try {
      await imprimirTrabajo(g.id, {
        ancho: Number(g.ancho) || 32,
        beep: Boolean(cfg?.impresoraBeep),
        lineas: [
          { texto: 'POS CONTROL', negrita: true, centrado: true, tam: 2 },
          { texto: g.nombre.toUpperCase(), negrita: true, centrado: true },
          { texto: '', guion: true },
          { texto: `${t('impresoras.pruebaLinea')}\tOK`, guion: true },
          { texto: cfg?.nombre || t('comun.miNegocio'), centrado: true },
          { texto: (Number(g.ancho) || 32) >= 42 ? t('impresoras.ancho80') : t('impresoras.ancho58'), centrado: true },
          { texto: new Date().toLocaleString(), centrado: true },
        ],
      })
      avisar(t('impresoras.pruebaOk'), true)
    } catch (e) { avisar(String(e?.message || e), false) }
    finally { setOcupado(false); onCambio?.() }
  }

  const elegida = impresoraDe(g.id)
  const lista = ag.impresoras.includes(elegida) || !elegida ? ag.impresoras : [elegida, ...ag.impresoras]

  return (
    <div className="imp-salida">
      <div className="imp-opciones">
        <label className="adm-campo"><span>{t('estacion.salidaLabel')}</span>
          <select value={salida} onChange={e => { fijarSalida(g.id, e.target.value); cambio() }}>
            <option value="serial">{t('estacion.salidaSerial')}</option>
            <option value="agente">{t('estacion.salidaAgente')}</option>
            <option value="windows">{t('estacion.salidaWindows')}</option>
          </select>
        </label>
        {salida === 'agente' && (
          <label className="adm-campo"><span>{t('agente.impresoraLabel')}</span>
            <select value={elegida} onChange={e => { fijarImpresora(g.id, e.target.value); cambio() }}>
              <option value="">{t('agente.elige')}</option>
              {lista.map(n => <option key={n} value={n}>{n}{n === ag.pred ? t('agente.predeterminada') : ''}</option>)}
            </select>
          </label>
        )}
        {salida === 'agente' && (
          <label className="adm-campo"><span>{t('agente.textoLabel')}</span>
            <select value={modoAgenteDe(g.id)} onChange={e => { fijarModoAgente(g.id, e.target.value); cambio() }}>
              <option value="raw">{t('agente.modoRaw')}</option>
              <option value="texto">{t('agente.modoTexto')}</option>
            </select>
          </label>
        )}
      </div>
      {salida === 'agente' && modoAgenteDe(g.id) === 'texto' && (
        <p className="imp-dato" style={{ margin: 0 }}>{t('agente.modoAyuda')}</p>
      )}

      <div className="adm-fila">
        {salida === 'serial' && (
          <button type="button" className="primary" disabled={!soporteSerial() || ocupado} onClick={conectar}>
            {est.conectada ? t('estacion.cambiarImpresora') : t('impresoras.conectar')}
          </button>
        )}
        {salida === 'agente' && (
          <button type="button" className="ghost" disabled={ag.cargando} onClick={buscar}>↻ {t('agente.recargar')}</button>
        )}
        <button type="button" className="success" disabled={!listo || ocupado} onClick={probar}>{t('impresoras.probar')}</button>
        <span className={'imp-chip ' + (listo ? 'ok' : 'off')}>{listo ? t('estacion.listo') : t('estacion.sinSalida')}</span>
      </div>

      {salida === 'serial' && !soporteSerial() && <div className="imp-err">⚠️ {t('estacion.noSerial')}</div>}
      {salida === 'serial' && est.error && <div className="imp-err">❌ {est.error}</div>}
      {salida === 'agente' && (
        <>
          {ag.ok === false && <div className="imp-err">❌ {ag.error} <span className="imp-dato">{t('agente.ayuda')}</span></div>}
          {ag.ok && !ag.impresoras.length && <div className="imp-err">⚠️ {t('agente.sinImpresoras')}</div>}
          <label className="adm-campo imp-url"><span>{t('agente.urlLabel')}</span>
            <input value={url} onChange={e => setUrl(e.target.value)} onBlur={() => { fijarUrlAgente(url); setUrl(urlAgente()); buscar() }} />
          </label>
        </>
      )}
      {msg && <div className={'adm-msg' + (msg.ok ? ' ok' : ' warn')}>{msg.ok ? '✅ ' : '⚠️ '}{msg.txt}</div>}
    </div>
  )
}
