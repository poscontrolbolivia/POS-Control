import { useCallback, useEffect, useState } from 'react'
import { haySesion, mensajeError } from '../../services/super/cliente.js'
import {
  descargarJson, empresaViendo, entrarEnEmpresa, esSuper, exportarEmpresa,
  hayCliente, listarEmpresas, registrarExporte, salirDeEmpresa, sondearAcceso,
} from '../../services/super/superApi.js'
import { useIdioma } from '../../i18n/index.jsx'
import SelectorIdioma from '../../i18n/SelectorIdioma.jsx'
import EmpresasTabla from './EmpresasTabla.jsx'
import ImportarBloque from './ImportarBloque.jsx'
import './super.css'

// Panel del dueño de la plataforma (SUPER ADMIN). Se monta cuando App.jsx tiene
// `modulo === 'super'` y solo si la sesión es de un super (ver docs/HANDOFF-SUPER.md).
// Props: { sesion } — sesión actual de la app ({ usuario, rol, nombre, empresa, es_super }).
// Todos los textos pasan por tOr('super.*', 'español'): se traducen cuando el carril i18n
// clave las entradas; hoy renderizan el español garantizado.
export default function SuperPage({ sesion }) {
  const { tOr } = useIdioma()
  // 'cargando' | 'super' | 'sin-sesion' | 'no-super' | 'sin-config'
  const [estado, setEstado] = useState('cargando')
  const [empresas, setEmpresas] = useState([])
  const [errorLista, setErrorLista] = useState('')
  const [op, setOp] = useState(null)           // { tipo: 'lista'|'exportar'|'entrar'|'salir', id }
  const [viendo, setViendo] = useState(() => empresaViendo())
  const [avisoAcceso, setAvisoAcceso] = useState('')

  const cargarLista = useCallback(async () => {
    setErrorLista('')
    try { setEmpresas(await listarEmpresas()) } catch (e) { setErrorLista(mensajeError(e)) }
  }, [])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!hayCliente()) { if (vivo) setEstado('sin-config'); return }
      if (!(await haySesion())) { if (vivo) setEstado('sin-sesion'); return }
      const superUsuario = await esSuper()
      if (!vivo) return
      setEstado(superUsuario ? 'super' : 'no-super')
      if (!superUsuario) return
      setOp({ tipo: 'lista' })
      await cargarLista()
      if (vivo) setOp(null)
    })()
    return () => { vivo = false }
  }, [cargarLista])

  const refrescar = async () => {
    setOp({ tipo: 'lista' })
    await cargarLista()
    setOp(null)
  }

  const exportar = async e => {
    setOp({ tipo: 'exportar', id: e.id })
    try {
      descargarJson(await exportarEmpresa(e.id), e.codigo || e.nombre)
      // Auditoría (migración 002_seguridad): registra la descarga en el log.
      // Si el aviso falla no puede deshacer una exportación correcta: solo lo dejamos en consola.
      try { await registrarExporte(e.id) } catch (aviso) { console.warn('super_registrar_exporte:', aviso?.message) }
    } catch (err) { setErrorLista(mensajeError(err)) } finally { setOp(null) }
  }

  const entrar = async e => {
    setOp({ tipo: 'entrar', id: e.id })
    setAvisoAcceso('')
    setErrorLista('')
    try {
      // fijar_empresa en la conexión anclada (X-Session-Id) + sesión 'operando' en el cliente.
      await entrarEnEmpresa({ id: e.id, nombre: e.nombre })
      setViendo(empresaViendo())
      // La lista ya nos dijo cuántas mesas tiene la empresa: si el sondeo lee menos, la
      // migración 002_seguridad aún no está aplicada (o el GUC se perdió) y lo avisamos
      // en pantalla en vez de dejar un salón vacío.
      const esperadas = Number(e.mesas || 0)
      if (esperadas > 0) {
        try {
          const leidas = await sondearAcceso(e.id)
          if (leidas < esperadas) {
            setAvisoAcceso(tOr('super.entrar.avisoAcceso',
              `Atención: el listado dice ${esperadas} mesas pero la app solo ve ${leidas}. Exportar e importar funcionan igual, pero para OPERAR esta empresa hace falta aplicar la migración supabase/migraciones/002_seguridad.sql (fijar_empresa para super).`))
          }
        } catch { /* el sondeo es informativo: si falla no bloqueamos la entrada a la empresa */ }
      }
      await cargarLista()
    } catch (err) { setErrorLista(mensajeError(err)) } finally { setOp(null) }
  }

  const salir = async () => {
    setOp({ tipo: 'salir' })
    const { previa, errorPin } = await salirDeEmpresa().catch(() => ({ previa: null, errorPin: '' }))
    setViendo(empresaViendo())
    setAvisoAcceso('')
    if (errorPin) setErrorLista(errorPin)
    if (!previa) setErrorLista(tOr('super.salir.sinAnterior', 'No encontramos la sesión anterior en este navegador: usa «Salir» del Topbar y vuelve a entrar.'))
    setOp(null)
    refrescar()
  }

  if (estado === 'cargando') {
    return <div className="super-envoltura"><div className="super-cargando" role="status">{tOr('super.cargando', 'Comprobando permisos de super administrador…')}</div></div>
  }

  if (estado !== 'super') {
    const textos = {
      'sin-config': tOr('super.sinConfig', 'El panel de super necesita una base de Supabase real (configura SUPABASE_URL y SUPABASE_ANON_KEY en src/config.js). En modo demo no hay empresas que gestionar.'),
      'sin-sesion': tOr('super.sinSesion', 'No hay sesión de Supabase iniciada. Entra con el correo del dueño de la plataforma y vuelve a abrir este panel.'),
      'no-super': tOr('super.noSuper', 'Este usuario no está en la tabla public.supers, así que la base le niega las funciones de super. Añade su user_id a public.supers para habilitarlo.'),
    }
    return (
      <div className="super-envoltura">
        <div className="super-error" role="alert">⚠️ {textos[estado]}</div>
        <button type="button" className="super-ghost" onClick={() => location.reload()}>{tOr('super.reintentar', 'Reintentar')}</button>
      </div>
    )
  }

  return (
    <div className="super-envoltura">
      <header className="super-cab">
        <h2>{tOr('super.titulo', 'Super administrador')}</h2>
        <span className="super-chip">{tOr('super.subtitulo', 'dueño de la plataforma')}</span>
        <span className="sp" />
        {/* El idioma de TODA la app se cambia aquí también: SelectorIdioma usa useIdioma() y
            persiste 'pos-idioma-app', la misma clave que ya lee el Topbar (no duplicar). */}
        <SelectorIdioma />
      </header>

      <p className="super-sub">
        {tOr('super.sesion', 'Sesión')}: <b>{sesion?.usuario || sesion?.nombre || '—'}</b> ·{' '}
        {tOr('super.sesionDetalle', 'todas las empresas de esta base, exportaciones completas e importaciones para que un cliente crezca de plan llevándose sus datos.')}
      </p>

      {/* Aviso permanente mientras se opera una empresa ajena */}
      {viendo && (
        <div className="super-aviso" role="status">
          <span>👁️ {tOr('super.entrar.viendo', 'Estás viendo la empresa')} <b>{viendo.nombre}</b>: {tOr('super.entrar.viendoDetalle', 'el salón, la caja y los tickets usan SUS datos.')}</span>
          <span className="sp" />
          <button type="button" className="super-ghost" style={{ color: '#ffe9a8', borderColor: '#8a6d1a' }} disabled={Boolean(op)} onClick={salir}>
            {tOr('super.entrar.salir', 'Salir')}
          </button>
        </div>
      )}
      {avisoAcceso && <div className="super-aviso-acceso">{avisoAcceso}</div>}

      <EmpresasTabla
        empresas={empresas}
        cargando={op?.tipo === 'lista'}
        error={errorLista}
        ocupado={Boolean(op)}
        onExportar={exportar}
        onEntrar={entrar}
        onRefrescar={refrescar}
      />

      <ImportarBloque ocupado={Boolean(op)} onEntrar={entrar} />

      <section className="panel super-bloque">
        <h3>{tOr('super.comoFunciona', 'Cómo funciona por dentro')}</h3>
        <p className="super-ayuda">
          {tOr('super.comoFuncionaTexto', 'Este panel solo llama a las RPCs security definer de las migraciones 001_super.sql y 002_seguridad.sql (es_super, super_listar_empresas, super_exportar_empresa, super_importar_empresa, fijar_empresa, super_ver_cuota, super_ajustar_empresa, super_registrar_exporte). La anon key del navegador no puede leer tablas de otras empresas: lo filtra RLS. Exportar descarga el snapshot jsonb completo; Importar lo recrea aquí con código nuevo y clave temporal para el equipo que no exista.')}
        </p>
      </section>
    </div>
  )
}
