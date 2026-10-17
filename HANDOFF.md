# POS Control · estructura del repositorio (v0.6.1, limpieza)

```
index.html · package.json · vite.config.js · .node-version     ← raíz del repo (Cloudflare: build `npm run build`, salida `dist`)
public/        manifest, service worker, íconos, _redirects
src/           app React (components, pages, services, i18n, styles)
scripts/       check-i18n.mjs (npm run idiomas) · gen-iconos.mjs (íconos PWA, opcional)
supabase/      setup.sql  → TODA la base, se pega COMPLETO en el SQL Editor (idempotente)
               super-admin.sql → convierte UNA cuenta en super admin (editar el correo y ejecutar)
docs/          CONTRATO.md · GUIA.md · PROMPT-IA1/2/3.md · HANDOFF-IDIOMAS.md · HANDOFF-SUPER.md
```
**Solo hay 2 SQL.** Los anteriores (schema, migraciones 001–006, seed-demo, verificar) quedaron fusionados en `setup.sql`; el `crear_super`/`quitar_super` por función se reemplazó por `super-admin.sql` (sin claves en el historial del editor). La semilla de super con UID fijo se eliminó (en una base nueva fallaba).
Nota: `setup.sql` no se probó contra una base nueva (es la concatenación, en orden, de los archivos que ya estaban aplicados).

---

# v0.6.2 · Ajustes del login (a pedido del dueño)
- Empresa: SOLO se elige (nunca se escribe). **Demo** es la opción por defecto (o la última empresa usada); no pide usuario ni clave: se elige el rol de prueba (admin/cajero/mesero) y entra con datos locales del navegador. No se sembró una empresa Demo en `setup.sql` a propósito: sería un negocio compartido por cualquiera y mezclaría datos de prueba con los reales.
- Idioma: desplegable (como el tema). Preferencia POR DISPOSITIVO (`pos-idioma-app`), vale para toda la app en ese navegador; sin elección usa el idioma del navegador. Pendiente opcional: guardarlo también por cuenta para que viaje entre dispositivos.
- Compartir: botón verde sólido. "¿Olvidaste tu clave?": al final de la tarjeta, estilo discreto. Tipografías Figtree/Inter (como Catering) en toda la app.
- Alcance visual: el rediseño tipo Catering está en el LOGIN, y por herencia en tema (3 temas), tipografías, botones `.primary` (píldora) y selectores de la barra superior. Salón, caja, menú y demás paneles conservan su diseño propio.

---

# v0.6 · Login estilo Catering Control (IA-2, a pedido del dueño)

- `pages/LoginPage.jsx` reescrito en UNA pantalla: **Empresa (lista desplegable de las ya creadas)** + correo + clave (con ojo) + Entrar. Opción "Demo" dentro de la lista. Si la RPC de lista no existe aún, cae a escribir el código.
- La RPC `empresas_para_login` (solo id/código/nombre) ya va dentro de `supabase/setup.sql`.
- Con empresa elegida, el usuario debe pertenecer a ella (si no: "no pertenece a la empresa elegida"); el super entra igual.
- **Bloqueo por intentos**: 3 fallos seguidos → botón bloqueado 1 min con cuenta regresiva (por empresa+usuario). Es del lado del navegador (localStorage `pos-login-bloqueo`); falta el equivalente en servidor (petición a IA-1: tabla de intentos + RPC, como `login_staff` de Catering).
- **Temas claro/nocturno/bosque**: `services/tema.js` (llave `pos-ui-theme-v1`, `data-theme` en `<html>`), variables en `styles.css` (se quitó `prefers-color-scheme`), selector en login y en Topbar.
- Botón **Compartir esta app** (`ShareAppButton`), pie legal `AppFooter` ("POS Control™ · Software verificado · Términos · Privacidad · © año Todos los derechos reservados"), botones píldora `.cc-btn` (`styles/login.css`), botón WhatsApp de soporte, `.primary` global ahora es píldora con degradado.
- 633 claves i18n coherentes (`npm run idiomas`), `npm run build` sin errores. No se pudo revisar visualmente en un navegador real: el dueño debe confirmar el aspecto.
- Pendiente de apariencia: el resto del panel (salón, caja, menú) sigue con su diseño propio; solo hereda colores del tema y botones primarios.

---

# HANDOFF · POS Control · v0.2 (2026-10-16)

App Vite + React 19, modo demo con datos locales (localStorage). `npm install && npm run dev`.
Login demo (2 pasos empresa→usuario): `admin / 1234`, `cajero / 1234`, `mesero / 1234`.

