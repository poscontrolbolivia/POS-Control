import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../../context/StoreContext.jsx'
import { useIdioma } from '../../../i18n/index.jsx'
import Ventana from '../../ui/Ventana.jsx'
import { rpc, mensajeError } from '../../../services/supabaseClient.js'
import { gruposDeComanda } from '../../../services/printing.js'
import '../../../styles/admin.css'
import './UsersPage.css'

const ROLES = ['admin', 'cajero', 'mesero', 'cocina', 'barra']

const ROL_ETIQUETA = { admin: 'Administrador', cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina', barra: 'Barra' }

const ROL_INLINE = { cocina: { background: 'var(--rol-cocina)', color: 'var(--on-btn)' }, barra: { background: 'var(--rol-barra)', color: 'var(--on-btn)' } }
// Permisos de inventario que el admin puede dar a otras personas (el admin ya los tiene).
const PERMISOS_INV = [
  { id: 'ver_inventario', clave: 'equipo.perm.ver', def: 'Ver inventario' },
  { id: 'gestionar_inventario', clave: 'equipo.perm.gestionar', def: 'Gestionar inventario' },
]
const rolEtiqueta = (rol, tOr) => (rol ? tOr('rol.' + rol, ROL_ETIQUETA[rol] || rol) : '—')
const MIN_CLAVE = 4
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const CONSONANTES = 'bcdfghjklmnprstvz'
const VOCALES = 'aeiou'
const azar = max => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint32Array(1)
    crypto.getRandomValues(b)
    return b[0] % max
  }
  return Math.floor(Math.random() * max)
}
const generarClave = () => {
  let clave = ''
  for (let i = 0; i < 3; i++) clave += CONSONANTES[azar(CONSONANTES.length)] + VOCALES[azar(VOCALES.length)]
  return clave + String(azar(90) + 10)
}

const textoError = (err, tOr) => {
  const crudo = mensajeError(err)
  if (crudo.includes('equipo_correo_tomado')) return tOr('equipo.correoTomado', 'Ese correo ya está en tu equipo.')
  return crudo
}

const IDIOMA_LOCALE = { es: 'es', en: 'en-GB', pt: 'pt-BR' }

