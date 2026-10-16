# NOMBRES.md · Equivalencias Catering Control → POS Control

Para no aprender dos mapas: POS Control copia la estructura de la app vieja (Catering Control).
Donde el nombre coincide, es el mismo concepto. Donde cambia, está explicado en
"La estructura es igual, los nombres son distintos de a propósito".

## Lo primero: NO hay "otra web"

La versión antigua en vanilla JS sí tenía archivos separados (`login.html`, `app.js`).
Hoy las dos apps son **una sola SPA**: un único `index.html` y el enrutador decide la pantalla.
Entrar al panel no es navegar a otro sitio, es cambiar de ruta (`/` → `/panel`), y por eso
no existen archivos sueltos de login: son componentes.

| Ruta | Catering Control | POS Control |
|---|---|---|
| `/` | `LoginPage` (login) | `LoginPage` (login empresa → usuario) |
| `/panel` | `PanelPage` (app) | `PanelPage` (app: salón, caja, mostrador, menú, config, super) |
| `/terminos` | `TerminosPage` | `TerminosPage` |
| `/privacidad` | `PrivacidadPage` | `PrivacidadPage` |
| `/cliente` | `ClientePage` (portal del cliente) | no existe (POS no tiene portal de comensales) |
| `/menu-semanal` | `MenuSemanalPage` | no existe |
| `*` | `<Navigate to="/" replace />` | `<Navigate to="/" replace />` (idéntico) |

Ambas definen las rutas en `src/App.jsx` con `react-router-dom` (`BrowserRouter` + `Routes`),
y el service worker responde cualquier ruta con `/index.html`.

## Pares exactos (mismo nombre, misma función)

| Catering Control | POS Control | Qué es |
|---|---|---|
| `src/App.jsx` | `src/App.jsx` | el enrutador; aquí se ven las rutas |
| `src/pages/LoginPage.jsx` | `src/pages/LoginPage.jsx` | pantalla de entrada |
| `src/pages/LoginPage.css` | `src/styles/auth.css` | estilos del login + barra superior |
| `src/pages/PanelPage.jsx` | `src/pages/PanelPage.jsx` | carcasa del panel: decide qué módulo mostrar |
| `src/pages/TerminosPage.jsx` | `src/pages/TerminosPage.jsx` | términos |
| `src/pages/PrivacidadPage.jsx` | `src/pages/PrivacidadPage.jsx` | privacidad |
| `src/pages/LegalPage.css` | `src/pages/LegalPage.css` | hoja única de las dos páginas legales |
| `src/components/LegalBackButton.jsx` | `src/components/LegalBackButton.jsx` | botón rojo "Volver al inicio de sesión" |
| `src/components/login/BrandMark.jsx` | `src/components/login/BrandMark.jsx` | logo (login, barra superior, páginas legales) |
| `public/manifest.json` | `public/manifest.json` | manifiesto PWA |
| `public/icons/favicon-32.png`, `favicon-48.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` | mismos archivos, mismos nombres | iconos; el logo se regenera con `node scripts/gen-iconos.mjs <logo.png>` |
| `src/services/supabaseClient.js` | `src/services/supabase.js` | cliente Supabase (`sb`) + `rpc()` + la empresa activa del `GUC` |
| `src/services/imageUpload.js` | `src/services/imagenProducto.js` | comprimir y subir imagen + borrar del bucket |
| `src/services/db.js` | `src/services/tiendaSupabase.js` | lecturas/escrituras a las tablas y RPC (`cargarEstadoInicial`, `despacharSupabase`) |
| `src/services/push.js` | `src/services/notificaciones.js` | notificaciones del sistema en español |
| `src/services/money.js` | `totalCuenta` / `totalFinal` / `pagadoCuenta` en `src/services/store.jsx` | importes y redondeo |
| `src/services/session.js` + `storageKeys.js` | `leerSesionSup` / `guardarSesionSup` en `src/services/store.jsx` (clave `'pos-sesion-id'`, evento `'pos-sesion'`) | sesión guardada en el navegador |
| `src/i18n/locales/es.json` | `src/i18n/es.js` | diccionario de textos (fuente de verdad) |
| `src/i18n/index.js` | `src/i18n/index.jsx` | provider + hook de idioma |

## Pares de concepto (el nombre cambia porque el producto cambia)

