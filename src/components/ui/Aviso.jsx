// Aviso y estado vacío con una sola forma: icono, texto y (si hace falta) un botón claro.
// tipo: «info» (por defecto), «vacio» (borde punteado) o «error».
export default function Aviso({ tipo = 'info', icono, accion, children, ...resto }) {
  return (
    <div className={'aviso' + (tipo === 'vacio' ? ' vacio' : tipo === 'error' ? ' error' : '')} role={tipo === 'error' ? 'alert' : 'status'} {...resto}>
      {icono && <span className="aviso-ico" aria-hidden="true">{icono}</span>}
      <span className="aviso-txt">{children}</span>
      {accion}
    </div>
  )
}
