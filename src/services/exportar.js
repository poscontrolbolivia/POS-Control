// Descargas de la app: tablas en PDF (para leer, imprimir o enviar) y datos en JSON (para respaldo o reutilizar).
// Ya no se generan archivos CSV. jsPDF se carga bajo demanda.

const bajar = (blob, nombre) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// JSON legible (con sangría) y en UTF-8. `datos` puede ser cualquier objeto serializable.
export function descargarJson(nombre, datos) {
  const texto = JSON.stringify({ exportado_en: new Date().toISOString(), ...datos }, null, 2)
  bajar(new Blob([texto], { type: 'application/json;charset=utf-8' }), nombre.endsWith('.json') ? nombre : `${nombre}.json`)
}

const esNumero = v => /^[-−+]?\s*(Bs\s*)?[\d.,]+\s*(%|min)?$/.test(String(v ?? '').trim())

// secciones: [{ titulo?, columnas: [texto], filas: [[valor]], derecha?: [indices] }]
// opciones: { archivo, titulo, subtitulo?, negocio?, generado? (texto «Generado»), vacio? (texto sin filas) }
export async function descargarTablaPdf(secciones, { archivo, titulo, subtitulo = '', negocio = '', generado = 'Generado', vacio = '—' } = {}) {
  const { jsPDF } = await import('jspdf')
  const anchas = Math.max(0, ...secciones.map(s => s.columnas.length)) > 5
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: anchas ? 'landscape' : 'portrait' })
  const W = anchas ? 297 : 210
  const H = anchas ? 210 : 297
  const ML = 12
  const MR = W - 12
  const U = MR - ML
  const FONT = 8.5
  const LH = 4
  let y = 16
  const salto = h => { if (y + h > H - 14) { doc.addPage(); y = 16; return true } return false }

  if (negocio) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(String(negocio), ML, y); y += 5 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(String(titulo || ''), ML, y); y += 6
  if (subtitulo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90); doc.text(String(subtitulo), ML, y); doc.setTextColor(0); y += 5 }
  y += 2

  secciones.forEach(sec => {
    const cols = sec.columnas.length
    const filas = sec.filas || []
    if (sec.titulo) {
      salto(16)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.text(String(sec.titulo), ML, y); y += 1.6
      doc.setDrawColor(150); doc.line(ML, y, MR, y); y += 5
    }
    if (!filas.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT + 1); doc.setTextColor(110); doc.text(String(vacio), ML, y); doc.setTextColor(0); y += 7; return }

    // Ancho de cada columna según el texto más largo (acotado), repartido en el ancho útil.
    const peso = sec.columnas.map((c, i) => {
      const mayor = filas.slice(0, 300).reduce((m, f) => Math.max(m, String(f[i] ?? '').length), String(c).length)
      return Math.min(40, Math.max(6, mayor))
    })
    const suma = peso.reduce((a, b) => a + b, 0)
    const ancho = peso.map(p => (U * p) / suma)
    const x0 = ancho.map((_, i) => ML + ancho.slice(0, i).reduce((a, b) => a + b, 0))
    const derecha = new Set(sec.derecha || sec.columnas.map((_, i) => i).filter(i => filas.length && filas.every(f => f[i] === '' || f[i] == null || esNumero(f[i]))))

    const celda = (txt, i, yy) => {
      const lineas = doc.splitTextToSize(String(txt ?? ''), ancho[i] - 2)
      lineas.forEach((l, k) => {
        if (derecha.has(i)) doc.text(l, x0[i] + ancho[i] - 1, yy + k * LH, { align: 'right' })
        else doc.text(l, x0[i] + 1, yy + k * LH)
      })
      return lineas.length
    }
    const cabecera = () => {
      salto(9)
      doc.setFillColor(232, 236, 242); doc.rect(ML, y - 3.6, U, 6, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT)
      sec.columnas.forEach((c, i) => celda(c, i, y))
      y += 5.2
    }
    cabecera()
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT)
    filas.forEach((f, n) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT)
      const alto = Math.max(1, ...f.slice(0, cols).map((v, i) => doc.splitTextToSize(String(v ?? ''), ancho[i] - 2).length)) * LH + 1.6
      if (salto(alto + 2)) { cabecera(); doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT) }
      if (n % 2) { doc.setFillColor(246, 248, 251); doc.rect(ML, y - 3.4, U, alto, 'F') }
      f.slice(0, cols).forEach((v, i) => celda(v, i, y))
      y += alto
    })
    y += 4
  })

  const total = doc.getNumberOfPages()
  const ahora = new Date().toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  for (let p = 1; p <= total; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(120)
    doc.text(`${generado} ${ahora}  -  ${p}/${total}`, W / 2, H - 7, { align: 'center' }); doc.setTextColor(0)
  }
  doc.save(archivo.endsWith('.pdf') ? archivo : `${archivo}.pdf`)
}
