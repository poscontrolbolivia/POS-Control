// Marca de la app: el mismo archivo que se instala como ícono de la PWA, para que la web,
// el ícono del escritorio y las notificaciones sean literalmente el mismo dibujo.
// Catering Control resuelve la marca desde window.APP_CONFIG.logoUrl; aquí aún no hay
// branding por empresa, así que se apunta directo al ícono generado por
// `node scripts/gen-iconos.mjs <logo>`.
export default function BrandMark({ size = 40, className = '' }) {
  return (
    <img
      className={`brand-mark${className ? ' ' + className : ''}`}
      src="/icons/icon-192.png"
      width={size}
      height={size}
      alt="POS Control"
      draggable="false"
    />
  )
}
