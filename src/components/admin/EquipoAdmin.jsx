// Gestión del equipo del negocio (solo rol admin): listar personas, invitar con clave inicial,
// restablecer una clave olvidada y quitar el acceso.
// Habla SOLO con las RPCs de la migración 004 (equipo_listar / equipo_invitar /
// equipo_restablecer / equipo_revocar), todas con p_empresa_id (rpc() lo inyecta) y todas con
// permiso validado en la base: aquí el rol solo decide si la pantalla se muestra.
// Sin diálogos nativos (alert/confirm/prompt bloquean la pestaña en browsers embebidos):
// las confirmaciones y los errores se pintan en pantalla.
// Props: { rol, sesion }
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../services/store.jsx'
import { useIdioma } from '../../i18n/index.jsx'
import { rpc, mensajeError } from '../../services/supabase.js'
import './admin.css'      // clases .adm-* del área de administración (las comparte con ConfigAdmin)
import './EquipoAdmin.css'

// Roles tal y como los guarda la base (escritos en español). La etiqueta visible pasa por
// tOr('rol.' + rol, ...): admin/cajero/mesero ya tienen clave en los tres diccionarios;
// cocina y barra llegan con su literal en español hasta que el carril de i18n las añada.
const ROLES = ['admin', 'cajero', 'mesero', 'cocina', 'barra']
// Fallback legible del rol cuando 'rol.*' aún no está en los diccionarios.
const ROL_ETIQUETA = { admin: 'Administrador', cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina', barra: 'Barra' }
// El badge se colorea con la clase .eq-rol-<rol> (EquipoAdmin.css). Esa hoja aún no tiene
// clase para los roles nuevos, así que el color de cocina/barra va en línea (mismos
// colores planos de la paleta) para que no queden grises; el carril de CSS puede
// migrarlos a .eq-rol-cocina / .eq-rol-barra y entonces se borra este mapa.
const ROL_INLINE = { cocina: { background: '#b02a2a', color: '#fff' }, barra: { background: '#0e92a3', color: '#fff' } }
const rolEtiqueta = (rol, tOr) => (rol ? tOr('rol.' + rol, ROL_ETIQUETA[rol] || rol) : '—')
const MIN_CLAVE = 4 // mismo mínimo que exige la base; se valida aquí para no ir de vacío
const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Clave inicial pronunciable: tres sílabas consonante+vocal = 6 caracteres ("kanuseli").
// Es para entregarla en persona y cambiarla luego, no para memorizar un password de banco.
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
  return clave
}

// Los `raise exception` de Postgres llegan en error.message. Cuando el caso tiene prefijo
// conocido (equipo_correo_tomado) lo traducimos; el resto (p. ej. «no puedes quitarte a ti
// mismo» o «debe quedar al menos un admin») ya viene escrito en español por la base y se
// muestra tal cual: borrar esos mensajes dejaría al usuario sin el motivo real.
const textoError = (err, tOr) => {
  const crudo = mensajeError(err)
  if (crudo.includes('equipo_correo_tomado')) return tOr('equipo.correoTomado', 'Ese correo ya está en tu equipo.')
  return crudo
}

