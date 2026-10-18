// Estación de impresión: la PC del local imprime lo que envían los teléfonos (meseros/cajeros).
// Solo admin y cajero. Reutiliza el estilo de Configuración (adm-*, imp-*).
// NO se traducen: Web Serial, Windows, PDFCreator, Chrome, --kiosk-printing (nombres técnicos).
import { useEffect, useReducer, useState } from 'react'
import { useStore } from '../../services/store.jsx'
import { useIdioma } from '../../i18n/index.jsx'
import { gruposDe } from '../../services/impresion.js'
import { modoImpresion, gestionarImpresion } from '../../services/colaImpresion.js'
import { reutilizarImpresoras } from '../../services/impresora.js'
import SalidaImpresora from '../impresion/SalidaImpresora.jsx'
import {
  estadoEstacion, suscribirEstacion, iniciarEstacion, detenerEstacion,
  grupoListo, refrescarLista, dispararCiclo,
} from '../../services/estacion.js'
import '../admin/admin.css'
import './estacion.css'

const hora = ts => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) } catch { return '' } }

export default function EstacionPage({ rol, sesion }) {
  const { s, d } = useStore()
  const { t } = useIdioma()
  const cfg = s.config || {}
  const grupos = gruposDe(cfg)
  const [, refrescar] = useReducer(x => x + 1, 0)
  const [msgs, setMsgs] = useState({})
  const [guia, setGuia] = useState(false)
  const st = estadoEstacion()
  const permitido = rol === 'admin' || rol === 'cajero'
  const conectado = Boolean(sesion?.supabase)

  useEffect(() => {
    const unsub = suscribirEstacion(refrescar)
    const poll = setInterval(refrescar, 2000)
    if (permitido && conectado) refrescarLista()
    reutilizarImpresoras(grupos.map(g => ({ id: g.id, baud: g.baud }))).then(refrescar)
    return () => { unsub(); clearInterval(poll) }
  }, []) // eslint-disable-line

  if (!permitido) return <div className="adm-panel"><div className="adm-aviso">{t('estacion.sinPermiso')}</div></div>
  if (!conectado) return <div className="adm-panel"><div className="adm-aviso">{t('estacion.soloConectado')}</div></div>

  const nota = (id, txt, ok) => {
    setMsgs(m => ({ ...m, [id]: { txt, ok } }))
    setTimeout(() => setMsgs(m => { const n = { ...m }; delete n[id]; return n }), 6000)
  }

  const pendientesDe = id => (st.jobs || []).filter(j => j.grupo === id && (j.estado === 'pendiente' || j.estado === 'imprimiendo')).length
  const fallosDe = id => (st.jobs || []).filter(j => j.grupo === id && j.estado === 'error').length

  const accion = async (a, id) => {
    try { await gestionarImpresion(a, id); await refrescarLista(); if (a === 'reintentar') dispararCiclo() }
    catch (e) { nota('cola', String(e?.message || e), false) }
  }

  const activarEnvio = () => d({ t: 'cfg~', cambios: { modoImpresion: 'estacion' } })

  const chipEstado = st.corriendo ? (st.error ? 'err' : 'ok') : 'off'
  const claveEstado = st.corriendo ? (st.error ? 'estacion.estadoError' : 'estacion.estadoActiva') : 'estacion.estadoDetenida'
  const totalPend = (st.jobs || []).filter(j => j.estado === 'pendiente' || j.estado === 'imprimiendo').length

  return (
    <div className="adm-panel">
      <div className="adm-cab"><h2>🖨️ {t('estacion.titulo')}</h2></div>

      {modoImpresion(cfg) !== 'estacion' && (
        <div className="adm-aviso est-aviso">
          {t('estacion.modoLocal')}
          {rol === 'admin' && <> <button type="button" className="primary" onClick={activarEnvio}>{t('estacion.activarEnvio')}</button></>}
        </div>
      )}

      <div className="adm-card adm-imp">
        <div className="adm-card-cab">
          <h3>{t('estacion.estaPc')}</h3>
          <span className={'imp-chip ' + chipEstado}>{t(claveEstado)}</span>
          {st.corriendo && <span className="adm-chip">{st.realtime ? t('estacion.tiempoReal') : t('estacion.sondeo')}</span>}
          <span className="sp" />
          {st.corriendo
            ? <button type="button" className="danger" onClick={() => detenerEstacion()}>{t('estacion.detener')}</button>
            : <button type="button" className="primary big" onClick={() => iniciarEstacion(() => cfg)}>{t('estacion.iniciar')}</button>}
        </div>
        <p className="adm-sub" style={{ margin: 0 }}>{t('estacion.intro')}</p>
        {st.corriendo && (
          <p className="imp-dato" style={{ margin: 0 }}>
            {st.imprimiendo ? t('estacion.imprimiendoAhora', { titulo: st.imprimiendo }) : t('estacion.esperando')}
            {' · '}{t('estacion.contadores', { ok: st.impresos, fallos: st.fallidos })}
            {st.ultimoCiclo ? ` · ${t('estacion.ultimaRevision', { hora: hora(st.ultimoCiclo) })}` : ''}
          </p>
        )}
        {st.error && <div className="imp-err">❌ {st.error}</div>}
        <p className="imp-dato" style={{ margin: 0 }}>{t('estacion.mantenAbierta')}</p>
      </div>

      <div className="imp-grupos">
        {grupos.map(g => {
          const listo = grupoListo(g.id)
          const pend = pendientesDe(g.id)
          const fallos = fallosDe(g.id)
          return (
            <section key={g.id} className={'imp-grupo' + (g.tickets ? ' tickets' : '')}>
              <header className="imp-grupo-cab">
                <b className="est-nombre">{g.nombre}</b>
                <span className="adm-chip">{g.tickets ? t('impresoras.grupoTickets') : t('impresoras.grupoComanda')}</span>
                <span className={'imp-chip ' + (listo ? 'ok' : 'off')}>{listo ? t('estacion.listo') : t('estacion.sinSalida')}</span>
                {pend > 0 && <span className="adm-chip">{t('estacion.enCola', { n: pend })}</span>}
                {fallos > 0 && <span className="adm-chip est-fallo">{t('estacion.conFallo', { n: fallos })}</span>}
              </header>
              <SalidaImpresora g={g} cfg={cfg} onCambio={refrescar} />
            </section>
          )
        })}
      </div>

      <div className="adm-card">
        <div className="adm-card-cab">
          <h3>{t('estacion.colaTitulo')}</h3>
          {totalPend > 0 && <span className="adm-chip">{t('estacion.enCola', { n: totalPend })}</span>}
          <span className="sp" />
          <button type="button" className="ghost" onClick={refrescarLista}>↻ {t('estacion.actualizar')}</button>
          {(st.jobs || []).some(j => j.estado !== 'impreso') && (
            <button type="button" className="danger" onClick={() => accion('descartar_todo')}>{t('estacion.descartarTodo')}</button>
          )}
        </div>
        {msgs.cola && <div className="adm-msg warn">⚠️ {msgs.cola.txt}</div>}
        {!(st.jobs || []).length && <p className="imp-dato" style={{ margin: 0 }}>{t('estacion.colaVacia')}</p>}
        <ul className="est-cola">
          {(st.jobs || []).map(j => (
            <li key={j.id} className={'est-job ' + j.estado}>
              <span className="est-hora">{hora(j.creado_en)}</span>
              <span className="est-titulo">{j.titulo || '—'}</span>
              <span className="adm-chip">{(grupos.find(g => g.id === j.grupo) || {}).nombre || j.grupo}</span>
              <span className={'imp-chip ' + (j.estado === 'impreso' ? 'ok' : j.estado === 'error' ? 'err' : 'off')}>{t('estacion.job.' + j.estado)}</span>
              {j.error && <span className="est-error" title={j.error}>{j.error}</span>}
              <span className="sp" />
              {(j.estado === 'error' || j.estado === 'imprimiendo') && <button type="button" className="ghost" onClick={() => accion('reintentar', j.id)}>{t('estacion.reintentar')}</button>}
              {j.estado !== 'impreso' && <button type="button" className="danger" onClick={() => accion('descartar', j.id)}>{t('estacion.descartar')}</button>}
            </li>
          ))}
        </ul>
      </div>

      <div className="adm-fila">
        <button type="button" className="ghost" onClick={() => setGuia(v => !v)}>{guia ? t('estacion.guiaOcultar') : t('estacion.guiaMostrar')}</button>
      </div>
      {guia && (
        <div className="adm-card est-guia">
          <h3>{t('estacion.guiaTitulo')}</h3>
          <ol>
            <li>{t('estacion.guia1')}</li>
            <li>{t('estacion.guia2')}</li>
            <li>{t('estacion.guia3')}</li>
          </ol>
          <h4>{t('estacion.guiaWinTitulo')}</h4>
          <p>{t('estacion.guiaWin1')}</p>
          <code className="est-code">"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://tu-app.vercel.app/#estacion</code>
          <p>{t('estacion.guiaWin2')}</p>
          <p>{t('estacion.guiaWin3')}</p>
        </div>
      )}
    </div>
  )
}
