import { useIdioma } from '../../i18n/index.jsx'
import { useEffect, useRef, useState } from 'react'
import BrandMark from '../login/BrandMark.jsx'
import '../../styles/auth.css'

export default function Topbar({ sesion, modulo, modulos = [], onModulo, onSalir, aviso }) {
  const { t, tOr } = useIdioma()

  const [abierto, setAbierto] = useState(() => typeof window === 'undefined' || window.innerWidth > 850)
  // La barra va pegada arriba (sticky) y mide su propio alto para que los menús que se pegan
  // debajo (Configuración) no queden tapados: --topbar-h lo consume SettingsPage.css.
  const barra = useRef(null)
  useEffect(() => {
    const el = barra.current
    if (!el || typeof window === 'undefined') return
    const publicar = () => document.documentElement.style.setProperty('--topbar-h', el.offsetHeight + 'px')
    publicar()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publicar) : null
    ro?.observe(el)
    window.addEventListener('resize', publicar)
    return () => { ro?.disconnect(); window.removeEventListener('resize', publicar) }
  }, [])
  const elegir = id => { onModulo?.(id); if (typeof window !== 'undefined' && window.innerWidth <= 850) setAbierto(false) }
  // El módulo «Menú» se muestra como «Ítems» para no chocar con la impresión (única en Configuración).
  const items = modulos
    .map(m => (typeof m === 'string' ? { id: m, nombre: m } : m))
    .map(m => ({ ...m, nombre: m.id === 'menu' ? tOr('nav.items', 'Ítems') : m.nombre }))
  const rol = (sesion?.rol || '').toLowerCase()
  const conectado = Boolean(sesion?.supabase)

  const actual = items.find(m => m.id === modulo)?.nombre
  const nAlertas = items.find(m => m.id === 'alertas')?.contador || 0
  const rolVisto = rol ? tOr('rol.' + rol, rol) : t('topbar.invitado')

  return (
    <header className="topbar" ref={barra}>
      <div className="topbar-izq">
        <span className="topbar-empresa"><BrandMark size={22} /> {sesion?.empresa || t('comun.miNegocio')}</span>
        {!abierto && actual && <span className="topbar-actual" aria-live="polite">{actual}</span>}
        <span className={`topbar-rol topbar-rol-${rol}`}>{rolVisto}</span>
        <span className="topbar-user" title={sesion?.usuario}>{sesion?.nombre || sesion?.usuario}</span>
        {sesion?.es_super && (
          <span className="topbar-rol" style={{ background: 'var(--rol-super)', color: 'var(--on-btn)' }}
            title={tOr('super.topbar.chipTitle', 'Dueño de la plataforma')}>super</span>
        )}
        <span className="topbar-rol" title={conectado ? t('topbar.titleConectado') : t('topbar.titleDemo')}
          style={{ background: conectado ? 'var(--rol-online)' : 'var(--rol-demo)', color: 'var(--on-btn)', borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
          {conectado ? t('topbar.conectado') : t('topbar.demo')}
        </span>
      </div>
      <div className="topbar-acc">
        <button type="button" className="topbar-menu" onClick={() => setAbierto(v => !v)} aria-expanded={abierto}
          aria-label={(abierto ? t('topbar.cerrarMenu') : t('topbar.abrirMenu')) + (nAlertas ? ` (${nAlertas})` : '')}
          title={abierto ? t('topbar.cerrarMenu') : t('topbar.abrirMenu')}>
          ☰{!abierto && nAlertas > 0 && <em className="topbar-n topbar-n-menu">{nAlertas > 99 ? '99+' : nAlertas}</em>}
        </button>
        <button type="button" className="topbar-salir" onClick={onSalir} title={t('topbar.salir')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
          <span className="topbar-salir-txt">{t('topbar.salir')}</span>
        </button>
      </div>
      <nav className={'topbar-mods' + (abierto ? '' : ' cerrado')}>
        {items.map(m => (
          <button
            key={m.id}
            type="button"
            data-mod={m.id}
            className={'topbar-tab' + (m.id === modulo ? ' on' : '')}
            onClick={() => elegir(m.id)}
          >
            {m.nombre}
            {m.contador > 0 && <em className="topbar-n">{m.contador > 99 ? '99+' : m.contador}</em>}
          </button>
        ))}
      </nav>
      {aviso && (
        <div className="auth-error" role="alert" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, margin: 0, padding: '6px 16px' }}>
          {t('topbar.avisoBase', { aviso })}
        </div>
      )}
    </header>
  )
}