## Estado de carriles
- **IA-1 (backend)**: `supabase/setup.sql` (1886 líneas, idempotente: pegar en SQL Editor) + `docs/CONTRATO.md` (RPCs y mapeo 1:1 store→RPC). Multi-tenant: `empresa_id` en 12 tablas, 42 políticas RLS con `private.empresa_activa()` (GUC `app.empresa_id` + membresía), 17 RPCs atómicas con validación de rol, advisory locks, vista `v_estado_mesas`, seed comentado.
- **IA-2 (operación)**: `salon/SalonPage.jsx` (mapa 1000×600, zonas, edición admin, badge de mesas unidas) · `pedido/PedidoPanel.jsx` (comensales, secciones, comanda, unir/separar mesas, mover ítems, propina %, descuento con PIN demo para cajero, pagos mixtos con cambio, impresión) · `caja/CajaPage.jsx` (turno con fondo, ingresos/egresos, arqueo con faltante/sobra, historial) · `venta/VentaDirecta.jsx` (menú táctil, carrito, turno número, 1–2 líneas de pago, ticket) · `ticket/Ticket.jsx` (`imprimirTicket` vía iframe oculto, 58/80 mm, comanda/pre-cuenta/ticket).
- **IA-3 (acceso/admin)**: `auth/LoginPage.jsx` (empresa→usuario/clave) · `auth/Topbar.jsx` · `admin/MenuAdmin.jsx` (secciones con orden ▲▼, productos CRUD/activo) · `admin/ConfigAdmin.jsx` (negocio, moneda, IVA, propina).
- **Capa compartida (hilo principal)**: `services/store.jsx` (reducer con todas las acciones; `mesaIds`, `canal`, caja, menú), `services/permisos.js` (matriz §3 de GUÍA), `App.jsx` (login + módulos), `config.js` (URL + publishable key reales; `USAR_SUPABASE` aún no cableado en datos).

## Verificado
- `npm run build` 0 errores (32 módulos).
- Flujo navegador: login → abrir mesa con comensales → ítems por sección → enviar a cocina → propina 10% → cobro mixto (efectivo+QR) → mesa liberada → caja con turno abierto y resumen → venta directa con cobro e impresión.
- Escaneo de secretos: limpio (solo publishable key).

## Pendiente / siguiente
## Pendiente / siguiente
1. ~~**Cablear Supabase**~~ → **HECHO en v0.3** (ver sección abajo). Queda: re-pegar `supabase/setup.sql` corregido en el SQL Editor del proyecto `oeyrnenclklmczlfoxzy` (2 bugs de PostgreSQL encontrados al cablear).
2. El diálogo nativo de impresión puede bloquear pestañas en browsers embebidos: evaluar `print()` diferido o modo "vista previa" descargable.
3. Registro de empresa nueva desde la app (hoy: seed manual comentado en schema).
4. Reportes/cortes, subgrupos de productos, formas de pago configurables, áreas de comandas por impresora (ver GUÍA §13.1, fase 2).
5. La UI valida roles en cliente; la seguridad real es la del schema — no relajar RLS al cablear.

## Para las otras IAs
Prompts por carril en `docs/PROMPT-IA1.md`, `docs/PROMPT-IA2.md`, `docs/PROMPT-IA3.md`. Regla de oro: cada IA toca SOLO su carril; los archivos compartidos (`App.jsx`, `main.jsx`, `styles.css`, `services/*`, `config.js`) los integra el hilo coordinador.

---

# v0.3 · Supabase cableado (2026-10-16)

`npm install @supabase/supabase-js` ✓ · `npm run build` 0 errores · componentes de UI sin cambios de interfaz (`useStore()` → `{s,d}`).

## Nuevos / modificados
- `src/services/supabase.js`: cliente `sb` + `fijarEmpresa(id)` + `rpc()` que SIEMPRE inyecta `p_empresa_id` (CONTRATO §2: cada RPC llama `private.fijar_empresa`; no existe RPC pública de "fijar" ni header PostgREST para el GUC).
- `src/services/tiendaSupabase.js`: `cargarEstadoInicial` (SELECTs → forma exacta del estado local) y `despacharSupabase` (mapeo 1:1 acción→RPC de CONTRATO §4 + refetch selectivo de cuentas/turno; ante error: toast + re-sincronía total, nunca estado corrupto).
- `src/services/store.jsx`: `StoreProvider` elige modo por `localStorage 'pos-sesion'` ({empresaId,rol,…} ⇒ Supabase; nada o código 'demo' ⇒ demo). En modo Supabase aplica el reducer local de forma OPTIMISTA (los componentes como VentaDirecta encadenan efectos síncronos) y serializa las RPCs en cola; mapa id-local→id-db.
- `LoginPage.jsx`: paso 1 `rpc('empresa_por_codigo')` (0 filas ⇒ "código no encontrado"); paso 2 `signInWithPassword` + membresías (1 empresa entra, varias ⇒ picker). Demo intacto.
- `App.jsx` / `Topbar.jsx`: sesión se reanuda desde `pos-sesion`; Salir hace `signOut`; badge "Demo" / "Conectado a Supabase" + banner de error RPC.

## ⚠ ACCIÓN REQUERIDA en el proyecto Supabase `oeyrnenclklmczlfoxzy`
**YA APLICADA (coord, 2026-10-16 14:45)**: `supabase/setup.sql` re-pegado completo en el SQL Editor (hash verificado `837BCFDE…`, envuelto en `begin; … commit;`) ⇒ los 2 fixes (`min(uuid)::text` y `sum(text)`) ya están en la base. Verificado después del re-pegado: 43 políticas RLS, 3 RPCs `super_*`, datos intactos (5 mesas / 9 productos / 1 empresa).

Quedan en la base, generados por mis pruebas de wiring: **1 venta directa #1 cobrada y 1 turno de caja abierto**. Cerrar el turno desde Caja (contado 0) o borrarlos si se quiere el demo limpio.

---

# v0.3 · Super admin multiempresa + exportar/importar (2026-10-16)

