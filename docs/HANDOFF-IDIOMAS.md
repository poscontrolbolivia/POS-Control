# HANDOFF-IDIOMAS · carril de traducción (es / en / pt)

**Estado:** v1 · 2026-10-16 · dueño del carril: IA de idiomas.
`npm run build` en verde y `node scripts/check-i18n.mjs` en verde (460 claves × 3 idiomas).

Este archivo documenta SOLO el carril de idiomas. El del panel de super está en
`docs/HANDOFF-SUPER.md`; `HANDOFF.md` (raíz) lo mantiene el coordinador.

---

## 1. Qué existe y dónde

| Ruta | Qué es |
|---|---|
| `src/i18n/es.js` | **Fuente de verdad.** Diccionario plano, claves con puntos. 460 claves. |
| `src/i18n/en.js` | Espejo exacto de `es.js` (mismas claves, mismo orden, mismos `{params}`). |
| `src/i18n/pt.js` | Espejo exacto de `es.js`. |
| `src/i18n/index.jsx` | Provider + hook `useIdioma()` + traducción **fuera de React** (`tGlobal`). |
| `src/i18n/SelectorIdioma.jsx` | Selector compacto ES/EN/PT (Topbar y cabecera del panel de super). |
| `src/i18n/selector.css` | Estilos del selector (prefijo `.sel-idioma`, nada en `index.css`). |
| `scripts/check-i18n.mjs` | Verificador de paridad es/en/pt + duplicados + valores vacíos + `{params}` + claves huérfanas. |
| `src/main.jsx` | `<IdiomaProvider>` envuelve todo (`IdiomaProvider > StoreProvider > App / PwaBridge`). |

Convertidos a `t()` / `tOr()`: `App.jsx`, `auth/LoginPage.jsx`, `auth/Topbar.jsx`,
`salon/SalonPage.jsx`, `pedido/PedidoPanel.jsx`, `caja/CajaPage.jsx`, `venta/VentaDirecta.jsx`,
`admin/MenuAdmin.jsx`, `admin/ConfigAdmin.jsx`, `admin/ImpresorasAdmin.jsx`, `admin/EquipoAdmin.jsx`,
`ticket/Ticket.jsx`, `pwa/PwaBridge.jsx`, `services/notificaciones.js` y, por petición de claves,
el panel de super (`super/SuperPage.jsx`, `super/EmpresasTabla.jsx`, `super/ImportarBloque.jsx`)
aunque sus archivos **no** los tocó este carril.

### Reparto de claves (lo imprime el verificador)

```
app:7  caja:56  comun:10  config:16  estado:3  impresoras:33  login:29  menu:25
metodo:4  pedido:62  pwa:10  rol:3  salon:42  super:99  ticket:20  topbar:9  venta:32
```

---

## 2. API del carril

```js
const { idiom, setIdioma, t, tOr, MONEDA, idiomas } = useIdioma()

t('salon.abrirCuenta')                       // texto en el idioma activo
t('salon.unidaTitle', { n: 3, total: 45 })   // sustituye {n} y {total}
tOr('rol.' + sesion.rol, sesion.rol)         // clave ausente ⇒ la alternativa del llamador
setIdioma('pt')                              // cambia todo el árbol + localStorage + <html lang>
```

Fuera de React (impresión, notificaciones, servicios):

```js
import { tGlobal, existeClave, idiomaActivo } from '../i18n/index.jsx'
tGlobal('ticket.total')            // usa el idioma activo del Provider
idiomaActivo()                     // 'es' | 'en' | 'pt'
existeClave('metodo.' + m)         // ¿está en la fuente de verdad?
```

**Regla de fallo (nunca revienta, nunca vacío):** `t(clave)` intenta el idioma activo →
si no está, el español → si tampoco existe, **devuelve la propia clave** visible en pantalla.
`useIdioma()` fuera del Provider devuelve un pseudo-contexto en español (tests/SSR) en vez de
lanzar. Todo lo relacionado con `localStorage` está en `try/catch` (modo privado, sandbox).

