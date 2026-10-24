import { useState } from 'react'
import { useIdioma } from '../../i18n/index.jsx'

// Botón «Más…» con un menú corto: lo importante queda a la vista y lo demás se esconde aquí.
// items: [{ clave, texto, onClick, peligro, mantener, desactivado }]. `mantener` deja el menú abierto
// tras pulsar (sirve para confirmaciones tipo «¿Seguro?»).
export default function MasMenu({ items, etiqueta, desactivado = false }) {
  const { tOr } = useIdioma()
  const [abierto, setAbierto] = useState(false)
  const texto = etiqueta || tOr('comun.masPuntos', 'Más…')
  const visibles = (items || []).filter(Boolean)
  if (!visibles.length) return null
  return (
    <div className="mas">
      <button type="button" className="ghost mas-btn" aria-haspopup="menu" aria-expanded={abierto} disabled={desactivado} onClick={() => setAbierto(v => !v)}>
        ⋯ <span>{texto}</span>
      </button>
      {abierto && (
        <>
          <div className="mas-fondo" onClick={() => setAbierto(false)} />
          <ul className="mas-menu" role="menu">
            {visibles.map(it => (
              <li key={it.clave}>
                <button type="button" role="menuitem" className={it.peligro ? 'peligro' : ''} disabled={it.desactivado}
                  onClick={() => { if (!it.mantener) setAbierto(false); it.onClick() }}>{it.texto}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