## Base de datos: `supabase/setup.sql` — **APLICADA y verificada**
Idempotente; se ejecuta DESPUÉS de `supabase/setup.sql`. Aporta:
- `public.supers(user_id)` con semilla al uid del dueño + política de lectura propia.
- `public.es_super()`, y `private.es_super_compat()` en `supabase/setup.sql` (devuelve false si la tabla `supers` no existe, para que un schema sin la migración no reviente las políticas).
- `private.empresa_activa()` y `private.es_miembro_de()` redefinidos: un super puede **fijar y ver cualquier empresa** sin membresía; sin GUC fijado el super no ve nada (debe elegir empresa explícitamente).
- `public.fijar_empresa(uuid)` (escopo de **sesión**, requiere membresía o ser super), `public.super_listar_empresas()`, `public.super_exportar_empresa(uuid) → jsonb`, `public.super_importar_empresa(jsonb, codigo, clave_inicial='pos12345') → uuid`.

## Verificación real (no teórica)
Vía REST con sesión autenticada del usuario semilla (es super) — ojo: el endpoint `/database/query` del dashboard corre como `postgres` con `bypassrls`, así que **no sirve para probar RLS**; hay que usar REST con `access_token`:
- `es_super()=true`; `super_listar_empresas()` devuelve las 2 empresas durante la prueba.
- Round-trip export→import (`codigo='prueba2'`): 2 zonas, **5 mesas todas con zona**, 3 secciones, **9 productos todas con sección**, 1 membresía, config/moneda/propina copiados. (El snapshot lleva `zona_nombre`/`seccion_nombre` porque los uuid viejos no valen en otra base.)
- Un super fijado a otra empresa lee SOLO esa empresa en `v_estado_mesas`; fijar una empresa inexistente deja el GUC espurio ⇒ **0 filas** (denial). `fijar_empresa` de un usuario sin membresía ⇒ `"no pertenece a esa empresa"`; sin sesión ⇒ `"sin sesion"`; `super_exportar_empresa`/`super_listar_empresas` como anon ⇒ `"requiere super"`.
- Empresas de prueba (`pruebase1`, `prueba2`) eliminadas: la base quedó con 1 empresa.

## Sin verificar a propósito
Que un usuario **normal** con 2+ membresías no pueda saltar de empresa: hace falta un segundo usuario real de prueba; la guarda existe en `fijar_empresa` pero no se ejercitó.

## Interfaz (en curso, carriles separados)
- Panel super (`src/components/super/` + `src/services/super/`): listado, entrar a una empresa, exportar JSON, importar JSON. Parches de enganche en `docs/HANDOFF-SUPER.md`.
- Idiomas es/en/pt (`src/i18n/`): selector en el Topbar; el dueño quiere que el cambio de idioma lo dispare el super. Detalles en `docs/HANDOFF-IDIOMAS.md`.
- **Al llamar `fijar_empresa` desde el cliente hay que mandar el header `X-Session-Id`** en todas las peticiones de la sesión (si no, pgbouncer reparte las llamadas en conexiones distintas y el GUC se pierde).

## Limitaciones conocidas (no cableado / para coord)
- Descuento con rol ≠ admin: la UI pide un PIN "demo" (`PIN_ADMIN_DEMO`) que NO viaja a la base; `aplicar_extras`/`cobrar_cuenta` reciben `p_pin=null` ⇒ error legible salvo admin o usuario con `pin_descuento_hash` (falta cablear el PIN real desde la UI — requiere tocar PedidoPanel, fuera de alcance).
- Usuarios multi-empresa: los SELECTs/escrituras directas de catálogo dependen del fallback de `empresa_activa()` (exactamente 1 membresía); con 2+ empresas harían falta RPCs de lectura (CONTRATO §2 ya lo anticipa).
- Ventana de `cuentas` en caché: se cargan las activas + las cerradas dentro del rango de los turnos (para el arqueo de CajaPage); cuentas cerradas más antiguas no aparecen en historial de caja.
- `v_estado_mesas`/realtime no se suscriben aún: el refetch es por mutación propia (multi-dispositivo en v1 ⇒ requeriría poll o Realtime, checklist del schema).

---

# v0.3 · Seguridad + cuota + imágenes + comensales (2026-10-16)

Trabajo de backend y capa de datos del hilo principal. Referencia canónica: `docs/CONTRATO.md` (§0 reglas 7-8, §1 tablas ocultas, §3.17-3.19, §8 deploy) y `docs/GUIA.md` (§4, §10, §11, §15).

## Deploy de migraciones — ORDEN EXACTO
1. `supabase/setup.sql`
2. `supabase/setup.sql`
3. `supabase/setup.sql`
4. `supabase/setup.sql`

Idempotentes, pegar en el SQL Editor en ese orden (002 requiere 001 porque usa `public.es_super()`/`supers`; 003 se puso después de 002 para poder auditar, aunque degrada sin ruido si 002 falta). **Estado en el proyecto Supabase real (`oeyrnenclklmczlfoxzy`): `setup.sql` y `setup.sql` YA ESTÁN APLICADAS** (001 y el schema lo estaban desde v0.3).

