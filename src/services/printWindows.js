import { lineaATexto } from './printer.js'

const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function lineasAHtml(lineas = [], ancho = 32) {
  const mm = ancho >= 42 ? 80 : 58
  const fuente = mm === 80 ? 10.4 : 11
  const filas = lineas.map(l => {
    const tam = Math.min(4, Math.max(1, Number(l.tam) || 1))
    const alin = l.centrado ? 'center' : l.derecha ? 'right' : 'left'
    const texto = esc(lineaATexto(l, ancho)) || '&nbsp;'
    return `<div style="text-align:${alin};font-size:${(fuente * tam).toFixed(1)}px;font-weight:${l.negrita ? 700 : 400}">${texto}</div>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>POS Control</title><style>
@page{size:${mm}mm auto;margin:0}
*{box-sizing:border-box}
body{margin:0;width:${mm}mm;padding:2mm;font-family:'Courier New',Courier,monospace;line-height:1.25;color:#000;background:#fff}
div{white-space:pre;overflow:hidden}
.fin{height:6mm}
</style></head><body>${filas}<div class="fin"></div></body></html>`
}

let cadena = Promise.resolve()

export function imprimirEnWindows({ lineas, ancho = 32 } = {}) {
  const trabajo = () => new Promise((resolver, rechazar) => {
    if (typeof document === 'undefined') return rechazar(new Error('Sin documento para imprimir'))
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    Object.assign(iframe.style, { position: 'fixed', top: '0', left: '-10000px', width: '320px', height: '600px', border: '0', visibility: 'hidden' })
    document.body.appendChild(iframe)
    const win = iframe.contentWindow
    let cerrado = false
    const fin = (error) => {
      if (cerrado) return
      cerrado = true
      setTimeout(() => iframe.remove(), 500)
      if (error) rechazar(error); else resolver('windows')
    }
    try {
      win.document.open()
      win.document.write(lineasAHtml(lineas, Number(ancho) || 32))
      win.document.close()
      win.onafterprint = () => fin()
      setTimeout(() => {
        try { win.focus(); win.print() } catch (e) { fin(e instanceof Error ? e : new Error(String(e))) }
      }, 200)
      setTimeout(() => fin(), 25000)
    } catch (e) { fin(e instanceof Error ? e : new Error(String(e))) }
  })
  const siguiente = cadena.then(trabajo, trabajo)
  cadena = siguiente.catch(() => {})
  return siguiente
}