const IDIOMA_LOCALE = { es: 'es', en: 'en-GB', pt: 'pt-BR' }
// '2026-10-16T13:52:00Z' → '16/10/2026'. Fecha ausente o rara → '—' (nunca NaN en pantalla).
function fecha(iso, idiom) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(IDIOMA_LOCALE[idiom] || 'es', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Fila con la que se ve el bloque cuando está plegado (desde ConfigAdmin se alterna con
// abierto/onToggleAbierto, mismo patrón de "Configurar impresoras"): título + chip de
// cuántos hay + botón "Mostrar equipo". La usa tanto el modo base como el modo demo.
function EquipoFilaColapsada({ n, error, onToggle, tOr }) {
  return (
    <div className="adm-fila">
      <b>👥 {tOr('equipo.titulo', 'Equipo')}</b>
      <span className="adm-chip">{n} {n === 1 ? tOr('equipo.una', 'persona') : tOr('equipo.varias', 'personas')}</span>
      {error && <span className="adm-chip" title={error}>⚠️ {tOr('equipo.error', 'Error al cargar el equipo')}</span>}
      <span className="sp" />
      <button type="button" className="ghost" onClick={onToggle}>{tOr('equipo.mostrar', 'Mostrar equipo')}</button>
    </div>
  )
}

export default function EquipoAdmin({ rol, sesion, abierto = true, onToggleAbierto = () => {} }) {
  const { modo } = useStore()
  const { tOr, idiom } = useIdioma()

  const [miembros, setMiembros] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')       // fallo de lectura o de la última operación
  const [aviso, setAviso] = useState('')       // mensaje verde tras un alta/cambio
  const [form, setForm] = useState({ nombre: '', correo: '', rol: 'cajero', clave: '' })
  const [validando, setValidando] = useState('') // error de formulario (local, sin ida a la base)
  const [enviando, setEnviando] = useState(false)
  const [claveFila, setClaveFila] = useState(null)   // { usuarioId, nombre, clave } de la fila en edición
  const [claveMsg, setClaveMsg] = useState('')       // error local del campo de clave (no ensucia el global)
  const [guardandoClave, setGuardandoClave] = useState(false)
  const [quitandoId, setQuitandoId] = useState(null) // usuario_id cuya revocación está en vuelo
  const [confirmaId, setConfirmaId] = useState(null) // fila en «¿Seguro?» (confirmación en dos toques)
  const timerRef = useRef(null)                      // caducidad de la pregunta «¿Seguro?»

  const esAdmin = rol === 'admin'
  const enBase = modo === 'supabase'
  // Una mutación a la vez: mientras algo está en vuelo se bloquean los botones de escribir
  // (los de actualizar también, para no pisarse con el refresco posterior).
  const ocupado = enviando || guardandoClave || Boolean(quitandoId)

  // Se apaga la ventana de confirmación al desmontar (si no, el setTimeout avisaría a un
  // componente que ya no está en el árbol).
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const cargar = async (silenciosa = false) => {
    if (!silenciosa) setCargando(true)
    setError('')
    try {
      // conEmpresa:false ⇒ las cuatro RPCs de equipo no reciben p_empresa_id: la migración 004
      // lee la empresa con private.empresa_activa() (el GUC de la conexión anclada). Mandar el
      // parámetro haría que PostgREST no encontrara la firma y contestara «no existe la función».
      const filas = await rpc('equipo_listar', {}, { conEmpresa: false })
      setMiembros(Array.isArray(filas) ? filas : [])
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setCargando(false)
    }
  }

  // La lista se lee al montar (ya no "al hacerse visible": el bloque vive plegado pero
  // montado, y el chip de la fila plegada muestra ese conteo), no en cada tecla: el panel
  // de configuración se renderiza muchas veces mientras se escribe y equipo_listar es una consulta.
  useEffect(() => {
    if (esAdmin && enBase) cargar()
    // eslint-disable-next-line
  }, [esAdmin, enBase])

  if (!esAdmin) return null

  if (!enBase) return <EquipoDemo sesion={sesion} abierto={abierto} onToggleAbierto={onToggleAbierto} />

  // Plegado: solo la fila de resumen (el equipo_listar del montaje ya nos da el conteo del
  // chip; posponer la carga abriría un "cargando…" al desplegar — se eligió lo más simple).
  // Los hooks de arriba se llaman SIEMPRE: el plegado es un return condicional, no un hook.
  if (!abierto) {
    return <EquipoFilaColapsada n={miembros.length} error={error} onToggle={onToggleAbierto} tOr={tOr} />
  }

  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); setValidando('') }

  // ── Alta ──
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
      setAviso(tOr('equipo.altaOk', 'Listo: esa persona ya puede entrar con su correo y la clave inicial.'))
      await cargar(true) // siempre refrescamos: la lista la manda la base, nunca la inventamos local
    } catch (err) {
      setError(textoError(err, tOr))
    } finally {
      setEnviando(false)
    }
  }

  // ── Clave olvidada (campo inline, sin diálogo) ──
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

  // ── Revocar: dos toques (primer toque pregunta, el segundo ejecuta) ──
  const quitar = async m => {
    if (ocupado) return
    setAviso(''); setError(''); setQuitandoId(m.usuario_id)
    try {
      await rpc('equipo_revocar', { p_usuario_id: m.usuario_id }, { conEmpresa: false })
      setAviso(tOr('equipo.revocadoOk', 'Esa persona ya no puede entrar.'))
      await cargar(true)
    } catch (err) {
      setError(textoError(err, tOr)) // «no puedes quitarte a ti mismo» / «debe quedar un admin»
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
    timerRef.current = setTimeout(() => setConfirmaId(null), 4000) // la pregunta caduca sola
  }

  return (
    <section className="adm-card adm-equipo eq-bloque">
      <div className="adm-card-cab">
        <h3>{tOr('equipo.titulo', 'Equipo')}</h3>
        <span className="adm-chip">{miembros.length} {miembros.length === 1 ? tOr('equipo.una', 'persona') : tOr('equipo.varias', 'personas')}</span>
        <span className="sp" />
        <span className="cab-acciones">
          <button type="button" className="ghost" disabled={cargando || ocupado} onClick={() => cargar()}>
            {cargando ? tOr('equipo.cargando', 'Cargando…') : tOr('equipo.actualizar', 'Actualizar')}
          </button>
          <button type="button" className="ghost" onClick={onToggleAbierto}>{tOr('equipo.ocultar', 'Ocultar equipo')}</button>
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
                          <input autoFocus type="text" value={claveFila.clave} autoComplete="new-password"
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
            ? null // el aviso rojo de arriba ya explica el fallo: sin lista y sin duplicar el mensaje
            : <div className="adm-vacio">{tOr('equipo.vacio', 'Todavía no hay nadie más en el equipo. Invita a la primera persona abajo.')}</div>}

      {/* Alta: un formulario fijo, no un diálogo, para poder invitar desde el móvil sin perder la lista */}
      <form className="eq-invitar" onSubmit={invitar}>
        <h4 className="eq-invitar-titulo">{tOr('equipo.invitar.titulo', 'Invitar a una persona')}</h4>
        <div className="eq-campos">
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.nombre', 'Nombre')}</span>
            <input value={form.nombre} onChange={set('nombre')} placeholder={tOr('equipo.invitar.nombrePista', 'p. ej. María Quispe')} autoComplete="off" />
          </label>
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.correo', 'Correo')}</span>
            <input type="email" inputMode="email" value={form.correo} onChange={set('correo')}
              placeholder={tOr('equipo.invitar.correoPista', 'maria@negocio.com')} autoComplete="off" />
          </label>
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.rol', 'Rol')}</span>
            <select value={form.rol} onChange={set('rol')}>
              {ROLES.map(r => <option key={r} value={r}>{rolEtiqueta(r, tOr)}</option>)}
            </select>
          </label>
          <label className="adm-campo">
            <span>{tOr('equipo.invitar.clave', 'Clave inicial')}</span>
            <span className="eq-clave-fila">
              <input type="text" value={form.clave} onChange={set('clave')} autoComplete="new-password"
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
          {validando && <span className="adm-msg warn">{validando}</span>}
        </div>
        <p className="eq-ayuda">
          {tOr('equipo.invitar.ayuda', 'Se invita con la clave que escribas aquí: el rol decide qué puede hacer en la app (admin manda en todo, cajero cobra, mesero toma pedidos). La base rechaza correos repetidos y no deja quitar el último admin.')}
        </p>
      </form>
    </section>
  )
}