## `setup.sql` (aplicada) — paridad de seguridad con Catering Control
- **Auditoría**: tabla `public.auditoria` (oculta) + helper `private.auditar(uuid,text,jsonb)`; acciones registradas: `super_entro`, `super_ajustar_cuota`, `super_exporto`, `super_importo`, `throttle_agotado`, `comensales`. Lectura solo por RPC del super.
- **Cuota oculta de artículos**: `public.limites(empresa_id, max_productos int NULL=ilimitado, plan 'gratis'|'pago', notas, actualizado_en, actualizado_por)` con RLS deny-all (el tenant no la ve ni por REST: 403). Trigger `trg_nueva_cuota` en `empresas` siembra 30 artículos por empresa nueva; trigger `private.controlar_cuota_productos` sobre `productos` bloquea el alta que excede la cuota con el mensaje de venta: «El plan gratuito permite N artículos como máximo. Para tener más artículos, solicite el plan de pagos.» Los super administradores están exentos (la importación no se rompe con catálogos grandes); **reactivar un artículo inactivo sí consume cuota**; cambiar precio/nombre o dar de baja no.
- **RPCs solo-super de cuota**: `public.super_ajustar_empresa(uuid,integer,text,text)` y `public.super_ver_cuota(uuid)` (client-side en `src/services/super/superApi.js`: `ajustarCuota`/`verCuota`).
- **Miniaturas de artículos**: columna `public.productos.imagen_path` con CHECK de forma `productos/{uuid-empresa}/{uuid}.{webp|jpg}`; bucket público `pos-imagenes` (se crea por SQL, tope 209715 B, `allowed_mime_types = ['image/webp','image/jpeg']`) y CUATRO políticas de Storage (`pos_imagenes_insert|select|update|delete`) atadas a la carpeta de la empresa del miembro. Nota del SQL: sin la política SELECT el alta en Storage falla siempre (PostgREST hace `INSERT…RETURNING`), comprobado en vivo.
- **Throttle anti-fuerza-bruta**: tabla `public.throttle` (oculta) + `private.throttle_ok(prefijo,max,ventana)`; `public.empresa_por_codigo(text)` redefinida a **30 intentos / 10 minutos por IP** y al agotar devuelve **0 filas** (indistinguible de "código inexistente") en vez de lanzar excepción: no enumera empresas y no revierte el conteo.
- **Auditoría legible**: `public.super_listar_auditoria(uuid,integer)` y `public.super_registrar_exporte(uuid)` (el panel la llama tras descargar el .json).
- **El super ya puede ENTRAR de verdad en otra empresa**: redefinidas `private.fijar_empresa` (acepta miembro o super), `private.mi_rol` (super sin membresía ⇒ rol efectivo admin) y `public.fijar_empresa` (GUC de SESIÓN, requiere header `X-Session-Id` — ya cableado en `src/services/supabase.js`). Esto es la Opción B de `docs/HANDOFF-SUPER.md` §4, pero aplicada dentro de `setup.sql` (el archivo suelto `setup.sql` propuesto nunca existió como migración).
- **Exportar/importar sin pérdidas**: `public.super_exportar_empresa` redefinido con `version: 2` (el bloque `equipo` incluye ahora `user_id`) y `public.super_importar_empresa` redefinido: además del catálogo restaura el **HISTÓRICO** (`cuentas`, `cuenta_mesas`, `cuenta_items`, `pagos`, `turnos_caja`) reasignando dueños (`abierta_por`/`cerrada_por`/`creada_por`) vía el mapa `user_id` de origen → usuario recreatedo.

## `setup.sql` (aplicada)
- RPC `public.actualizar_comensales(p_cuenta_id uuid, p_comensales integer, p_empresa_id uuid default null) returns integer`, `security definer`: exige rol admin/cajero/mesero (`private.exigir_rol`), rechaza fuera de 1..99 con «El número de comensales debe estar entre 1 y 99», no deja tocar una cuenta ya cerrada ni de otra empresa, y audita la acción (si 002 está aplicada).
- Cliente: acción `comensales~` en `src/services/store.jsx` (reducer), mapeada en `src/services/tiendaSupabase.js` (caso junto a `extras` → `rpc('actualizar_comensales')`) y usada por `src/components/salon/SalonPage.jsx`.

## Salón e imágenes (lado cliente)
- CRUD de salones/zonas con orden: acciones `zona+` (alta), `zona~` (renombrar/reordenar ▲▼) y `zona-` (borrado con confirmación inline) ⇒ escritura directa en `zonas` (RLS exige admin, `tiendaSupabase.js`).
- Mover una mesa de salón (`mesa~` con `zona`), y **arrastre con posición persistida** (1 solo dispatch al soltar el puntero, no por frame).
- Asignación de comensales (1..99) corregible después de abrir la mesa.
- Layout móvil (≤768 px, `MAX_PX_MOVIL` en `SalonPage.jsx` + media-queries de `salon.css`): barras de acción como hojas inferiores ("hoja de pulgar") y objetivos táctiles ≥44 px.
- Miniaturas de artículos a **45×45 px en pantalla**, guardadas a **90 px** (2×, nítidas en retina) — pipeline de compresión webp/jpeg en `src/services/imagenProducto.js` (`LADO_VISUAL_PX=45`); usadas en `MenuAdmin`, `PedidoPanel` y `VentaDirecta`.

## i18n (estado verificado en disco)
- Diccionarios planos `es`/`en`/`pt` con claves tipo `super.entrar.pregunta` e interpolación `{param}`; 461 claves × 3 idiomas.
- Selector de idioma: `src/i18n/SelectorIdioma.jsx` (Topbar y panel de super).
- Verificador: `node scripts/check-i18n.mjs` — compara los tres diccionarios (paridad, duplicados, vacíos, `{params}`) y avisa de claves usadas en código sin entrada. En verde.

