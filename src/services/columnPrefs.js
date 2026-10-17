// Preferencias de columnas de las tablas (ancho manual), SOLO persistencia local.
// Puerto del services/columnPrefs.js de Catering Control sin la parte de sincronización
// con el servidor: todo vive en localStorage bajo 'pos-cols-<resizeGroup>' (o
// 'pos-cols-<resizeGroup>-<userId>' si el llamador pasa userId, patrón de claves del
// destino: pos-salon-vista, pos-estacion).
// Los `try/catch` cubren el modo privado del navegador: sin persistencia la tabla sigue
// funcionando con los anchos por defecto de la sesión.

const PREFIJO = 'pos-cols'

const claveDe = (userId, grupo) => `${PREFIJO}-${grupo}${userId ? `-${userId}` : ''}`

function leer(grupo, userId) {
  try {
    const crudo = localStorage.getItem(claveDe(userId, grupo))
    return crudo ? JSON.parse(crudo) : null
  } catch { return null } // clave rota o sin localStorage: se empieza de cero
}

function escribir(grupo, userId, prefs) {
  try { localStorage.setItem(claveDe(userId, grupo), JSON.stringify(prefs)) } catch { /* sin persistencia: en memoria */ }
}

// Lectura: devuelve SIEMPRE { widths } (forma estable para DataTable, aunque no haya prefs).
export function getColumnPrefs(userId, grupo) {
  const p = leer(grupo, userId) || {}
  return { widths: p.widths && typeof p.widths === 'object' ? p.widths : {} }
}

// Escritura: reemplaza el mapa de anchos { claveColumna: px }.
export function saveColumnWidths(userId, grupo, widths) {
  escribir(grupo, userId, { ...getColumnPrefs(userId, grupo), widths })
}

// Marca de tiempo del último resize terminado. Al soltar el arrastre el navegador puede
// disparar un `click` suelto que, por el reflow del ancho, aterriza en el botón de orden
// de la columna vecina. Los `toggleSort` consultan esto para ignorar clics inmediatos.
let lastResizeEnd = 0
export function resizeEndedRecently(ms = 300) {
  return Date.now() - lastResizeEnd < ms
}

// Arrastre del borde de una columna: cambia el ancho en vivo y avisa el ancho final al soltar
export function startColumnResize(e, key, onDone) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const th = handle.parentElement;
  const table = th.closest('table');
  const startX = e.clientX;
  const startWidth = th.offsetWidth;
  handle.setPointerCapture(e.pointerId);
  let moved = false;
  let lastW = null; // ancho exacto del arrastre (offsetWidth redondea y hace "saltar" la columna)
  function onMove(ev) {
    moved = true;
    lastW = Math.max(24, startWidth + ev.clientX - startX);
    th.style.width = `${lastW}px`;
  }
  function onUp() {
    const final = lastW ?? Math.max(24, th.offsetWidth);
    th.style.width = `${final}px`;
    onDone(key, final);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    if (moved) {
      lastResizeEnd = Date.now();
      // El clic suelto puede caer en cualquier celda de la tabla (vecina incluida), así que
      // se traga a nivel de <table> en fase de captura hasta el próximo tick.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      table?.addEventListener('click', swallow, true);
      setTimeout(() => table?.removeEventListener('click', swallow, true), 0);
    }
  }
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}