Utilidades puras exportadas (testables sin React): `normalizarIdioma`, `leerPreferencia`,
`leerPreferenciaCruda`, `interpolar`, `traducirEn`, `existeClave`, `DICCIONARIOS`, `IDIOMAS`,
`IDIOMA_DEFECTO`, `CLAVE_STORAGE`, `IDIOMAS_INFO`.

---

## 3. Las tres reglas del dueño, cómo están implementadas

**Regla 1 · los datos no se traducen.**
- Números de mesa y de cuenta: `'Mesa ' + n` se guarda tal cual (`SalonPage.jsx`, misma forma
  que el seed `Mesa 1…5`); `ticket.turnoValor` / `ticket.mesaValor` traducen la **etiqueta**,
  nunca el número.
- Nombres de usuario, de sección, de producto y de salón/zona: se pintan crudos, sin `t()`.
- `roles`, `estados de cuenta` y `métodos de pago` siguen escritos en español en la base;
  solo se localizan para mostrar con `tOr('rol.' + v, v)` / `tOr('estado.' + v, v)` /
  `tOr('metodo.' + v, v)`. Un identificador nuevo que la base no conozca se muestra tal cual.
- Notas del comande: el texto que teclea el camarero se imprime y se guarda como lo escribió;
  la etiqueta del campo está traducida, el contenido no. Las sugerencias de `VentaDirecta.jsx`
  (`NOTAS_RAPIDAS`) **volvieron a español y fuera del diccionario** porque se guardan como dato
  del ítem.
- Los `id` de módulo de navegación (`'salon'`, `'caja'`, `'super'`…) no se tocan; solo se
  traduce la etiqueta visible en `App.jsx`.

**Regla 2 · `t()` no revienta con claves ausentes.** Ver «Regla de fallo» arriba; está
comprobado con claves inexistentes y con params que faltan (el marcador se deja tal cual).

**Regla 3 · el ticket respeta las 32 columnas.** En `Ticket.jsx` el modo térmico sigue con
`ancho = 32` (58 mm) / 48 (80 mm) y el relleno/corte por columnas intacto. Las etiquetas
traducidas más largas miden 21 caracteres (en/en: `Served by:`, pt: `Atendido:`), así que el
`etiqueta ⟶ importe` cabe en 32 sin recortar el dinero.

---

## 4. Preferencia de idioma y su relación con el panel de super

- Clave de `localStorage`: **`pos-idioma-app`** (valor `'es' | 'en' | 'pt'`, defecto `'es'`).
  El nombre lo decidió el carril de super; no se cambia.
- `SuperPage.jsx` monta `<SelectorIdioma />` en su cabecera: es **mi** componente, controlado
  por el Provider, así que hoy hay un único escritor de la clave y el cambio de idioma es
  instantáneo en toda la app.
- `src/components/super/IdiomaSelector.jsx` (selector autónomo `<select>`, con sus propias
  constantes `IDIOMAS`/`CLAVE_IDIOMA`) quedó **sin usar** por el código. Se conserva vivo a
  propósito: el Provider lo cubre porque se sincroniza con la clave por tres vías
  (evento `storage` entre pestañas, evento `focus` de ventana y sondeo cada 1500 ms), ya que
  escribir la misma pestaña NO dispara `storage`. Si algún día se vuelve a montar, se conecta
  controlado: `<IdiomaSelector value={idiom} onChange={setIdioma} />`.
- **Restringir el selector al super:** cambiar la línea del Topbar por
  `<SelectorIdioma soloSuper esSuper={Boolean(sesion?.es_super)} />`. El flag `es_super` ya es
  real (lo escribe `esSuper()` → RPC `public.es_super()` durante el login). Con `soloSuper` sin
  `esSuper`, el componente devuelve `null` y el resto de la app sigue funcionando.
- El `<html lang>` del documento se actualiza en cada cambio; el iframe del ticket de impresión
  también recibe `lang`.

---

