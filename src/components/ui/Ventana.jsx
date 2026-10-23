import { useEffect } from 'react'
import './Ventana.css'

// Ventana en primer plano (sobre todo lo demás): se cierra con Esc o tocando fuera.
// Es la misma que usa la carta: un formulario que no se ve hasta abrir un acordeón no cuenta como botón.
export default function Ventana({ titulo, onCerrar, children }) {
  useEffect(() => {
    const f = e => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', f)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', f); document.body.style.overflow = previo }
  }, [onCerrar])
  return (
    <div className="mn-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="mn-ventana" role="dialog" aria-modal="true" aria-label={titulo}>
        <h3 className="mn-ventana-tit">{titulo}</h3>
        {children}
      </div>
    </div>
  )
}