## Decisiones de seguridad (intencionales, no negociables)
- `limites`, `throttle` y `auditoria` son **tablas ocultas**: `force row level security` sin políticas + `revoke all` desde `public/anon/authenticated`; solo se escriben desde funciones `security definer` y se leen por RPC privativas del super.
- Toda función pública nueva lleva `revoke all … from public, anon;` + `grant execute … to authenticated;` (en `empresa_por_codigo` también a `anon` porque es pre-login) y `set search_path = ''`.
- **El límite de artículos es invisible para el cliente**: la UI no muestra "plan gratuito" ni contador de cuota; el comercio solo recibe el mensaje de la base al intentar crear el artículo 31 (decisión del dueño del producto como modelo de negocio: gratis hasta 30 artículos, después plan de pagos).

---

# v0.3 · Verificación en vivo con Supabase + 3 bugs de arranque (2026-10-16)

Se probó la app REAL (`http://localhost:5199`) contra el proyecto `oeyrnenclklmczlfoxzy`, no solo el SQL. Tres fallos rompían el modo Supabase desde el primer clic; los tres corregidos y re-verificados en el navegador:

1. **`LoginPage.jsx` secuestraba el código `demo`**: con `demo` en el paso 1 la app se iba directo al carril local y nunca consultaba Supabase, así que era imposible entrar a la empresa real que se llama "Mi negocio" con código `demo`. Ahora el paso 1 SIEMPRE pregunta a `empresa_por_codigo` primero (si `USAR_SUPABASE`); solo cae a datos locales si la RPC no devuelve filas y el código escrito es `demo`.
2. **TDZ en `cargarEstadoInicial`** (`tiendaSupabase.js`): `fetchCuentas` usaba `cajaT` dentro del mismo `Promise.all` que lo definía ⇒ `Cannot access 'cajaT' before initialization` en TODA carga inicial. Se sacó `fetchCaja` a su propia promesa (`cajaP`) y `fetchCuentas` se encadena con `cajaP.then(…)`.
3. **Carta vacía en `PedidoPanel`**: el `sec` inicial venía de `secciones[0]?.id` del primer render (estado demo) y al llegar los datos de Supabase ninguna sección coincidía ⇒ "Sin artículos". Se deriva `secActiva` (`secciones.some(x => x.id === sec) ? sec : secciones[0]?.id`) y se usa en las pestañas y en el filtro de productos.

## Probado en vivo (con sesión real de Supabase, rol admin)
- **Comensales persisten**: abrir Mesa 1 ⇒ 6, ＋ ⇒ 7, **recargar la página** ⇒ la tarjeta sigue mostrando `👥 7/4` con el aviso de aforo. Circula `UI → acción comensales~ → rpc actualizar_comensales → cuentas.comensales → refresco`.
- **Fotos de artículo, punta a punta**: se subió un PNG de 120×120 desde Menú → "Subir foto" y quedó `productos/8ebb24ae-…/6288f9fd-….webp` en el bucket `pos-imagenes`; el objeto medido por HTTP es **90×90 px, 932 B, `image/webp`** y se dibuja a **43 px** dentro de la caja de 45; la miniatura **sobrevive a la recarga** (lee `imagen_path`, no la caché de sesión). "Quitar foto" borró el objeto de Storage (`info/public` responde `404 NoSuchKey`) y dejó `productos.imagen_path = NULL`.
- **Aviso de acceso del super**: `super.entrar.avisoAcceso` ya pasa `{esperadas}/{leidas}` y está en los 3 diccionarios.

## Restos de estas pruebas — LIMPIADOS en la base (coord, 2026-10-16, SQL del dashboard con ids exactos)
Se borraron `ui.test@test.local` (con sus `membresias`/`perfiles` en cascada), la cuenta abierta de Mesa 1, la venta directa #1 con su pago y el turno de caja abierto. Estado final verificado de la empresa demo: **0 cuentas, 0 turnos, 5 mesas, 2 zonas, 3 secciones, 9 productos, 0 objetos en Storage, 0 productos con `imagen_path`**, 1 solo `auth.users` (el super) y 1 membresía.

## Regresión encontrada al re-probar el login y su fix
Al hacer que el código `demo` pregunte primero a Supabase (para que el dueño de una empresa real llamada "demo" pueda entrar), **el sandbox local de `admin/1234` quedó inaccesible**: la RPC encontraba a la empresa seed y pedía correo y clave. Se resolvió con un acceso explícito en vez de depender de la palabra reservada:
- Botón **"Probar el demo sin cuenta"** en el paso 1 (`LoginPage.jsx` → `irDemo()`), que limpia `pos-sesion` + `fijarEmpresa(null)` y lleva al paso 2 local. Clave `login.probarDemo` en es/en/pt (**462 claves × 3**, `node scripts/check-i18n.mjs` en verde).
- Verificado en el navegador: el botón entra en demo (badge "demo", 4 mesas del seed local) y escribir `demo` en el campo sigue entrando al paso de correo/clave de "Mi negocio" en Supabase.

## Cómo se crea el primer usuario de una empresa (hoy no hay auto-registro)
No existe `crear_empresa` ni registro desde la app: las empresas nacen del seed o de la importación del super. Para que un comercio entre por Supabase hay que crearle el usuario desde **Authentication → Users** del dashboard (o con la API de gestión) y darle una fila en `membresias(user_id, empresa_id, rol)`; la importación de un `.json` exportado ya hace ambas cosas (`super_importar_empresa` recrea el equipo con `p_clave_inicial`). Si se borra un usuario con sesión abierta, la app no revienta: `cargarEstadoInicial` falla con «No tienes acceso a esta empresa (o no existe)» y el banner lo muestra.

