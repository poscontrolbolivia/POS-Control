// Administración de impresoras (solo rol admin): modo de impresión (silenciosa/manual), ancho de
// papel, conexión por Web Serial (ESC/POS) y prueba de impresión.
// Se renderiza como tarjeta para ir debajo de ConfigAdmin.
// NO se traduce: los nombres técnicos (Web Serial, Chrome, Edge, getPorts()) ni los modelos
// de impresora (POS-580, Xprinter); sí los textos que lee el usuario.
// Props: { rol, sesion }
import { useEffect, useState } from 'react'
import { useStore } from '../../services/store.jsx'
import { useIdioma } from '../../i18n/index.jsx'
import {
  soporteSerial, conectarImpresora, reutilizarImpresora, estadoImpresora,
  suscribirImpresora, imprimirSilencioso,
} from '../../services/impresora.js'
import './admin.css'

const CLAVE_ESTADO = {
  ok: 'impresoras.estadoOk',
  error: 'impresoras.estadoError',
  desconectada: 'impresoras.estadoOff',
  no_soportado: 'impresoras.estadoNoSoportado',
}

export default function ImpresorasAdmin({ rol, sesion }) {
  const { s, d } = useStore()
  const { t } = useIdioma()
  const cfg = s.config || {}
  const [est, setEst] = useState(estadoImpresora())
  const [msg, setMsg] = useState('')
  const [pruebaOk, setPruebaOk] = useState('')

  // "Recordar impresora": reutiliza el puerto ya emparejado (getPorts no muestra diálogo) + estados en vivo.
  useEffect(() => {
    let vivo = true
    reutilizarImpresora({ baud: Number(cfg.impresoraBaud) || 9600 })
    const unsub = suscribirImpresora(e => { if (vivo) setEst(e) })
    const poll = setInterval(() => { if (vivo) setEst(estadoImpresora()) }, 3000)
    return () => { vivo = false; unsub(); clearInterval(poll) }
  }, []) // eslint-disable-line

  if (rol !== 'admin') {
    return <div className="adm-aviso">{t('impresoras.sinPermiso')}{sesion?.nombre ? t('config.sesionParent', { nombre: sesion.nombre }) : ''}</div>
  }

  const guardar = cambios => d({ t: 'cfg~', cambios })
  const modo = cfg.impresion || cfg.imprimacion || 'manual'
  const ancho = Number(cfg.impresoraAncho) || 32
  const baud = Number(cfg.impresoraBaud) || 9600

  const conectar = async () => {
    setMsg('')
    try {
      await conectarImpresora({ baud })
      setMsg(t('impresoras.conectadaOk'))
    } catch (e) {
      const cancelada = String(e?.name || '') === 'NotFoundError' // el usuario cerró el selector sin elegir
      setMsg(cancelada ? t('impresoras.cancelada') : `${t('impresoras.noConecta')} ${String(e?.message || e)}`)
    }
    setTimeout(() => setMsg(''), 5000)
  }

  const probar = async () => {
    setPruebaOk('')
    try {
      await imprimirSilencioso({
        lineas: [
          // 'POS CONTROL' es el nombre del producto: va tal cual en el papel.
          { texto: 'POS CONTROL', negrita: true, centrado: true, tam: 2 },
          { texto: '', guion: true },
          { texto: `${t('impresoras.pruebaLinea')}\tOK`, guion: true },
          { texto: cfg.nombre || t('comun.miNegocio'), centrado: true },
          { texto: ancho >= 42 ? t('impresoras.ancho80') : t('impresoras.ancho58'), centrado: true },
          { texto: new Date().toLocaleString(), centrado: true },
        ],
        ancho,
        corte: true,
        beep: Boolean(cfg.impresoraBeep),
      })
      setPruebaOk(t('impresoras.pruebaOk'))
    } catch (e) {
      setPruebaOk('❌ ' + String(e?.message || e))
    }
    setTimeout(() => setPruebaOk(''), 6000)
  }

  const claveChip = !est.soportado ? CLAVE_ESTADO.no_soportado : est.error ? CLAVE_ESTADO.error : est.conectada ? CLAVE_ESTADO.ok : CLAVE_ESTADO.desconectada
  const clsChip = !est.soportado ? 'err' : est.error ? 'err' : est.conectada ? 'ok' : 'off'

  return (
    <div className="adm-card adm-imp">
      <div className="adm-card-cab">
        <h3>{t('impresoras.titulo')}</h3>
        <span className={'imp-chip ' + clsChip}>{t(claveChip)}</span>
        <span className="sp" />
        {est.cola > 0 && <span className="adm-chip">{t('impresoras.cola', { n: est.cola })}</span>}
      </div>

      {!est.soportado && (
        <div className="imp-noporte">
          {t('impresoras.noSoporte1')} <b>{t('impresoras.noSoporte2')}</b>{t('impresoras.noSoporte3')}{' '}
          <b>{t('impresoras.noSoporte4')}</b>{t('impresoras.noSoporte5')} {t('impresoras.noSoporte6')}{' '}
          <b>{t('impresoras.noSoporte7')}</b>{t('impresoras.noSoporte8')}
        </div>
      )}

      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.modoLabel')}</span>
        <div className="adm-fila">
          <label className="imp-radio"><input type="radio" name="imp-modo" checked={modo === 'silenciosa'} onChange={() => guardar({ impresion: 'silenciosa' })} /> {t('impresoras.modoSilencioso')}</label>
          <label className="imp-radio"><input type="radio" name="imp-modo" checked={modo !== 'silenciosa'} onChange={() => guardar({ impresion: 'manual' })} /> {t('impresoras.modoManual')}</label>
        </div>
      </div>

      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.anchoLabel')}</span>
        <div className="adm-fila">
          <label className="imp-radio"><input type="radio" name="imp-ancho" checked={ancho < 42} onChange={() => guardar({ impresoraAncho: 32 })} /> {t('impresoras.ancho58')}</label>
          <label className="imp-radio"><input type="radio" name="imp-ancho" checked={ancho >= 42} onChange={() => guardar({ impresoraAncho: 48 })} /> {t('impresoras.ancho80')}</label>
        </div>
      </div>

      <div className="imp-bloque">
        <span className="imp-label">{t('impresoras.baudLabel')}</span>
        <div className="adm-fila">
          {/* Opciones técnicas (bps + modelo): se dejan tal cual. */}
          <select value={baud} onChange={e => guardar({ impresoraBaud: Number(e.target.value) })} style={{ minWidth: 140 }}>
            <option value={9600}>9600 bps (POS-580)</option>
            <option value={115200}>115200 bps (Xprinter)</option>
          </select>
          <label className="imp-radio"><input type="checkbox" checked={Boolean(cfg.impresoraBeep)} onChange={e => guardar({ impresoraBeep: e.target.checked })} /> {t('impresoras.beep')}</label>
        </div>
      </div>

      <div className="adm-fila">
        <button className="primary" disabled={!est.soportado} onClick={conectar}>{t('impresoras.conectar')}</button>
        <button className="ghost" disabled={!est.soportado || !est.conectada} onClick={probar}>{t('impresoras.probar')}</button>
        {est.conectada && <span className="imp-dato">{t('impresoras.puertoA', { baud })} <code>getPorts()</code> {t('impresoras.puertoB')}</span>}
      </div>
      {est.error && <div className="imp-err">❌ {est.error}</div>}
      {msg && <div className={'adm-msg' + (msg.startsWith('✅') ? ' ok' : ' warn')}>{msg}</div>}
      {pruebaOk && <div className={'adm-msg' + (pruebaOk.startsWith('✅') ? ' ok' : ' warn')}>{pruebaOk}</div>}
      <p className="adm-sub" style={{ margin: 0 }}>
        {t('impresoras.notaSilenciosa', { boton: t('pedido.enviarCocina') })}
      </p>
    </div>
  )
}