## 5. Cómo hacer las cosas

### Añadir una clave nueva
1. Primero en `src/i18n/es.js` (fuente de verdad), dentro de su namespace y con comentario de
   sección si es una pantalla nueva.
2. Copiar la MISMA clave a `en.js` y `pt.js` en la misma posición.
3. `node scripts/check-i18n.mjs` → debe decir `✓` y el mismo número en los tres idiomas.
4. Si la clave se usa para un identificador de datos (rol, estado, método), llamar con `tOr` y
   dar el valor crudo como alternativa, no con `t`.

### Añadir un cuarto idioma (por ejemplo `it`)
1. Copiar `es.js` → `src/i18n/it.js` y traducir (mantener claves, orden y `{params}`).
2. En `src/i18n/index.jsx`: `import it from './it.js'`, añadirlo a `DICCIONARIOS = { es, en, pt, it }`
   y a `IDIOMAS = ['es', 'en', 'pt', 'it']`, y una fila más a `IDIOMAS_INFO`
   (`{ codigo: 'it', nombre: 'Italiano', corto: 'IT' }`). Nada más: el resto se deriva de ahí.
3. En `scripts/check-i18n.mjs` agregar `'it'` al array `ARCHIVOS`.
4. `public/manifest.webmanifest`: si se quiere PWA multi-idioma real, convertirlo en
   `manifest.webmanifest` + `?lang=` o usar `name_localized`; **esta fase no se hizo** (el
   manifiesto sigue en `lang: es`).

### Comprobar que nada quedó sin traducir
```bash
node scripts/check-i18n.mjs   # paridad + huérfanas (aviso, no fallo)
npm run build                 # que Vite no rompa nada
```

---

## 6. Lo que NO está traducido (honesto)

1. **Textos de servicios que se muestran en pantalla** (siguen en español en los tres idiomas):
   - `src/services/store.jsx`: `'No se pudo cargar la empresa: …'`, `'Cargando datos de la empresa…'`
     (aparecen en el banner del Topbar).
   - `src/services/impresora.js`: `'La impresora se desconectó. Vuelve a conectarla.'`,
     `'No hay impresora conectada'`, `'Web Serial no soportado por este navegador'`
     (se ven en `ImpresorasAdmin` vía `est.error`).
   - `src/services/supabase.js` y `src/services/tiendaSupabase.js`: los `mensajeError` que producen.
   - `src/services/super/cliente.js` (`CONFIG_FALTA`, `SIN_SESION`, `NO_SUPER`, el mapa de errores)
     y los `throw new Error('…')` de `src/services/super/superApi.js` (validación de cuota,
     snapshot, uuid). Salen como aviso rojo en el panel de super.
   Para traducirlos hace falta una línea de `tGlobal('…')` en archivos de OTROS carriles: las
   claves de apoyo (`pwa.permisoTexto` y el patrón `tGlobal`) ya existen; no se tocó nada ajeno.
2. **`super.entrar.avisoAcceso`** (clave deliberadamente fuera del diccionario): `SuperPage.jsx`
   construye ese aviso con una plantilla de JS que interpola dos números
   (`${esperadas}` / `${leidas}`) y **no pasa params** a `tOr`. Si la clave existiera con
   marcadores, se verían los corchetes literales. La corrección es de una línea en el carril
   super: `tOr('super.entrar.avisoAcceso', fallback, { esperadas, leidas })` — y entonces se
   agregan las tres versiones con `{esperadas}`/`{leidas}`.
3. **Notificaciones push del service worker**: `public/sw.js` fija `lang: 'es'` en su propia
   `opcionesNotif` y el título/cuerpo los manda el servidor (español). `notificaciones.js` ahora
   usa `lang: idiomaActivo()` y `PwaBridge.jsx` pasa título/cuerpo traducidos **en las
   notificaciones locales**, que son las que se disparan desde la app abierta. No se tocó la
   lógica Web Push ni el worker.
4. **`public/manifest.webmanifest`**: sigue `lang: es` (así se pidió; no se crearon manifiestos
   multi-idioma).
