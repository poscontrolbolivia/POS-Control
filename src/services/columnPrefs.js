const PREFIJO = 'pos-cols'

const claveDe = (userId, grupo) => `${PREFIJO}-${grupo}${userId ? `-${userId}` : ''}`

function leer(grupo, userId) {
  try {
    const crudo = localStorage.getItem(claveDe(userId, grupo))
    return crudo ? JSON.parse(crudo) : null
  } catch { return null }
}

function escribir(grupo, userId, prefs) {
  try { localStorage.setItem(claveDe(userId, grupo), JSON.stringify(prefs)) } catch {  }
}

export function getColumnPrefs(userId, grupo) {
  const p = leer(grupo, userId) || {}
  return { widths: p.widths && typeof p.widths === 'object' ? p.widths : {} }
}

export function saveColumnWidths(userId, grupo, widths) {
  escribir(grupo, userId, { ...getColumnPrefs(userId, grupo), widths })
}

let lastResizeEnd = 0
export function resizeEndedRecently(ms = 300) {
  return Date.now() - lastResizeEnd < ms
}

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
  let lastW = null;
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

      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      table?.addEventListener('click', swallow, true);
      setTimeout(() => table?.removeEventListener('click', swallow, true), 0);
    }
  }
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}