| Catering Control | POS Control | Nota |
|---|---|---|
| `src/components/panel/Sidebar.jsx` | `src/components/panel/Topbar.jsx` | en POS la navegación de módulos va arriba (la usan cajas y meseros con el teléfono en la mano) |
| `src/components/panel/<área>/*Page.jsx` (dispatch, clients, menu…) | `src/components/<módulo>/*Page.jsx` (`salon/`, `caja/`, `venta/`, `admin/`, `super/`) | en POS cada módulo es una carpeta propia, no cuelga de `panel/` |
| `src/context/OperationsContext.jsx` | `src/services/store.jsx` | estado global (reducer + `useStore()`) |
| `src/context/CompanyPrefsContext.jsx` | prefs dentro de `src/services/store.jsx` (`s.config`) | POS no tiene contexto de empresa aparte |
| `public/config.js` (config de runtime por empresa) | `src/config.js` (constantes de build: URL, publishable key, `MONEDA`, `USAR_SUPABASE`) | POS todavía no tiene config de runtime ni marca por empresa |
| `src/hooks/useBranding.js` | — | cuando haya logo por empresa, `BrandMark` leerá de un hook así; hoy lee el icono de la PWA |
| `public/push-sw.js` | `public/sw.js` (caché + push en el mismo worker) | |
| `src/services/planHelpers.js` | `public.limites` + trigger `private.controlar_cuota_productos` (`supabase/migraciones/002_seguridad.sql`) | el equivalente al candado de plan: tope de artículos por negocio (30), que el comercio no puede leer ni tocar; el panel solo lo ve reflejado cuando la base lo rechaza, y el super lo edita desde `src/components/super/EmpresasTabla.jsx` |

## La estructura es igual, los nombres son distintos de a propósito

1. **Textos**: POS usa archivos `.js` con claves planas (`'salon.mesaLibre': '…'`), no `.json` anidados
   ni `react-i18next`. `es.js` es la fuente de verdad y `en.js` / `pt.js` deben ser su espejo exacto:
   se comprueba con `node scripts/check-i18n.mjs`.
2. **Sin marcado inline en los textos**: POS no usa `<Trans>`, así que los términos y la privacidad son
   texto plano y se componen en la página (`TerminosPage.jsx`). No hay etiquetas dentro de las cadenas.
3. **Idioma**: el selector es `src/i18n/SelectorIdioma.jsx` y la preferencia vive en `localStorage`
   bajo `'pos-idioma-app'` (la misma clave que escribe el panel super).
4. **Estilos**: en POS cada módulo trae su CSS al lado (`salon/SalonPage.css`, `caja/CajaPage.css`,
   `venta/VentaDirecta.css`); los compartidos están en `src/styles.css` y `src/styles/auth.css`;
   lo legal en `src/pages/LegalPage.css`. Regla de nombre: la hoja se llama como el `.jsx` que la
   dueña; si un CSS sirve a varios componentes (p. ej. `admin/admin.css`, `super/super.css`) lleva
   el nombre de la carpeta.
5. **Variables de color**: POS define sus tokens una sola vez en `src/styles.css` (`--bg`, `--card`,
   `--ink`, `--mut`, `--ac`, `--line`, más los de estado `--libre`/`--ocupada`/`--enviada`/`--porcobrar`)
   y `LegalPage.css` los reutiliza. En Catering cada tema escribe su bloque sobre
   `body.page-legal` y por eso usa `usePageBodyClass('page-legal')`; POS no tiene selector de tema
   (claro/oscuro lo decide `prefers-color-scheme` en `:root`), así que sus páginas legales no
   necesitan esa clase ni ese hook.

## Dónde está X (búsqueda rápida)

- Una ruta o pantalla nueva → `src/App.jsx` (ruta) + `src/pages/`.
- Un texto que se ve en pantalla → `src/i18n/es.js` (buscar la cadena en español; la clave es lo que
  usa el componente).
- Una regla de permisos ("el mesero no puede cobrar") → `src/services/permisos.js`.
- Una consulta o llamada RPC a Supabase → `src/services/tiendaSupabase.js` y `supabase/schema.sql`.
- Qué se puede exportar/importar de una empresa → `src/services/super/superApi.js` + `src/components/super/`.
- Impresión (comanda, ticket) → `src/services/impresora.js` + `src/components/ticket/Ticket.jsx`.
- PWA (icono, caché, notificaciones) → `public/manifest.json`, `public/sw.js`, `src/components/pwa/PwaBridge.jsx`.