function fecha(iso, idiom) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(IDIOMA_LOCALE[idiom] || 'es', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function EquipoFilaColapsada({ n, error, onToggle, tOr }) {
  return (
    <div className="adm-fila">
      <button type="button" className="ghost eq-toggle" onClick={onToggle}>👥 {tOr('equipo.mostrar', 'Mostrar equipo')}</button>
      <span className="adm-chip">{n} {n === 1 ? tOr('equipo.una', 'persona') : tOr('equipo.varias', 'personas')}</span>
      {error && <span className="adm-chip" title={error}>⚠️ {tOr('equipo.error', 'Error al cargar el equipo')}</span>}
    </div>
  )
}

export default function UsersPage({ rol, sesion, abierto = true, onToggleAbierto = () => {} }) {
  const { s: tienda, modo } = useStore()
  const { tOr, idiom } = useIdioma()
  const gruposC = gruposDeComanda(tienda?.config)

  const [miembros, setMiembros] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [form, setForm] = useState({ nombre: '', correo: '', rol: 'cajero', clave: '' })
  // Invitar vive en una ventana que abre un botón de la cabecera: al final de la lista el formulario
  // quedaba fuera de la pantalla cuando el equipo ya tenía gente.
  const [invita, setInvita] = useState(false)
  const [validando, setValidando] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [claveFila, setClaveFila] = useState(null)
  const [claveMsg, setClaveMsg] = useState('')
  const [guardandoClave, setGuardandoClave] = useState(false)
  const [quitandoId, setQuitandoId] = useState(null)
  const [confirmaId, setConfirmaId] = useState(null)
  const timerRef = useRef(null)

  const esAdmin = rol === 'admin'
  const enBase = modo === 'supabase'

  const ocupado = enviando || guardandoClave || Boolean(quitandoId)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const cargar = async (silenciosa = false) => {
    if (!silenciosa) setCargando(true)
    setError('')
    try {

      const filas = await rpc('equipo_listar', {}, { conEmpresa: false })
      setMiembros(Array.isArray(filas) ? filas : [])
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    if (esAdmin && enBase) cargar()

  }, [esAdmin, enBase])

  if (!esAdmin) return null

  if (!enBase) return <EquipoDemo sesion={sesion} abierto={abierto} onToggleAbierto={onToggleAbierto} />

  if (!abierto) {
    return <EquipoFilaColapsada n={miembros.length} error={error} onToggle={onToggleAbierto} tOr={tOr} />
  }

  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setValidando('') }

  const validarInvitar = () => {
    if (!form.nombre.trim()) return tOr('equipo.faltaNombre', 'Escribe el nombre de la persona.')
    if (!form.correo.trim()) return tOr('equipo.faltaCorreo', 'Escribe el correo con el que va a entrar.')
    if (!CORREO_OK.test(form.correo.trim())) return tOr('equipo.correoInvalido', 'Ese correo no tiene un formato válido.')
    if (form.clave.length < MIN_CLAVE) return tOr('equipo.claveCorta', 'La clave inicial necesita al menos 4 caracteres.')
    return ''
  }

  const invitar = async e => {
    e.preventDefault()
    if (ocupado) return
    const problema = validarInvitar()
    if (problema) { setValidando(problema); return }
    setValidando(''); setAviso(''); setError(''); setEnviando(true)
    try {
      await rpc('equipo_invitar', {
        p_nombre: form.nombre.trim(),
        p_correo: form.correo.trim().toLowerCase(),
        p_rol: form.rol,
        p_clave: form.clave,
      }, { conEmpresa: false })
      setForm(f => ({ nombre: '', correo: '', rol: f.rol, clave: '' }))
      setInvita(false)
      setAviso(tOr('equipo.altaOk', 'Listo: esa persona ya puede entrar con su correo y la clave inicial.'))
      await cargar(true)
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setEnviando(false)
    }
  }

  const abrirClave = m => {
    setAviso(''); setError(''); setClaveMsg('')
    setClaveFila(c => (c && c.usuarioId === m.usuario_id ? null : { usuarioId: m.usuario_id, nombre: m.nombre || m.correo, clave: generarClave() }))
    setGuardandoClave(false)
  }
  const guardarClave = async e => {
    e.preventDefault()
    if (!claveFila || ocupado) return
    if (claveFila.clave.length < MIN_CLAVE) { setClaveMsg(tOr('equipo.claveCorta', 'La clave inicial necesita al menos 4 caracteres.')); return }
    setError(''); setClaveMsg(''); setAviso(''); setGuardandoClave(true)
    try {
      await rpc('equipo_restablecer', { p_usuario_id: claveFila.usuarioId, p_clave: claveFila.clave }, { conEmpresa: false })
      setAviso(tOr('equipo.claveOk', 'Clave cambiada: comunícala a esa persona.'))
      setClaveFila(null)
      await cargar(true)
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setGuardandoClave(false)
    }
  }

  const alternarPermiso = async (m, id) => {
    if (ocupado) return
    const actual = Array.isArray(m.permisos) ? m.permisos : []
    const nuevos = actual.includes(id) ? actual.filter(x => x !== id) : [...actual, id]
    setAviso(''); setError('')
    try {
      await rpc('equipo_poner_permisos', { p_usuario_id: m.usuario_id, p_permisos: nuevos }, { conEmpresa: false })
      setAviso(tOr('equipo.perm.guardado', 'Permisos actualizados.'))
      await cargar(true)
    } catch (err) { setError(textoError(err, tOr)) }
  }

  const alternarArea = async (m, id) => {
    if (ocupado) return
    const actual = Array.isArray(m.areas) ? m.areas : []
    const nuevas = actual.includes(id) ? actual.filter(x => x !== id) : [...actual, id]
    setAviso(''); setError('')
    try {
      await rpc('equipo_poner_areas', { p_usuario_id: m.usuario_id, p_areas: nuevas }, { conEmpresa: false })
      setAviso(tOr('equipo.areas.guardado', 'Áreas actualizadas.'))
      await cargar(true)
    } catch (err) { setError(textoError(err, tOr)) }
  }

  const quitar = async m => {
    if (ocupado) return
    setAviso(''); setError(''); setQuitandoId(m.usuario_id)
    try {
      await rpc('equipo_revocar', { p_usuario_id: m.usuario_id }, { conEmpresa: false })
      setAviso(tOr('equipo.revocadoOk', 'Esa persona ya no puede entrar.'))
      await cargar(true)
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setQuitandoId(null)
      setConfirmaId(null)
      clearTimeout(timerRef.current)
    }
  }

  const pulsarQuitar = m => {
    clearTimeout(timerRef.current)
    if (confirmaId === m.usuario_id) { quitar(m); return }
    setConfirmaId(m.usuario_id)
    setClaveFila(c => (c && c.usuarioId === m.usuario_id ? null : c))
    timerRef.current = setTimeout(() => setConfirmaId(null), 4000)
  }

  return (
    <section className="adm-card adm-equipo eq-bloque">
      <div className="adm-card-cab">
        <button type="button" className="ghost eq-toggle" onClick={onToggleAbierto}>👥 {tOr('equipo.ocultar', 'Ocultar equipo')}</button>
        <h3>{tOr('equipo.titulo', 'Equipo')}</h3>
        <span className="adm-chip">{miembros.length} {miembros.length === 1 ? tOr('equipo.una', 'persona') : tOr('equipo.varias', 'personas')}</span>
        <span className="sp" />
        <span className="cab-acciones">
          <button type="button" className="success" disabled={ocupado}
            onClick={() => { setError(''); setAviso(''); setValidando(''); setInvita(true) }}>
            ＋ {tOr('equipo.invitar.boton', 'Invitar')}
          </button>
          <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>
            {cargando ? tOr('equipo.cargando', 'Cargando…') : tOr('equipo.actualizar', 'Actualizar')}
          </button>
        </span>
      </div>
      <p className="adm-sub eq-nota">
        {tOr('equipo.subtitulo', 'Las personas de esta lista entran a')} <b>{sesion?.empresa || tOr('equipo.tuNegocio', 'tu negocio')}</b>{' '}
        {tOr('equipo.subtitulo2', 'con su correo y su clave. Cambia la clave si la olvidó y quítala cuando se vaya.')}
      </p>

      {error && (
        <div className="eq-error" role="alert">
          ⚠️ {error}
          <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>{tOr('equipo.reintentar', 'Reintentar')}</button>
        </div>
      )}
      {aviso && <div className="eq-ok">✅ {aviso}</div>}

      {cargando && miembros.length === 0
        ? <div className="adm-vacio">{tOr('equipo.consultando', 'Consultando el equipo…')}</div>
        : miembros.length
          ? (
            <div className="eq-lista">
              <div className="eq-cab">
                <span>{tOr('equipo.colPersona', 'Persona')}</span>
                <span>{tOr('equipo.colCorreo', 'Correo')}</span>
                <span>{tOr('equipo.colRol', 'Rol')}</span>
                <span>{tOr('equipo.colAlta', 'Alta')}</span>
                <span className="eq-cab-acciones">{tOr('equipo.colAcciones', 'Acciones')}</span>
              </div>
              {miembros.map(m => {
                const enClave = claveFila?.usuarioId === m.usuario_id
                const preguntando = confirmaId === m.usuario_id
                return (
                  <div key={m.usuario_id} className="eq-fila">
                    <div className="eq-cab-movil">{tOr('equipo.colPersona', 'Persona')}</div>
                    <div className="eq-persona">
                      <span className="eq-nombre">{m.nombre || tOr('equipo.sinNombre', 'sin nombre')}</span>
                      {(m.rol === 'cocina' || m.rol === 'barra') && gruposC.length > 0 && (
                        <div className="eq-areas" role="group" aria-label={tOr('equipo.areas.titulo', 'Áreas que ve')}>
                          {gruposC.map(g => {
                            const on = Array.isArray(m.areas) && m.areas.includes(g.id)
                            return <button key={g.id} type="button" className={'eq-area' + (on ? ' on' : '')} aria-pressed={on} disabled={ocupado} onClick={() => alternarArea(m, g.id)}>{g.nombre}</button>
                          })}
                          {!(Array.isArray(m.areas) && m.areas.length) && <small className="eq-areas-todas">{tOr('equipo.areas.todas', 'Todas las áreas')}</small>}
                        </div>
                      )}
                      {m.rol !== 'admin' && (
                        <div className="eq-areas" role="group" aria-label={tOr('equipo.perm.titulo', 'Permisos de inventario')}>
                          {PERMISOS_INV.map(p => {
                            const on = Array.isArray(m.permisos) && m.permisos.includes(p.id)
                            return <button key={p.id} type="button" className={'eq-area' + (on ? ' on' : '')} aria-pressed={on} disabled={ocupado} onClick={() => alternarPermiso(m, p.id)}>{tOr(p.clave, p.def)}</button>
                          })}
                        </div>
                      )}
                    </div>
                    <div className="eq-celda">
                      <span className="eq-cab-movil">{tOr('equipo.colCorreo', 'Correo')}</span>
                      <span className="eq-correo">{m.correo}</span>
                    </div>
                    <div className="eq-celda">
                      <span className="eq-cab-movil">{tOr('equipo.colRol', 'Rol')}</span>
                      <span className={'eq-rol eq-rol-' + (m.rol || 'otro')} style={ROL_INLINE[m.rol]}>{rolEtiqueta(m.rol, tOr)}</span>
                    </div>
                    <div className="eq-celda">
                      <span className="eq-cab-movil">{tOr('equipo.colAlta', 'Alta')}</span>
                      <span className="eq-alta">{fecha(m.creado_en, idiom)}</span>
                    </div>
                    <div className="eq-acciones">
                      <button type="button" className="ghost" disabled={ocupado} onClick={() => abrirClave(m)}>
                        {enClave ? tOr('equipo.clave.cerrar', 'Cerrar') : tOr('equipo.clave.abrir', 'Nueva clave')}
                      </button>
                      <button type="button"
                        className={'eq-quitar' + (preguntando ? ' preguntando' : '')}
                        disabled={ocupado}
                        onClick={() => pulsarQuitar(m)}>
                        {quitandoId === m.usuario_id
                          ? tOr('equipo.quitar.haciendo', 'Quitando…')
                          : preguntando
                            ? tOr('equipo.quitar.pregunta', '¿Seguro?')
                            : tOr('equipo.quitar', 'Quitar')}
                      </button>
                    </div>

                    {enClave && (
                      <form className="eq-clave" onSubmit={guardarClave}>
                        <b className="eq-clave-titulo">{tOr('equipo.clave.titulo', 'Nueva clave para')} <span className="eq-clave-nombre">{claveFila.nombre}</span></b>
                        <div className="eq-clave-fila">
                          <input name="pista" autoFocus type="text" value={claveFila.clave} autoComplete="new-password"
                            placeholder={tOr('equipo.clave.pista', 'mínimo 4 caracteres')}
                            onChange={e => { setClaveFila(c => ({ ...c, clave: e.target.value })); setClaveMsg('') }} />
                          <button type="button" className="ghost" onClick={() => setClaveFila(c => ({ ...c, clave: generarClave() }))}>
                            {tOr('equipo.generar', 'Generar')}
                          </button>
                        </div>
                        {claveMsg && <span className="adm-msg warn">{claveMsg}</span>}
                        <div className="adm-fila">
                          <button type="submit" className="primary" disabled={ocupado}>
                            {guardandoClave ? tOr('equipo.clave.guardando', 'Guardando…') : tOr('equipo.clave.guardar', 'Guardar la clave')}
                          </button>
                          <button type="button" onClick={() => { setClaveFila(null); setClaveMsg('') }} disabled={guardandoClave}>
                            {tOr('equipo.cancelar', 'Cancelar')}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          )
          : error
            ? null
            : <div className="adm-vacio">{tOr('equipo.vacio', 'Todavía no hay nadie más en el equipo. Invita a la primera persona abajo.')}</div>}

      {invita && (
        <Ventana titulo={tOr('equipo.invitar.titulo', 'Invitar a una persona')} onCerrar={() => setInvita(false)}>
          <form className="eq-invitar" onSubmit={invitar}>
            <div className="eq-campos">
              <label className="adm-campo">
                <span>{tOr('equipo.invitar.nombre', 'Nombre')}</span>
                <input name="nombre-pista" autoFocus value={form.nombre} onChange={set('nombre')} placeholder={tOr('equipo.invitar.nombrePista', 'p. ej. María Quispe')} autoComplete="off" />
              </label>
              <label className="adm-campo">
                <span>{tOr('equipo.invitar.correo', 'Correo')}</span>
                <input name="correo-pista" type="email" inputMode="email" value={form.correo} onChange={set('correo')}
                  placeholder={tOr('equipo.invitar.correoPista', 'maria@negocio.com')} autoComplete="off" />
              </label>
              <label className="adm-campo">
                <span>{tOr('equipo.invitar.rol', 'Rol')}</span>
                <select name="rol" value={form.rol} onChange={set('rol')}>
                  {ROLES.map(r => <option key={r} value={r}>{rolEtiqueta(r, tOr)}</option>)}
                </select>
              </label>
              <label className="adm-campo">
                <span>{tOr('equipo.invitar.clave', 'Clave inicial')}</span>
                <span className="eq-clave-fila">
                  <input name="pista" type="text" value={form.clave} onChange={set('clave')} autoComplete="new-password"
                    placeholder={tOr('equipo.clave.pista', 'mínimo 4 caracteres')} />
                  <button type="button" className="ghost" onClick={() => { setForm(f => ({ ...f, clave: generarClave() })); setValidando('') }}>
                    {tOr('equipo.generar', 'Generar')}
                  </button>
                </span>
              </label>
            </div>
            <div className="adm-fila">
              <button type="submit" className="primary" disabled={ocupado || cargando}>
                {enviando ? tOr('equipo.invitar.enviando', 'Invitando…') : tOr('equipo.invitar.enviar', 'Invitar al equipo')}
              </button>
              <button type="button" className="ghost" onClick={() => setInvita(false)} disabled={enviando}>{tOr('equipo.cancelar', 'Cancelar')}</button>
              {validando && <span className="adm-msg warn">{validando}</span>}
            </div>
            <p className="eq-ayuda">
              {tOr('equipo.invitar.ayuda', 'Se invita con la clave que escribas aquí: el rol decide qué puede hacer en la app (admin manda en todo, cajero cobra, mesero toma pedidos). La base rechaza correos repetidos y no deja quitar el último admin.')}
            </p>
          </form>
        </Ventana>
      )}
    </section>
  )
}

function EquipoDemo({ sesion, abierto = true, onToggleAbierto = () => {} }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const usuarios = s.usuariosDemo || []
  const [form, setForm] = useState({ nombre: '', usuario: '', rol: 'cajero', clave: '' })
  const [invita, setInvita] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [claveFila, setClaveFila] = useState(null)
  const [confirma, setConfirma] = useState(null)
  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setError('') }
  const admins = usuarios.filter(u => u.rol === 'admin').length

  const invitar = e => {
    e.preventDefault()
    const usuario = form.usuario.trim()
    if (!form.nombre.trim()) return setError(tOr('equipo.faltaNombre', 'Escribe el nombre de la persona.'))
    if (!usuario) return setError(t('equipo.faltaUsuario'))
    if (usuarios.some(u => u.usuario.toLowerCase() === usuario.toLowerCase())) return setError(t('equipo.usuarioTomado'))
    if (form.clave.length < MIN_CLAVE) return setError(tOr('equipo.claveCorta', 'La clave inicial necesita al menos 4 caracteres.'))
    d({ t: 'usuario+', usuario: { usuario, nombre: form.nombre.trim(), rol: form.rol, clave: form.clave } })
    setForm(f => ({ nombre: '', usuario: '', rol: f.rol, clave: '' }))
    setInvita(false)
    setAviso(t('equipo.altaOkUsuario'))
  }
  const guardarClave = e => {
    e.preventDefault()
    if (claveFila.clave.length < MIN_CLAVE) return setError(tOr('equipo.claveCorta', 'La clave inicial necesita al menos 4 caracteres.'))
    d({ t: 'usuario~', usuario: claveFila.usuario, cambios: { clave: claveFila.clave } })
    setClaveFila(null); setAviso(tOr('equipo.claveOk', 'Clave cambiada: comunícala a esa persona.'))
  }
  const quitar = u => {
    if (u.usuario === sesion?.usuario) return setError(t('equipo.noTeQuites'))
    if (u.rol === 'admin' && admins <= 1) return setError(t('equipo.ultimoAdmin'))
    if (confirma !== u.usuario) { setConfirma(u.usuario); setTimeout(() => setConfirma(c => (c === u.usuario ? null : c)), 4000); return }
    d({ t: 'usuario-', usuario: u.usuario }); setConfirma(null); setAviso(tOr('equipo.revocadoOk', 'Esa persona ya no puede entrar.'))
  }

  if (!abierto) return <EquipoFilaColapsada n={usuarios.length} onToggle={onToggleAbierto} tOr={tOr} />

  return (
    <section className="adm-card adm-equipo eq-bloque">
      <div className="adm-card-cab">
        <button type="button" className="ghost eq-toggle" onClick={onToggleAbierto}>👥 {tOr('equipo.ocultar', 'Ocultar equipo')}</button>
        <h3>{tOr('equipo.titulo', 'Equipo')}</h3>
        <span className="adm-chip">{usuarios.length}</span>
        <span className="sp" />
        <span className="cab-acciones">
          <button type="button" className="success" onClick={() => { setError(''); setAviso(''); setInvita(true) }}>＋ {tOr('equipo.invitar.boton', 'Invitar')}</button>
        </span>
      </div>
      <p className="adm-sub eq-nota">{t('equipo.demoNota')}</p>
      {error && <div className="eq-error" role="alert">⚠️ {error}</div>}
      {aviso && <div className="eq-ok">✅ {aviso}</div>}
      <div className="eq-lista">
        {usuarios.map(u => (
          <div key={u.usuario} className="eq-fila">
            <div className="eq-persona">
              <span className="eq-nombre">{u.nombre}</span>
              {u.rol !== 'admin' && (
                <div className="eq-areas" role="group" aria-label={tOr('equipo.perm.titulo', 'Permisos de inventario')}>
                  {PERMISOS_INV.map(p => {
                    const act = Array.isArray(u.permisos) ? u.permisos : []
                    const on = act.includes(p.id)
                    return <button key={p.id} type="button" className={'eq-area' + (on ? ' on' : '')} aria-pressed={on}
                      onClick={() => d({ t: 'usuario~', usuario: u.usuario, cambios: { permisos: on ? act.filter(x => x !== p.id) : [...act, p.id] } })}>{tOr(p.clave, p.def)}</button>
                  })}
                </div>
              )}
            </div>
            <div className="eq-celda"><span className="eq-correo">{u.usuario}</span></div>
            <div className="eq-celda"><span className={'eq-rol eq-rol-' + u.rol} style={ROL_INLINE[u.rol]}>{rolEtiqueta(u.rol, tOr)}</span></div>
            <div className="eq-celda" />
            <div className="eq-acciones">
              <button type="button" className="ghost" onClick={() => { setError(''); setClaveFila(c => (c?.usuario === u.usuario ? null : { usuario: u.usuario, clave: generarClave() })) }}>
                {tOr('equipo.clave.abrir', 'Nueva clave')}
              </button>
              <button type="button" className={confirma === u.usuario ? 'danger solid' : 'danger'} onClick={() => quitar(u)}>
                {confirma === u.usuario ? tOr('equipo.quitar.pregunta', '¿Seguro?') : tOr('equipo.quitar', 'Quitar')}
              </button>
            </div>
            {claveFila?.usuario === u.usuario && (
              <form className="eq-clave" onSubmit={guardarClave}>
                <div className="eq-clave-fila">
                  <input name="clave" autoFocus type="text" value={claveFila.clave} autoComplete="new-password" onChange={e => setClaveFila(c => ({ ...c, clave: e.target.value }))} />
                  <button type="button" className="ghost" onClick={() => setClaveFila(c => ({ ...c, clave: generarClave() }))}>{tOr('equipo.generar', 'Generar')}</button>
                </div>
                <div className="adm-fila">
                  <button type="submit" className="success">{tOr('equipo.clave.guardar', 'Guardar la clave')}</button>
                  <button type="button" className="danger" onClick={() => setClaveFila(null)}>{tOr('equipo.cancelar', 'Cancelar')}</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
      {invita && (
        <Ventana titulo={tOr('equipo.invitar.titulo', 'Invitar a una persona')} onCerrar={() => setInvita(false)}>
          <form className="eq-invitar" onSubmit={invitar}>
            <div className="eq-campos">
              <label className="adm-campo"><span>{tOr('equipo.invitar.nombre', 'Nombre')}</span><input name="nombre" autoFocus value={form.nombre} onChange={set('nombre')} autoComplete="off" /></label>
              <label className="adm-campo"><span>{t('equipo.invitar.usuario')}</span><input name="usuario" value={form.usuario} onChange={set('usuario')} autoComplete="off" /></label>
              <label className="adm-campo"><span>{tOr('equipo.invitar.rol', 'Rol')}</span>
                <select name="rol" value={form.rol} onChange={set('rol')}>{ROLES.map(r => <option key={r} value={r}>{rolEtiqueta(r, tOr)}</option>)}</select>
              </label>
              <label className="adm-campo"><span>{tOr('equipo.invitar.clave', 'Clave inicial')}</span>
                <span className="eq-clave-fila">
                  <input name="clave" type="text" value={form.clave} onChange={set('clave')} autoComplete="new-password" />
                  <button type="button" className="ghost" onClick={() => setForm(f => ({ ...f, clave: generarClave() }))}>{tOr('equipo.generar', 'Generar')}</button>
                </span>
              </label>
            </div>
            <div className="adm-fila">
              <button type="submit" className="success">{tOr('equipo.invitar.enviar', 'Invitar al equipo')}</button>
              <button type="button" className="ghost" onClick={() => setInvita(false)}>{tOr('equipo.cancelar', 'Cancelar')}</button>
            </div>
            <p className="eq-ayuda">{t('equipo.demoNota')}</p>
          </form>
        </Ventana>
      )}
    </section>
  )
}
