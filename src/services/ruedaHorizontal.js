// Ref para tiras que se desplazan de lado (grupos, carta, salones): con la rueda del mouse,
// girar hacia arriba mueve la tira a la izquierda y hacia abajo a la derecha. Al llegar al
// borde deja pasar la rueda para que la página siga con su scroll normal.
export function ruedaHorizontal(el) {
  if (!el || el.__ruedaH) return
  el.__ruedaH = true
  el.addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 1) return
    const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY
    const next = Math.max(0, Math.min(max, el.scrollLeft + px))
    if (Math.abs(next - el.scrollLeft) < 0.5) return
    el.scrollLeft = next
    e.preventDefault()
  }, { passive: false })
}

// Un solo oyente para todos los marcos de menú (.nav-n1 / .nav-n2): la rueda del mouse los desplaza de lado
// cuando no caben, sin tener que ponerle la referencia a cada uno.
export function activarRuedaEnMenus() {
  if (typeof document === 'undefined' || document.__ruedaMenus) return
  document.__ruedaMenus = true
  document.addEventListener('wheel', e => {
    const el = e.target?.closest?.('.nav-n1,.nav-n2')
    if (!el || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 1) return
    const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY
    const next = Math.max(0, Math.min(max, el.scrollLeft + px))
    if (Math.abs(next - el.scrollLeft) < 0.5) return
    el.scrollLeft = next
    e.preventDefault()
  }, { passive: false })
}
