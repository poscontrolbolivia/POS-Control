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