// Modo demo: los usuarios viven en el estado local (store.usuariosDemo) y son los que entran por el
// login de prueba. Mismas reglas que la base: usuario único, no quitarse a sí mismo, quedar un admin.
// Comparte con el modo base el plegado (abierto/onToggleAbierto desde ConfigAdmin).
function EquipoDemo({ sesion, abierto = true, onToggleAbierto = () => {} }) {
  const { s, d } = useStore()
  const { t, tOr } = useIdioma()
  const usuarios = s.usuariosDemo || []
  const [form, setForm] = useState({ nombre: '', usuario: '', rol: 'cajero', clave: '' })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [claveFila, setClaveFila] = useState(null) // { usuario, clave }
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
    setAviso(tOr('equipo.altaOk', 'Listo: esa persona ya puede entrar con su usuario y la clave inicial.'))
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

  // Plegado (mismo patrón que el modo base; los hooks de arriba se llaman siempre).
  if (!abierto) return <EquipoFilaColapsada n={usuarios.length} onToggle={onToggleAbierto} tOr={tOr} />

  return (
    <section className="adm-card adm-equipo eq-bloque">
      <div className="adm-card-cab">
        <h3>{tOr('equipo.titulo', 'Equipo')}</h3>
        <span className="adm-chip">{usuarios.length}</span>
        <span className="sp" />
        <button type="button" className="ghost" onClick={onToggleAbierto}>{tOr('equipo.ocultar', 'Ocultar equipo')}</button>
      </div>
      <p className="adm-sub eq-nota">{t('equipo.demoNota')}</p>
      {error && <div className="eq-error" role="alert">⚠️ {error}</div>}
      {aviso && <div className="eq-ok">✅ {aviso}</div>}
      <div className="eq-lista">
        {usuarios.map(u => (
          <div key={u.usuario} className="eq-fila">
            <div className="eq-persona"><span className="eq-nombre">{u.nombre}</span><span className="eq-correo">{u.usuario}</span></div>
            <div className="eq-celda"><span className={'eq-rol eq-rol-' + u.rol} style={ROL_INLINE[u.rol]}>{rolEtiqueta(u.rol, tOr)}</span></div>
            <div className="eq-celda" />
            <div className="eq-acciones">
              <button type="button" className="info" onClick={() => { setError(''); setClaveFila(c => (c?.usuario === u.usuario ? null : { usuario: u.usuario, clave: generarClave() })) }}>
                {tOr('equipo.clave.abrir', 'Nueva clave')}
              </button>
              <button type="button" className={confirma === u.usuario ? 'danger solid' : 'danger'} onClick={() => quitar(u)}>
                {confirma === u.usuario ? tOr('equipo.quitar.pregunta', '¿Seguro?') : tOr('equipo.quitar', 'Quitar')}
              </button>
            </div>
            {claveFila?.usuario === u.usuario && (
              <form className="eq-clave" onSubmit={guardarClave}>
                <div className="eq-clave-fila">
                  <input autoFocus type="text" value={claveFila.clave} autoComplete="new-password" onChange={e => setClaveFila(c => ({ ...c, clave: e.target.value }))} />
                  <button type="button" className="ghost" onClick={() => setClaveFila(c => ({ ...c, clave: generarClave() }))}>{tOr('equipo.generar', 'Generar')}</button>
                </div>
                <div className="adm-fila">
                  <button type="submit" className="success">{tOr('equipo.clave.guardar', 'Guardar la clave')}</button>
                  <button type="button" className="ghost" onClick={() => setClaveFila(null)}>{tOr('equipo.cancelar', 'Cancelar')}</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
      <form className="eq-invitar" onSubmit={invitar}>
        <h4 className="eq-invitar-titulo">{tOr('equipo.invitar.titulo', 'Invitar a una persona')}</h4>
        <div className="eq-campos">
          <label className="adm-campo"><span>{tOr('equipo.invitar.nombre', 'Nombre')}</span><input value={form.nombre} onChange={set('nombre')} autoComplete="off" /></label>
          <label className="adm-campo"><span>{t('equipo.invitar.usuario')}</span><input value={form.usuario} onChange={set('usuario')} autoComplete="off" /></label>
          <label className="adm-campo"><span>{tOr('equipo.invitar.rol', 'Rol')}</span>
            <select value={form.rol} onChange={set('rol')}>{ROLES.map(r => <option key={r} value={r}>{rolEtiqueta(r, tOr)}</option>)}</select>
          </label>
          <label className="adm-campo"><span>{tOr('equipo.invitar.clave', 'Clave inicial')}</span>
            <span className="eq-clave-fila">
              <input type="text" value={form.clave} onChange={set('clave')} autoComplete="new-password" />
              <button type="button" className="ghost" onClick={() => setForm(f => ({ ...f, clave: generarClave() }))}>{tOr('equipo.generar', 'Generar')}</button>
            </span>
          </label>
        </div>
        <div className="adm-fila"><button type="submit" className="success">{tOr('equipo.invitar.enviar', 'Invitar al equipo')}</button></div>
      </form>
    </section>
  )
}