5. **`index.html`**: `<title>POS Control</title>` y la meta description quedan en español
   (están fuera del árbol de React).
6. **Datos de ejemplo / nombres propios**: semilla demo (secciones, productos, zonas, mesas,
   nombres de equipo), el código `demo`, `admin/1234`, `POS-580`, `Xprinter`, `getPorts()`,
   `Bs` como muestra de moneda y el nombre `POS Control`. No se traducen a propósito.
7. **CSS de otros carriles** (`super.css`, `index.css`, `styles.css`): intocados; los estilos del
   selector viven en `src/i18n/selector.css`.

---

## 7. Riesgos de choque con los otros carriles

| Archivo | Por qué puede chocar |
|---|---|
| `src/App.jsx` | Este carril tradujo las etiquetas de `modulos` y el banner de carga; el carril super añade el módulo `super`, el arranque en el panel y el banner `sesion.operando`. Ambas cosas ya están conviviendo; seguir tocando `modulos` requiere mantener `t('app.mod.*')`. |
| `src/components/auth/LoginPage.jsx` | El super parcheó `listo()` (asíncrono + `es_super` + super sin membresías); este carril tradujo los pasos y errores. Choque probable en el bloque `listo`. |
| `src/components/auth/Topbar.jsx` | Este carril monta `SelectorIdioma`; el super añade el chip `super`. Mismo JSX, líneas pegadas. |
| `src/main.jsx` | Orden de Providers: `IdiomaProvider` **por fuera** de `StoreProvider` (el store y los servicios leen `tGlobal`). Si alguien lo mete dentro, el ticket impreso y las notificaciones pierden el idioma. |
| `src/components/ticket/Ticket.jsx` | Solo lee `tGlobal`; cualquier cambio de maquetación del ticket debe conservar `ancho = 32` y el `padEnd(cols)`. |
| `src/services/notificaciones.js` | Importa `i18n/index.jsx`; si el carril PWA reescribe el archivo, mantener `lang: idiomaActivo()` y `textoPermiso()`. |
| `src/i18n/{es,en,pt}.js` | **Los tres diccionarios son escritura de varios carriles.** El namespace `super.*` (99 claves) lo añadió este carril porque el panel de super ya pedía las claves con `tOr`. Cualquier carril que agregue UI nueva DEBE mantener la paridad (el verificador falla si no). |

Nota: no se añadió ningún script a `package.json` a propósito (menos superficie de merge);
lanzar el verificador con `node scripts/check-i18n.mjs`.

---

## 8. Verificación final de esta fase

```
$ node scripts/check-i18n.mjs
✓ check-i18n: diccionarios coherentes
  es → 460 claves (fuente de verdad)
  en → 460 claves
  pt → 460 claves
  namespaces: app, caja, comun, config, estado, impresoras, login, menu, metodo, pedido, pwa, rol, salon, super, ticket, topbar, venta
  claves por namespace: app:7 caja:56 comun:10 config:16 estado:3 impresoras:33 login:29 menu:25 metodo:4 pedido:62 pwa:10 rol:3 salon:42 super:99 ticket:20 topbar:9 venta:32

⚠ 1 claves usadas en código y ausentes en es.js (se vería el nombre de la clave en pantalla):
   · super.entrar.avisoAcceso (src\components\super\SuperPage.jsx)

$ npm run build
vite v8.3.4 building client environment for production...
transforming...
✓ 95 modules transformed.
...
✓ built in 260ms          (0 errores; solo el aviso de chunk > 500 kB, preexistente)
```

Prueba de humo del núcleo (compilada con `vite --ssr`, sin `localStorage`): defecto `'es'`,
`normalizarIdioma('fr') → 'es'`, interpolación con param faltante deja `{monto}` visible,
clave inexistente se devuelve tal cual, `tGlobal` funciona fuera de React y los 3 idiomas
resuelven `super.titulo` / `app.mod.super` / `menu.cambiarFoto`.
