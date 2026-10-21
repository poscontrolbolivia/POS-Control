import { useEffect, useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'
import { soporteSerial, conectarImpresora, estadoImpresora } from '../../services/printer.js'
import { salidaDe, fijarSalida, impresorasDe, fijarImpresoras, modoAgenteDe, fijarModoAgente, grupoListo, imprimirTrabajo, dispararCiclo } from '../../services/station.js'
import { listarImpresorasAgente, urlAgente, fijarUrlAgente } from '../../services/printAgent.js'

export default function PrinterOutput({ g, cfg, onCambio }) {
  const { t, tOr } = useIdioma()
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

  const elegidas = impresorasDe(g.id)
  const lista = [...elegidas.filter(n => !ag.impresoras.includes(n)), ...ag.impresoras]
  const alternar = nombre => { fijarImpresoras(g.id, elegidas.includes(nombre) ? elegidas.filter(x => x !== nombre) : [...elegidas, nombre]); cambio() }

  return (
    <div className="imp-salida">
      <div className="imp-opciones">
        <label className="adm-campo"><span>{t('estacion.salidaLabel')}</span>
          <select name="salida" value={salida} onChange={e => { fijarSalida(g.id, e.target.value); cambio() }}>
            <option value="serial">{t('estacion.salidaSerial')}</option>
            <option value="agente">{t('estacion.salidaAgente')}</option>
            <option value="windows">{t('estacion.salidaWindows')}</option>
          </select>
        </label>
        {salida === 'agente' && (
          <div className="imp-multi">
            <span>{tOr('agente.impresorasLabel', 'Impresoras del agente')}</span>
            <div className="imp-multi-chips">
              {lista.map(n => (
                <button type="button" key={n} className={'imp-op ' + (elegidas.includes(n) ? 'primary' : 'ghost')} onClick={() => alternar(n)}>
                  {n}{n === ag.pred ? ` ${t('agente.predeterminada')}` : ''}
                </button>
              ))}
              {lista.length > 1 && (
                <button type="button" className={'imp-op ' + (elegidas.length === lista.length ? 'primary' : 'ghost')}
                  onClick={() => fijarImpresoras(g.id, elegidas.length === lista.length ? [] : lista)}>{tOr('impresoras.todas', 'Todas')}</button>
              )}
              {!lista.length && <span className="imp-dato">{ag.cargando ? t('agente.cargando') : t('agente.sinImpresoras')}</span>}
            </div>
            <p className="imp-dato" style={{ margin: 0 }}>{tOr('agente.variasAyuda', 'Marca varias a la vez y la misma comanda sale por todas. Por puerto serie solo cabe una: para duplicar en serie crea otro grupo.')}</p>
          </div>
        )}
        {salida === 'agente' && (
          <label className="adm-campo"><span>{t('agente.textoLabel')}</span>
            <select name="modo-agente" value={modoAgenteDe(g.id)} onChange={e => { fijarModoAgente(g.id, e.target.value); cambio() }}>
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
            <input name="url" value={url} onChange={e => setUrl(e.target.value)} onBlur={() => { fijarUrlAgente(url); setUrl(urlAgente()); buscar() }} />
          </label>
        </>
      )}
      {msg && <div className={'adm-msg' + (msg.ok ? ' ok' : ' warn')}>{msg.ok ? '✅ ' : '⚠️ '}{msg.txt}</div>}
    </div>
  )
}