---

# v0.4 · Logo real, estructura de rutas como Catering Control y textos legales (2026-10-16)

## Logo de la app = logo de la PWA
`scripts/gen-iconos.mjs` (nuevo, equivalente a los `scripts/` de Catering) genera los 7 archivos de `public/icons/` a partir del `Designer.png`: favicon-32/48, apple-touch-icon (180), icon-192, icon-512 e icon-maskable-192/512 (el dibujo al 90 % dentro de la zona segura del 80 % que recortan Android/iOS). Datos medidos del logo: fondo muestreado `#f8f7f9` (ese es el `background_color` del manifest) y dibujo que ocupa el **79 %** del lienzo.

Se borró el placeholder `public/icon.svg` y sus enlaces. Donde vive el logo ahora: `index.html` (favicon-32/48 + apple-touch-icon), `public/manifest.json` (4 iconos: 2 `any` + 2 `maskable`), `src/components/login/BrandMark.jsx` (login, barra superior y páginas legales), y `public/sw.js` (`VERSION = 'v3'`, 10 entradas de shell).

`sharp` se instaló con `npm i --no-save`: **no es dependencia del proyecto** (solo hace falta al cambiar el logo); el script avisa con la instrucción si falta.

## El login no es "otra web": es la ruta `/`
Era la duda pendiente del dueño; se respondió con código y se alineó al proyecto viejo: `src/App.jsx` es ahora un `BrowserRouter` con `/` (login), `/panel` (app), `/terminos`, `/privacidad` y `*` → `/`, idéntico a `src/App.jsx` de Catering Control (líneas 26-31 de ese archivo). La carcasa del panel se extrajo a `src/pages/PanelPage.jsx`. Movimientos de archivos: `components/auth/LoginPage.jsx → pages/LoginPage.jsx`, `components/auth/Topbar.jsx → components/panel/Topbar.jsx`, `components/auth/auth.css → styles/auth.css`, y CSS de pantalla con el mismo tallo que su componente (`salon.css → SalonPage.css`, `caja.css → CajaPage.css`, `venta.css → VentaDirecta.css`). `public/manifest.webmanifest → public/manifest.json` (como en Catering). La tabla completa de equivalencias quedó en **`docs/NOMBRES.md`**.

## Términos y privacidad (nuevos, adaptados a POS Control)
`src/pages/TerminosPage.jsx` (11 secciones, con índice y 3 bloques "En resumen") y `src/pages/PrivacidadPage.jsx` (7 secciones + tabla de datos). Comparten `src/pages/LegalPage.css`, `src/components/LegalBackButton.jsx` y el logo. **66 claves `legal.*` en los 3 diccionarios** (es/en/pt); total **527 claves × 3**, `node scripts/check-i18n.mjs` en verde. Se aprovechó para consolidar el aviso del login: `login.avisoSupaAntes` + `login.avisoSupaDespues` (que enseñaban a escribir `demo`, cosa que hoy entra a Supabase) se reemplazaron por una sola clave `login.avisoSupa` que señala el botón "Probar el demo sin cuenta".

## Avisos de la PWA y atajos del ícono ahora sí abren la vista pedida
`notificaciones.js` exportaba `suscribirVista()` **sin ningún consumidor** (ni en la versión commiteada): pulsar un aviso de cocina o el atajo `/#caja` del ícono solo cambiaba el hash y el módulo seguía en Salón. Se cableó en `PanelPage.jsx`: mapa `#salon|#cocina|#caja|#venta|#menu|#config` → módulo (con `#cocina` → salón, que no tiene pantalla propia), en el montaje y en `hashchange` (el aviso pulsado con la app abierta no recarga el documento). Además la ruta `/` redirige a `'/panel' + hash`, porque `entrar()` ya no llama `navegar()`: al enjuagar React el estado después del cambio de URL, `/panel` montaba sin sesión y rebotaba a `/` llevando el hash puesto.

## Probado (build de producción, `npm run preview` en :4173 y dev en :5199)
- `npm run build` en verde: 712.70 kB de JS (sube con `react-router-dom`) y 29.02 kB de CSS.
- Rutas del artefacto real: `/`, `/panel`, `/terminos`, `/privacidad` → 200 `text/html`; `/manifest.json` → 200 `application/json`; `/sw.js` → 200; service worker activo y **precaché de shell con sus 10 entradas** (`/`, `/index.html`, `/manifest.json`, 7 iconos).
- `/terminos` y `/privacidad` renderizados y leídos en los 3 idiomas: 11 y 7 secciones, índice con anclas `#s1…#s11` existentes, tabla de 3 filas en privacidad, cruces "Ver también →", logo cargado (192 px naturales) y **cero claves sin traducir** en el texto visible (búsqueda de patrones `namespace.clave` en el DOM: 0 resultados).
- Login demo (`admin/1234`) → `/panel` con 5 pestañas y mapa de mesas; abrir `/#caja` logueado y entrar deja la pestaña **Caja** activa; ruta inventada (`/ruta-que-no-existe`) devuelve al login; cambiar a EN y PT desde las páginas legales persiste `pos-idioma-app` y traduce toda la página.

