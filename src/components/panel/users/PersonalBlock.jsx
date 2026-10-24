import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import Ventana from '../../ui/Ventana.jsx'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import { olvidarTrabajadores } from '../../../services/trabajadores.js'
import '../../../styles/admin.css'
import './UsersPage.css'

// Personal sin acceso: gente de la empresa (limpieza, ayudantes...) que no entra a la app pero puede
// recibir cuentas por cobrar. Vive dentro de Equipo, debajo de quienes sí entran.
export default function PersonalBlock() {
  const { s, d, modo } = useStore()
  const { tOr } = useIdioma()
  const enBase = modo === 'supabase'
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [form, setForm] = useState({ nombre: '', cargo: '' })
  const [validando, setValidando] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmaId, setConfirmaId] = useState(null)
  const [quitandoId, setQuitandoId] = useState(null)
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const lista = enBase ? filas : (s.personalDemo || [])

  const cargar = async () => {
    if (!enBase) return
    setCargando(true); setError('')
    try {
      const r = await rpc('personal_listar', {})
      setFilas(Array.isArray(r) ? r : [])
    } catch (e) { setError(mensajeError(e)) } finally { setCargando(false) }
  }
  useEffect(() => { cargar() }, [enBase])

  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setValidando('') }

  const anadir = async e => {
    e.preventDefault()
    if (enviando) return
    const nombre = form.nombre.trim()
    if (!nombre) { setValidando(tOr('personal.faltaNombre', 'Escribe el nombre de la persona.')); return }
    setEnviando(true); setError(''); setAviso('')
    try {
      if (enBase) {
        await rpc('personal_guardar', { p_nombre: nombre, p_cargo: form.cargo.trim() })
        olvidarTrabajadores()
        await cargar()
      } else d({ t: 'personal+', nombre, cargo: form.cargo.trim() })
      setForm({ nombre: '', cargo: '' })
      setAbierto(false)
      setAviso(tOr('personal.altaOk', 'Listo: ya aparece en «Cargar a» de las cuentas por cobrar.'))
    } catch (err) { setError(mensajeError(err)) } finally { setEnviando(false) }
  }

  const quitar = async p => {
    if (quitandoId) return
    setQuitandoId(p.id); setError(''); setAviso('')
    try {
      if (enBase) {
        await rpc('personal_guardar', { p_id: p.id, p_nombre: p.nombre, p_cargo: p.cargo || '', p_activo: false })
        olvidarTrabajadores()
        await cargar()
      } else d({ t: 'personal-', id: p.id })
      setAviso(tOr('personal.quitadoOk', 'Quitado. Sus cuentas por cobrar anteriores se conservan.'))
    } catch (err) { setError(mensajeError(err)) } finally { setQuitandoId(null); setConfirmaId(null); clearTimeout(timerRef.current) }
  }
  const pulsarQuitar = p => {
    clearTimeout(timerRef.current)
    if (confirmaId === p.id) { quitar(p); return }
    setConfirmaId(p.id)
    timerRef.current = setTimeout(() => setConfirmaId(null), 4000)
  }

  return (
    <section className="adm-card adm-equipo eq-bloque eq-personal">
      <div className="adm-card-cab">
        <h3>{tOr('personal.titulo', 'Personal sin acceso')}</h3>
        <span className="adm-chip">{lista.length}</span>
        <span className="sp" />
        <span className="cab-acciones">
          <button type="button" className="success" onClick={() => { setError(''); setAviso(''); setValidando(''); setAbierto(true) }}>
            ＋ {tOr('personal.anadir', 'Añadir')}
          </button>
        </span>
      </div>
      <p className="adm-sub eq-nota">{tOr('personal.subtitulo', 'Personas de la empresa que no entran a la app (limpieza, ayudantes…). Se les puede cargar cuentas por cobrar.')}</p>

      {error && <div className="eq-error" role="alert">⚠️ {error}
        {enBase && <button type="button" className="ghost" disabled={cargando} onClick={cargar}>{tOr('equipo.reintentar', 'Reintentar')}</button>}</div>}
      {aviso && <div className="eq-ok">✅ {aviso}</div>}

      {lista.length > 0 ? (
        <div className="eq-lista">
          {lista.map(p => {
            const preguntando = confirmaId === p.id
            return (
              <div key={p.id} className="eq-fila eq-fila-personal">
                <span className="eq-nombre">{p.nombre}</span>
                <span className="eq-correo">{p.cargo || tOr('personal.sinCargo', 'Sin cargo')}</span>
                <div className="eq-acciones">
                  <button type="button" className={'eq-quitar' + (preguntando ? ' preguntando' : '')} disabled={Boolean(quitandoId)} onClick={() => pulsarQuitar(p)}>
                    {quitandoId === p.id ? tOr('equipo.quitar.haciendo', 'Quitando…') : preguntando ? tOr('equipo.quitar.pregunta', '¿Seguro?') : tOr('equipo.quitar', 'Quitar')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (!error && <div className="adm-vacio">{cargando ? tOr('equipo.cargando', 'Cargando…') : tOr('personal.vacio', 'Todavía no hay personal sin acceso.')}</div>)}

      {abierto && (
        <Ventana titulo={tOr('personal.nuevo', 'Añadir persona al personal')} onCerrar={() => setAbierto(false)}>
          <form className="eq-invitar" onSubmit={anadir}>
            <div className="eq-campos">
              <label className="adm-campo">
                <span>{tOr('personal.nombre', 'Nombre')}</span>
                <input name="personal-nombre" autoFocus maxLength={80} value={form.nombre} onChange={set('nombre')} autoComplete="off"
                  placeholder={tOr('personal.nombrePista', 'p. ej. Rosa Mamani')} />
              </label>
              <label className="adm-campo">
                <span>{tOr('personal.cargo', 'Cargo (opcional)')}</span>
                <input name="personal-cargo" maxLength={60} value={form.cargo} onChange={set('cargo')} autoComplete="off"
                  placeholder={tOr('personal.cargoPista', 'p. ej. Limpieza')} />
              </label>
            </div>
            <div className="adm-fila">
              <button type="submit" className="primary" disabled={enviando}>{enviando ? tOr('personal.guardando', 'Guardando…') : tOr('personal.guardar', 'Añadir al personal')}</button>
              <button type="button" className="ghost" onClick={() => setAbierto(false)} disabled={enviando}>{tOr('equipo.cancelar', 'Cancelar')}</button>
              {validando && <span className="adm-msg warn">{validando}</span>}
            </div>
            <p className="eq-ayuda">{tOr('personal.ayuda', 'No necesitan correo ni clave: no pueden entrar a la app.')}</p>
          </form>
        </Ventana>
      )}
    </section>
  )
}
