import { useIdioma } from '../../i18n/index.jsx'
import SelectorIdioma from '../../i18n/SelectorIdioma.jsx'
import './auth.css'

// Barra superior: empresa, usuario/rol, selector de módulo, selector de idioma y salida.
// Props: { sesion:{usuario,rol,nombre,empresa,es_super}, modulo, modulos, onModulo(id), onSalir, aviso }
// modulos: ['Salón', ...] o [{id, nombre}, ...] — las etiquetas ya llegan traducidas de App.jsx.
export default function Topbar({ sesion, modulo, modulos = [], onModulo, onSalir, aviso }) {
  const { t, tOr } = useIdioma()
  const items = modulos.map(m => (typeof m === 'string' ? { id: m, nombre: m } : m))
  const rol = (sesion?.rol || '').toLowerCase()
  const conectado = Boolean(sesion?.supabase)
  // El rol se guarda en la base en español ('admin', 'cajero', 'mesero'); se traduce solo
  // la etiqueta. Si llega un rol nuevo (p. ej. el de super administración) se muestra tal cual.
  const rolVisto = rol ? tOr('rol.' + rol, rol) : t('topbar.invitado')

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <div className="topbar-izq">
        <span className="topbar-empresa">🍽️ {sesion?.empresa || t('comun.miNegocio')}</span>
        <span className={`topbar-rol topbar-rol-${rol}`}>{rolVisto}</span>
        <span className="topbar-user" title={sesion?.usuario}>{sesion?.nombre || sesion?.usuario}</span>
        {sesion?.es_super && (
          <span className="topbar-rol" style={{ background: '#3b2f63', color: '#fff' }}
            title={tOr('super.topbar.chipTitle', 'Dueño de la plataforma')}>super</span>
        )}
        <span className="topbar-rol" title={conectado ? t('topbar.titleConectado') : t('topbar.titleDemo')}
          style={{ background: conectado ? '#1b7a43' : '#7a5b1b', color: '#fff', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
          {conectado ? t('topbar.conectado') : t('topbar.demo')}
        </span>
      </div>
      <nav className="topbar-mods">
        {items.map(m => (
          <button
            key={m.id}
            type="button"
            className={'topbar-tab' + (m.id === modulo ? ' on' : '')}
            onClick={() => onModulo?.(m.id)}
          >
            {m.nombre}
          </button>
        ))}
      </nav>
      {/*
        Selector de idioma (ES/EN/PT) siempre visible.
        `soloSuper` está a false porque el dueño pidió que por ahora cualquiera pueda cambiarlo.
        El panel de super YA está integrado (sesion.es_super lo pone esSuper() en el login),
        así que restringirlo es cambiar esta misma línea por:
            <SelectorIdioma soloSuper esSuper={Boolean(sesion?.es_super)} />
        Ver src/i18n/SelectorIdioma.jsx y docs/HANDOFF-IDIOMAS.md.
      */}
      <SelectorIdioma soloSuper={false} esSuper={Boolean(sesion?.es_super)} />
      <button type="button" className="topbar-salir" onClick={onSalir}>{t('topbar.salir')}</button>
      {aviso && (
        <div className="auth-error" role="alert" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, margin: 0, padding: '6px 16px' }}>
          {t('topbar.avisoBase', { aviso })}
        </div>
      )}
    </header>
  )
}