## Comportamiento conocido (no es bug de esta versión)
La sesión del sandbox demo vive **solo en memoria**: recargar `/panel` en demo devuelve al login (en Supabase la sesión sí persiste en `localStorage`). Se dejó así a propósito desde v0.3; si molesta, es un cambio de una línea en `App.jsx` (guardar la sesión demo bajo otra clave).

---

# v0.5 · Alta self-service del negocio, gestión de equipo y claves olvidadas (2026-10-16)

## Qué decide esta versión
Hasta ahora un comercio no podía entrar sin que el dueño de la plataforma le creara el usuario desde el dashboard. Ahora **el primero se lo crea solo desde el login**, y el equipo lo gestiona el propio negocio. Las claves olvidadas siguen un reparto explícito pedido por el dueño: administrador → WhatsApp de soporte (él, como super, fija la clave); cajero/mesero → un administrador de su negocio, desde la pantalla de Equipo.

## Migración `supabase/setup.sql` (aplicada en el proyecto real)
- Trigger `trg_alta_empresa_registrado` → `private.registrar_empresa_del_registrado()` sobre `auth.users`: solo cuando `raw_user_meta_data->>'alta_empresa' = 'true'`. Valida código y nombre, rechaza código repetido con 23505 `alta_codigo_tomado` (el `signUp` se revierte entero) y crea **empresa + membresía admin + zona "Salón" con 8 mesas de capacidad 4** en rejilla 4×2 del lienzo 1000×600. `limites` y `perfiles` los siguen sembrando sus triggers de 002 y `supabase/setup.sql`.
- RPCs `equipo_listar`, `equipo_invitar` (alta directa en `auth.users`, espejo de `super_importar_empresa`: bcrypt 10, tokens en `''`, `auth.identities`), `equipo_restablecer`, `equipo_revocar` (no a uno mismo, no a un super, no deja la empresa sin admin; si la persona queda sin empresa borra su cuenta y, si tiene histórico, la deja sin accesos capturando `foreign_key_violation`) y `super_resetear_clave`. Las cinco **no aceptan `p_empresa_id`**: el cliente las llama con `{ conEmpresa: false }` (las cuatro de equipo ya se llaman así en `EquipoAdmin.jsx`).
- **Ajuste del dashboard necesario y hecho**: Authentication ⇒ `disable_signup: false` y `mailer_autoconfirm: true` (PATCH por la API de gestión). Sin autoconfirmación el `signUp` no devuelve sesión y el negocio quedaría a medio crear.
- **Bug encontrado y corregido durante la verificación**: `equipo_listar` reventaba con `42804 structure of query does not match function result type / Returned type character varying does not match expected type text in column 3` porque `auth.users.email` es `varchar(255)`. Se funde con `u.email::text` y el archivo se re-aplicó completo (19 069 B, sha256 `7975bbe1…`).

## Cliente
- `src/pages/LoginPage.jsx`: el estado `paso` pasa de `1|2|3` a `'codigo' | 'clave' | 'empresas' | 'alta' | 'recupera'`. La pantalla `alta` manda `signUp` con `{ alta_empresa, codigo_empresa, nombre_empresa, nombre, display_name }` (`display_name` es la clave que lee `handle_new_user`) y reutiliza el mismo cierre de login (`trasLogin` → `listo`), así que el fundador entra como `admin` en el mismo intento. Antes de registrar consulta `empresa_por_codigo` para dar el aviso en el formulario, y si la base responde `alta_codigo_tomado` lo traduce igual.
- `recupera`: dos bloques. El de administrador es un `<a class="auth-btn" target="_blank" rel="noopener noreferrer">` a `https://wa.me/<SOPORTE_WHATSAPP>?text=…` con el negocio y el correo ya escritos (`a.auth-btn` reproduce en `styles/auth.css` el aspecto del botón primario, porque `.primary`/`.big` de `styles.css` solo aplican a `<button>`).
- `src/config.js`: nueva `SOPORTE_WHATSAPP = '59177299692'` (formato internacional, sin `+`).
- `src/components/admin/EquipoAdmin.jsx` + `EquipoAdmin.css` (nuevos) y su bloque al final de `ConfigAdmin.jsx`, con gate `sesion.rol === 'admin'`. Lista, alta con clave silábica generable, "Nueva clave" inline y "Quitar" en dos toques con expiración; **sin `alert`/`confirm`/`prompt`** (regla del proyecto). De paso se arregló `ConfigAdmin.jsx`, que usaba `tOr` sin destructurarlo: cualquier apertura de Configuración con sesión de Supabase daba ReferenceError.
- Textos: **+81 claves** (34 de `login`/`alta`/`recupera` y 46 de `equipo`, más el par de enlaces nuevos del login) → **608 claves en los 3 diccionarios**, `npm run idiomas` en verde y 0 claves sin traducir en la pantalla probada.

## Probado end-to-end contra Supabase (build de producción, `vite preview` en :4173)
1. "Crear mi negocio" → **La Cancha de Prueba** / código `lacanchaprueba` → entra directo a `/panel` con chip `admin`, **1 zona "Salón" y 8 mesas de capacidad 4** (semilla del trigger).
2. Configuración → Equipo: "1 persona" con el admin; invitar a `maria.mesera@dominiotest.com` como `mesero` con `mes1234` → aviso de éxito y **2 personas**.
3. Salir → entrar con el código de empresa y el correo de la mesera → `/panel` con rol `mesero` y solo las pestañas **Salón / Caja / Venta directa** (permisos correctos).
4. Como admin: "Nueva clave" de la mesera → `nueva1234` → salir → **la mesera entra con la clave nueva**.
5. Como admin: "Quitar" (dos toques) → vuelve a **1 persona**, y su fila de `auth.users` desaparece (no tenía histórico).
6. "Crear mi negocio" con el código ya usado → **el formulario muestra "Ese código ya lo usa otro negocio. Prueba con otro."** y no se crea el usuario.
7. Enlace de recuperación verificado en el DOM: `https://wa.me/59177299692?text=Hola, no puedo entrar a POS Control. Negocio: La Cancha de Prueba. Correo: maria.mesera@dominiotest.com. Necesito una clave nueva, por favor.`
8. Limpieza verificada por SQL: `empresas_test 0`, `usuarios_test 0`, `zonas_huerfanas 0`, `mesas_huerfanas 0`, `empresas_totales 1`, `limites 1`.
9. `npm run build` en verde: **740.33 kB** de JS (216.29 kB gzip) y **33.06 kB** de CSS. `sharp` sigue sin ser dependencia (0 coincidencias en `package.json`).

## Cómo responder un "olvidé mi clave" (SOP del super)
Entrar al panel Super → "Entrar" en la empresa del que escribe (002 le da rol `admin` efectivo dentro de cualquier empresa) → Configuración → Equipo → "Nueva clave" → mandar la clave por WhatsApp. `super_resetear_clave(usuario, clave)` existe en la base como atajo por API, **sin pantalla todavía**.

## Migración `super-admin.sql` (aplicada en el proyecto real, 2026-10-16)
El alta self-service crea empresas y admins, pero **el super no se puede crear desde la app**. `005` añade dos funciones y se pega una sola vez:

```sql
select public.crear_super('dueno@correo.com', 'SuClaveSegura', 'Alex');
select public.quitar_super('dueno@correo.com');
```

- `crear_super` crea la cuenta en GoTrue (mismo patrón que `equipo_invitar`: bcrypt 10, `email_confirmed_at = now()`, tokens en `''`, `auth.identities`, `perfiles`) y mete la fila en `public.supers`. **Re-pegable**: si el correo ya existe, promove sin tocar la clave; la cambia solo con el 4º parámetro en `true`. Clave mínima 8, correo validado.
- `quitar_super` borra únicamente la fila de `supers` (la cuenta sigue viva y entrando).
- Revocadas a `anon`/`authenticated`: `POST /rest/v1/rpc/crear_super` con la publishable key ⇒ **42501 permission denied**; `has_function_privilege` = `false` para esos roles, `true` para `service_role`. Medido.
- Estado actual de la base: **1 usuario** (`85201957-…`, confirmado, ya en `supers`), **1 empresa**, `crear_super`/`quitar_super` existen.
- Probado con cuenta desechable y luego borrada: login `POST /auth/v1/token?grant_type=password` ⇒ 200 + token; `es_super()` ⇒ `true`; re-pegar `crear_super` devolvió el mismo uuid y **mantuvo la clave vieja** (vieja 200 / nueva 400); con `true` entró la nueva (200); `quitar_super` dejó `supers = 1` y la cuenta siguió entrando; el `delete from auth.users` limpió en cascada identidades/perfiles/supers (**0 huérfanos**).
- Ojo: `grant_type=password`, no `grant=password` (con `grant` GoTrue responde `invalid_credentials` y parece que la clave está mal).

## Deploy: `pos-control.pages.dev` estaba publicando el repo sin compilar
Medido el 2026-10-16 sobre el sitio vivo: `/` devuelve el `index.html` **fuente** (termina en `<script type="module" src="/src/main.jsx">`) y `/src/main.jsx` responde con `content-type: text/jsx` ⇒ el navegador no ejecuta el módulo y `#root` queda vacío. Prueba adicional de que no se corrió el build: `/public/manifest.json`, `/vite.config.js`, `/package.json`, `/supabase/setup.sql` y `/docs/CONTRATO.md` responden **200 con su contenido real** (en un `dist` compilado nada de eso existe). Es decir: Cloudflare Pages está publicando el checkout del repo, no el resultado de `npm run build`.

- **El repo no está roto ni mal ordenada**: `package.json` e `index.html` ya están en la raíz de `main` (listado de la API de GitHub + diff del árbol remoto contra `HEAD`: mismos 76 archivos, cero carpetas `pos/`). La raíz local del git **es** la carpeta `pos`, así que "subir los archivos un nivel" los dejaría fuera del repo.
- Arreglo en el panel (Settings → Build & deploy → Production build): Root directory `/`, Build command `npm run build`, Build output directory `dist`, y *Retry deployment*. Detalle en GUÍA §19.
- Efecto secundario bueno: con el build corregido dejan de estar expuestos los `.sql` y los `docs/` (hoy cualquiera los descarga).
- Descartado por medición: `npm ci` **no** rompió nada — con `package.json` 0.4.0 y `package-lock.json` 0.3.0 (que era el estado de `main`) el `npm ci --dry-run` terminó en 0 con 32 paquetes. Aun así se sincronizó el lock a 0.5.0.

## Pendientes que esta versión NO toca
- `super_resetear_clave` sin UI y el listado de usuarios de una empresa dentro del panel Super.
- Correo de bienvenida real (el alta funciona sin SMTP porque no se envía nada: la clave inicial la escribe el fundador y la del equipo la genera el admin).
- La cuota de 30 artículos sigue oculta: la pantalla de alta no la menciona.
