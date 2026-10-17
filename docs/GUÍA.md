# GUÍA · POS Control (versión gratuita multiempresa)

Guía de producto y decisiones de diseño. Referencia de inspiración: **Soft Restaurant** (simplicidad, configuración amplia, flujo mesa→comanda→cuenta→caja), corregido con lo aprendido de otros sistemas en los que trabajó el dueño.

---

## 1. Posicionamiento

POS web (React + Supabase) para restaurantes y pequeños comercios de comida:
- **Venta en mesa** (salón con mapa visual) y **venta directa al mostrador** (turno número, para llevar).
- **Versión gratuita para fichar empresas**: todas las empresas comparten UNA base de datos, pero cada usuario solo ve y opera los datos de la empresa a la que está registrado. Aislamiento por RLS + `empresa_id` en todas las tablas + RPCs que validan membresía.
- Meta: que un negocio real pueda operar el día 1 con demo local y migrar a Supabase sin cambiar la UI (la capa `store.jsx` se cambia por RPCs, mismo contrato).

## 2. Login y multiempresa (diferencia clave vs otros sistemas)

1. **Paso 1 — Empresa**: el usuario escribe/elige el código de su empresa. En la versión gratuita la lista no es pública (privacidad); se ingresa el código asignado al registrarse. El endpoint `empresa_por_codigo` lleva **throttle anti-fuerza-bruta** (migración 002): 30 intentos por IP en 10 minutos; al agotar devuelve 0 filas, indistinguible de un código equivocado (no revela nada a quien intenta enumerar empresas).
2. **Paso 2 — Usuario y clave**. Roles posibles por empresa: `admin`, `cajero`, `mesero`.
3. Al entrar, el cliente guarda `empresa_id` y **todas** las consultas pasan por ella (en Supabase: `set local app.empresa_id` vía RPC/encabezado + políticas RLS; nunca se confía solo en el filtro del cliente).
4. Un mismo usuario puede pertenecer a varias empresas con roles distintos (elección en login).
5. Sesión persistida; botón salir siempre visible. Un admin puede invitar/crear usuarios y **resetear claves** (solo admin).

## 3. Roles y permisos (contrato mínimo)

| Acción | admin | cajero | mesero |
|---|---|---|---|
| Editar mapa de mesas/zonas | ✔ | — | — |
| Gestionar menú (secciones/productos) | ✔ | — | — |
| Configurar negocio (moneda, IVA, propina) | ✔ | — | — |
| Abrir/cerrar turno de caja, ingresos/egresos | ✔ | ✔ | — |
| Tomar pedidos, notas, enviar a cocina | ✔ | ✔ | ✔ |
| Pre-cuenta | ✔ | ✔ | ✔ |
| Cobrar, pagos mixtos, propina | ✔ | ✔ | — |
| Descuento | ✔ directo | con PIN de admin | — |
| Anular ítem pendiente | ✔ | ✔ | ✔ |
| Anular ítem **enviado** a cocina | ✔ + motivo | — | — |
| Mover ítems entre mesas | ✔ | ✔ | ✔ |
| Unir/separar mesas | ✔ | ✔ | — |
| Venta directa (mostrador) | ✔ | ✔ | opcional |
| Reportes | ✔ | ✔ | — |
| Gestionar personal | ✔ | — | — |

La validación real va en la base (RLS/RPC); el mapa de permisos en el cliente es solo UX.

## 4. Módulo: Salón (mapa de mesas)

- **Lienzo normalizado 1000×600** (mismas coordenadas en cliente y base: x, y, w, h). Se adapta a cualquier pantalla/móvil; funciona con dedo (pointer events).
- Zonas (Salón, Terraza, Bar…) con **CRUD completo desde el salón** (solo admin): alta, renombrar inline, orden ▲▼ (columna `orden`) y borrado con confirmación en pantalla (las mesas de la zona quedan sin zona). La vista filtra por zona.
- Mesa: nombre, forma (cuadrada/rectángula/redonda), capacidad, posición y tamaño editables **solo en modo edición (admin)**. **Arrastre con posición persistida** (se guarda un único update al soltar el dedo, no por frame) y **mover la mesa de salón** desde el editor (`mesa~` ⇒ update de `mesas`).
- **Comensales corregibles en cualquier momento** de la comida (no solo al abrir): 1..99, por la RPC `actualizar_comensales` (migración 003, rol admin/cajero/mesero, audita y no toca cuentas cerradas).
- Estados por color: `libre`, `ocupada`, `enviada a cocina` (hay ítems enviados), `por cobrar` (pre-cuenta). Cuentas unidas a varias mesas muestran el total global en cada mesa del grupo.
- Click en mesa libre → abrir cuenta (nº de comensales). Click en ocupada → panel de cuenta.
- **Layout móvil (≤768 px)** distinto al de escritorio: franja de salones que envuelve en filas, objetivos táctiles ≥44 px y las barras de acción (editor de mesa, comensales) fijadas al borde inferior como **hojas de pulgar**; el toque en el fondo del lienzo deselecciona y cierra la hoja.
- Los selectores de artículo (pedido y venta directa) muestran **miniatura a 45×45 px** (se guarda a 90 px, 2× para pantallas retina; ver §8 Menú).

## 5. Módulo: Pedido / Cuenta

- Menú del día = **secciones** (Desayunos, Comida, Bebidas, Postres…) con sus productos. **No existe "menú semanal/ruta"**: el menú es único y se gestiona desde Administración; las secciones son la única división. Cada sección es una pestaña/bloque del selector de productos.
- Ítems: cantidad ±, nota por ítem ("sin picante", "término medio"), anular con motivo.
- **Enviar a cocina (comanda)**: envía solo los pendientes; los enviados quedan bloqueados para el mesero (solo admin anula con motivo). Reimpresión de comanda disponible.
- **Mover ítems a otra mesa**: selección de ítems + mesa destino (crea cuenta destino si hace falta). Es la herramienta para dividir cuenta y para correcciones de servicio.
- **Unir mesas**: varias mesas → una sola cuenta (grupos grandes). Separar una mesa devuelve cuenta propia vacía; el reparto de ítems se hace con "mover".
- **Dividir cuenta**: por ítems (mover a cuenta directa " divides") o partes iguales al cobrar.
- **Extras**: propina (% sugerido de config, editable), descuento (% o monto; cajero requiere PIN).
- **Cobro**: total = ítems − descuento + propina. **Pagos mixtos**: líneas de efectivo/QR/tarjeta; cambio calculado. Ticket final imprimible.
- **Pre-cuenta**: marca estado "por cobrar" e imprime pre-cuenta. Reabrir permitida.

## 6. Módulo: Venta directa (mostrador)

- Sin mesa: grilla de productos táctil → carrito → cobrar. Se genera **número de turno** correlativo por empresa/día.
- Modalidades: para llevar / consumo en el lugar. Mismo motor de cuenta con `tipo='directa'`.
- Entrada natural del **cajero** cuando no hay salón.

## 7. Módulo: Caja

- **Abrir turno** con fondo de caja. Todo lo cobrado mientras el turno está abierto alimenta el resumen.
- **Movimientos**: ingresos y egresos manuales (compras, propinas pagadas, retiros) con motivo.
- **Cerrar turno (arqueo)**: se pide efectivo contado → muestra esperado, faltante/sobra. Historial de turnos por empresa.
- Resumen de ventas del turno por método de pago; printable.

## 8. Módulo: Administración

- **Menú**: alta/edición de secciones (con orden) y productos (nombre, precio, sección, activo/inactivo). Los productos usados en cuentas antiguas conservan snapshot de nombre y precio (los tickets históricos nunca cambian).
- **Foto de artículo** (miniatura opcional por producto): se comprime en el navegador a 90×90 px webp/jpeg (`src/services/imagenProducto.js`; en pantalla se muestra a 45×45 px), sube al bucket público `pos-imagenes` con ruta contractual `productos/{empresa}/{producto}.webp` y se persiste en `productos.imagen_path` (CHECK de forma en la base). Tope de peso del bucket 209715 B y MIME solo `image/webp|jpeg`; las 4 políticas de Storage atan la carpeta a la empresa del miembro. En modo demo la imagen queda como data URL local.
- **Mapa** (admin): zonas y mesas (también accesible desde Salón en modo edición).
- **Personal**: crear usuarios con rol, generar PIN de descuento, resetear claves.
- **Config**: nombre del negocio, moneda (Bs), % IVA (por defecto 0; en Bolivia GC-IVA normalmente incluido en precio), % propina sugerida, tamaño de ticket (58/80 mm).

## 9. Impresión

- Motor: `imprimirTicket(...)` vía iframe oculto + `window.print()` (no depende de drivers ni bloqueadores de popups).
- Tipos: **comanda** (solo ítems para cocina, sin precios si se configura), **pre-cuenta**, **ticket final** (con pagos y cambio), **resumen de arqueo**.
- Anchos 58/80 mm. En fase 1 todo se imprime desde el dispositivo; impresión automática por red (EPPOS/ESC-POS vía Edge Function) es fase 2.
- Regla de diseño: un botón "Imprimir" en cocina (comanda), en cobro (ticket) y en caja (arqueo).

## 10. Base de datos y contrato (Supabase)

- Compartida entre empresas: `empresa_id` en todas las tablas + RLS con función `empresa_activa()`; RPCs `SECURITY DEFINER` que validan rol por membresía.
- Tablas de negocio/catálogo: `empresas, perfiles, membresias, zonas, mesas, secciones_menu, productos, cuentas, cuenta_mesas, cuenta_items, pagos, turnos_caja`.
- **Tablas de plataforma OCULTAS** (migración 002): `limites` (cuota de artículos), `throttle` (anti-fuerza-bruta), `auditoria` (rastro de acciones privilegiadas). `force row level security` sin políticas + `revoke all` desde `public/anon/authenticated` ⇒ el tenant no las ve ni por REST (403); solo se escriben desde funciones `security definer` y se leen por RPC privativas del super. Convención asociada: toda función pública nueva lleva `revoke all … from public, anon` + `grant execute … to authenticated` (a `anon` solo en pre-login) + `set search_path = ''`.
- RPCs atómicas de negocio: `abrir_cuenta, abrir_venta_directa, agregar_items, cambiar_qty_item, poner_nota, enviar_items, anular_item, unir_mesas, separar_mesa, mover_items, aplicar_extras, actualizar_comensales (003), cobrar_cuenta, abrir_turno, registrar_movimiento_caja, cerrar_turno`. RPCs de plataforma (solo super): `es_super, fijar_empresa, super_listar_empresas, super_exportar_empresa, super_importar_empresa, super_ajustar_empresa, super_ver_cuota, super_listar_auditoria, super_registrar_exporte`; pre-login: `empresa_por_codigo` (con throttle).
- **Orden de deploy de migraciones** (idempotentes, pegar en el SQL Editor; detalle en CONTRATO §8): `supabase/schema.sql` → `supabase/migraciones/001_super.sql` → `002_seguridad.sql` → `003_comensales.sql`. En el proyecto real las cuatro están aplicadas.
- Ver `supabase/schema.sql` + `supabase/migraciones/` y `docs/CONTRATO.md`. El cliente ya está cableado a Supabase (v0.3): `store.jsx` mantiene el modo demo y la capa `tiendaSupabase.js` traduce cada acción a su RPC/escritura 1:1.

## 11. Versión gratuita → de pago (fogging de empresas)

- Gratuita: 1 empresa 1 sucursal, 2-3 usuarios, sin facturación electrónica, soporte por formulario. La empresa se registra (nombre + código) y paga con QR de transferencia manual al inicio (Bolivia).
- **Cuota de artículos (único límite implementado hoy, migración 002)**: tabla oculta `public.limites` (`max_productos`, NULL = ilimitado; `plan 'gratis'|'pago'`) + trigger `private.controlar_cuota_productos` sobre `productos`. Cada empresa nace con **30 artículos** (trigger `trg_nueva_cuota`; las empresas ya existentes fueron re-sembradas por la migración). Al crear el artículo 31 la base responde con el mensaje de venta: «El plan gratuito permite 30 artículos como máximo. Para tener más artículos, solicite el plan de pagos.» Reactivar un artículo inactivo consume cuota; editar nombre/precio/foto o dar de baja no; los super están exentos (la importación de respaldos grandes no se rompe). **Decision de negocio: el límite es invisible para el cliente** — la UI no muestra "plan gratuito" ni contador; el comercio solo ve el mensaje de la base al pasarse. Ajuste por `super_ajustar_empresa` (oculto para el tenant).
- Pendientes de implementación (diseño original, hoy NO existen en la base): columna `plan` en `empresas` y límites por nº de usuarios/mesas.
- El "login con empresa" es el gancho: se ficha a la empresa con su propio código y al día siguiente ya opera con sus mesas.

## 12. Pantallas (orden de prioridad de construcción)

1. Login (empresa + usuario) ✅ carril IA-3
2. Salón con mapa + edición ✅ existente, mejorado
3. Panel de pedido/cuenta (comanda, mover, unir, propina, mixto) ✅ carril IA-2c
4. Venta directa ✅ carril IA-2b
5. Caja (turnos/arqueo) ✅ carril IA-2b
6. Admin menú/config ✅ carril IA-3
7. Tickets/comandas imprimibles ✅ carril IA-2b
8. **Fase 2**: reportes (ventas por día/sección/mesero, cortes), inventarios/recetas, catálogo de impresoras por red, menús digitales QR para clientes, propinas por mesero, propina sobre servicio.

## 13. Estilo y UX (lo "lindo")

- **Decisión del dueño**: la interfaz de Soft Restaurant es fea; NO se imita su estética. De Soft Restaurant se toma solo la **estructura de funciones/menús** (§8.1). El lenguaje visual es el de **Catering Control**.
- Paleta cálida de una sola tinta de acento sobre neutros, tarjetas con sombra suave, esquinas redondeadas 12-16px.
- Botones táctiles ≥44px; todo operable con dedo en tablet/barato Android.
- Estados por color siempre legibles con leyenda.
- español-Bolivia, moneda Bs, formatos de hora local.

### 13.1 Funciones copiadas de Soft Restaurant (estructura, no estética)

- **Grupos y subgrupos de productos**: secciones con subsecciones anidadas (fase 2; hoy: secciones planas con orden).
- **Formas de pago configurables**: admin define métodos (efectivo, QR, tarjeta, bonos, mixto) con nombre y prioridad; hoy fijo efectivo/qr/tarjeta.
- **Formatos de impresión por comprobante**: plantillas separadas para ticket de venta, pre-cuenta, comanda de cocina y resumen de arqueo (ancho, logo, pie de página).
- **Áreas de impresión de comandas**: cada sección del menú puede dirigir su comanda a una impresora/área distinta (cocina, barra, parrilla) — fase 2 con gestión de impresoras.
- **Canales de venta**: mesa, mostrador, para llevar, delivery (campo `canal` en cuentas desde ya; UI de delivery fase 2).
- **Seguridad por menú**: cada pantalla/acción visible según rol (matriz §3).

## 14. Roadmap corto

- v0.2: los módulos 1-7 en demo local + SQL/contrato listos.
- v0.3: conexión real a Supabase (RPCs + RLS activos), panel **super admin** con **exportar/importar empresa**, selector de **idiomas es/en/pt**, impresión silenciosa y PWA.
- v0.3 (esta entrega): seguridad de plataforma (migraciones 002: cuota oculta de artículos, auditoría, throttle, storage de miniaturas, super-entrar; re-export/import v2 con histórico) + **comensales corregibles en el salón** (003) + CRUD de zonas, arrastre persistido, layout móvil y miniaturas 45×45.
- v0.5: registration de empresa nueva desde la app, reportes y cortes.
- v0.6: impresión por red + menú digital QR.
- v0.7: inventario y recetas (insumos → costo de plato → descuento automático de stock).

## 15. Super admin de la plataforma (dueño del software, no del negocio)

Petición del dueño: "que el super admin pueda acceder a todas las empresas, que se pueda exportar e importar la base de datos de esa empresa para si crece a una versión de pago poder llevar todos los datos, que el super admin pueda cambiar el idioma de la app a los 3 que están disponibles".

- **Quién es**: una fila en `public.supers` (hoy solo el uid del dueño). No es un rol de negocio: admin/cajero/mesero siguen siendo los únicos roles dentro de una empresa.
- **Puede**: listar todas las empresas con contadores (`super_listar_empresas`), **entrar y operar** cualquier empresa sin tener membresía (`fijar_empresa` + header `X-Session-Id`; desde 002 `private.fijar_empresa` acepta super y `private.mi_rol()` le da rol admin efectivo), leer sus datos, exportar/importar, ajustar la cuota de artículos (`super_ajustar_empresa`/`super_ver_cuota`) y leer la auditoría (`super_listar_auditoria`).
- **No puede**: los RPCs de operación siguen validando empresa y rol para cualquiera; el super solo obtiene privilegios porque `public.supers` lo autoriza explícitamente, y cada "Entrar" queda auditado (`super_entro`).
- **Migrar el schema**: `schema.sql` funciona sin la tabla `supers` gracias a `private.es_super_compat()`; las migraciones se aplican en orden (§10): 001 → 002 → 003.

### 15.1 Exportar / importar (del plan gratis al plan de pago)

- `super_exportar_empresa(id) → jsonb` (**versión 2**, redefinida en 002): snapshot de empresa, zonas, mesas, secciones, productos, **histórico completo** (`cuentas`, `cuenta_mesas`, `cuenta_items`, `pagos`, `turnos_caja`) y equipo (`user_id` + correo + rol + nombre). Cada hijo lleva el **nombre de su padre** (`zona_nombre`, `seccion_nombre`) porque los uuid originales no tienen sentido en otra base.
- `super_importar_empresa(datos, código, clave_inicial='pos12345') → uuid`: recrea el catálogo **y restaura el histórico**, reasignando los dueños de cada cuenta/pago/turno (`abierta_por`, `cerrada_por`, `creada_por`, `abierto_por`, `cerrado_por`) vía el mapa `user_id` de origen → usuario recreatedo. Los usuarios inexistentes se crean con bcrypt (coste 10) y quedan confirmados. El import **no** pisa una empresa existente: exige un código libre. Un importado con 500 artículos se instala entero porque el super está exento del trigger de cuota.
- `super_registrar_exporte(id)`: el panel lo llama tras descargar el .json y deja constancia en `auditoria` de qué empresa salió de la plataforma y cuándo.
- Uso previsto: exportar JSON → el cliente lo lleva a su propio proyecto Supabase → importar (incluye ya lo facturado, no solo el catálogo). También sirve como respaldo puntual.
- Round-trip probado contra la base real (etapa 001): 2 zonas, 5 mesas (todas con su zona), 3 secciones, 9 productos (todos con su sección), 1 membresía, moneda/IVA/propina y `config` conservados. El restore del histórico es nuevo en 002.

### 15.2 Idiomas

`src/i18n/` con diccionarios `es/en/pt` de claves idénticas, hook `useIdioma()` y `t(clave, params)`; el idioma activo se guarda en `localStorage['pos-idioma-app']` y se refleja en `document.documentElement.lang`. El español es la fuente de verdad: si falta una clave, se muestra el texto español y, en último término, la propia clave (nunca un vacío). Ticket y comanda se imprimen en el idioma activo manteniendo las 32 columnas.

### 15.3 Seguridad de plataforma (002_seguridad.sql) — paridad con Catering Control

- **Cuota oculta** (§11): vive en `public.limites`, tabla deny-all; el comercio no puede leerla ni editarla (REST 403). Se exige con trigger en `productos`, no por RPC, porque el catálogo se escribe por INSERT directo. El ajuste solo lo hace el super con `super_ajustar_empresa`/`super_ver_cuota`.
- **Auditoría** (`public.auditoria`): registra entradas del super a empresas ajenas, ajustes de cuota, exportaciones (`super_registrar_exporte` tras descargar el .json), importaciones, agotamiento del throttle y cambios de comensales. Tabla oculta; única lectura: `super_listar_auditoria(empresa, límite≤1000)`.
- **Throttle** (`public.throttle` + `private.throttle_ok`): 30 `empresa_por_codigo`/IP/10 min; al agotar devuelve 0 filas (no un error) para no enumerar empresas y no revertir el conteo.
- **Storage de miniaturas**: bucket `pos-imagenes` público (solo miniaturas sin dato personal), límite 209715 B y `image/webp|image/jpeg`; 4 políticas por carpeta de empresa (`pos_imagenes_insert|select|update|delete`). Sin la política SELECT el alta falla siempre (Storage hace `INSERT…RETURNING`) — comprobado en vivo.
- **Convención de endurecimiento**: tablas de plataforma con `force row level security` sin políticas + `revoke all`; toda función pública nueva con `revoke all from public, anon` + `grant execute to authenticated` + `set search_path = ''`.

## 16. Notas de UX verificadas en navegador

- El diálogo nativo de impresión (`print()`) y `confirm()`/`alert()` **bloquean la pestaña** en browsers embebidos: toda confirmación pasa por componentes propios, y la comanda/ticket silencioso va por **Web Serial + ESC/POS** (`services/impresora.js`) con cola y reintento.
- Al probar el salón desde automation hay que despachar `PointerEvent` sintéticos sobre `.mesa` (el `click` normal no dispara el handler) y leer el snapshot **después** del re-render de React.

## 17. Estructura de archivos y rutas (espejo de Catering Control)

POS Control es **un solo `index.html`** (SPA), igual que Catering Control: el login no es otra web, es la ruta `/`. Definidas en `src/App.jsx`:

| Ruta | Pantalla | Quién la ve |
|---|---|---|
| `/` | `pages/LoginPage.jsx` | cualquiera (paso 1 empresa, paso 2 usuario) |
| `/panel` | `pages/PanelPage.jsx` | sesión activa; los módulos (`salon`, `caja`, `venta`, `menu`, `config`, `super`) se alternan en la Topbar sin cambiar de URL |
| `/terminos` | `pages/TerminosPage.jsx` | pública, desde el pie del login |
| `/privacidad` | `pages/PrivacidadPage.jsx` | pública, desde el pie del login |
| `*` | `<Navigate to="/" replace />` | cualquier ruta inventada vuelve al login |

Detalles, la tabla completa de equivalencias con la app vieja y "dónde está X" están en **`docs/NOMBRES.md`**. Reglas del proyecto:

- **Ruta de pantalla** → `src/pages/`; **piezas** (pedido, ticket, tablas, topbar) → `src/components/<dominio>/`; **lógica sin React** → `src/services/`; **hoja de estilo** con el mismo tallo que su componente (`SalonPage.jsx` ↔ `SalonPage.css`); si un CSS sirve a varios componentes de la carpeta, lleva el nombre de la carpeta (`admin.css`, `super.css`).
- **Textos**: `src/i18n/es.js` es la fuente de verdad; `en.js` y `pt.js` son su espejo (mismas claves planas con puntos). Verificar con `npm run idiomas` antes de commitear.
- **Logo / iconos**: `npm run iconos -- "ruta-del-logo.png"` regenera los 7 PNG de `public/icons/` (requiere `npm i --no-save sharp`, que NO es dependencia del proyecto). Después de cambiar iconos: actualizar `background_color` en `public/manifest.json` con el fondo que imprime el script y subir `VERSION` en `public/sw.js` para que la caché vieja se borre.

## 18. Alta del negocio, equipo y claves olvidadas (v0.5)

**Crear negocio desde el login** (`src/pages/LoginPage.jsx`, pantalla `alta`): botón "Crear mi negocio" → nombre del negocio, código, tu nombre, correo y clave. Llama a `sb.auth.signUp()` con `options.data = { alta_empresa: true, codigo_empresa, nombre_empresa, nombre, display_name }` y, como el proyecto tiene autoconfirmación desactivada, la respuesta ya trae sesión: se entra derecho al panel como `admin`. Quién hace el negocio es **la base**: el trigger `private.registrar_empresa_del_registrado()` (migración `004_altas.sql`) crea la empresa, la membresía de administrador, la zona **Salón con 8 mesas** de capacidad 4 y la cuota (`limites` lo siembra `trg_nueva_cuota` de 002).

El código de negocio es lo que escribirán los empleados para entrar: 3-24 caracteres `a-z 0-9 . _ -` (el campo lo fuerza minúsculas y quita lo inválido mientras se escribe; el mismo regex valida en el cliente y en la base). Si está repetido, el aviso sale en el formulario (`alta.codigoTomado`), porque se consulta `empresa_por_codigo` antes de registrarse y el trigger además lo rechaza con `alta_codigo_tomado`.

**Equipo** (`src/components/admin/EquipoAdmin.jsx`, al final de Configuración, solo rol `admin`): lista de las personas del negocio con `equipo_listar`, alta con `equipo_invitar` (nombre, correo, rol, clave inicial + botón "Generar" de clave silábica), "Nueva clave" con `equipo_restablecer` y "Quitar" con `equipo_revocar` (dos toques, sin `confirm()` del navegador). En modo demo el bloque muestra un aviso: no hay usuarios reales que invitar.

**Clave olvidada** (pantalla `recupera`, enlace "¿Olvidaste tu clave?" del paso 2): no hay reset por correo a propósito.
- Si es **administrador** del negocio → botón que abre WhatsApp con el mensaje ya escrito a `SOPORTE_WHATSAPP` (`src/config.js`, `59177299692`) con negocio y correo. Como super se responde entrando al panel Super → "Entrar" en esa empresa → Configuración → Equipo → Nueva clave (002 le da rol `admin` efectivo dentro de la empresa); el atajo por API es `super_resetear_clave`, todavía sin pantalla propia.
- Si es **cajero o mesero** → el texto le dice que pida clave a un administrador de su negocio, que se la da desde esa misma pantalla.

**Y el super, ¿quién lo crea?** No sale de estas pantallas: se mintea desde el SQL Editor con la migración `005_super_usuario.sql` ya aplicada ⇒ `select public.crear_super('tu@correo.com', 'ClaveSegura', 'Alex');`. Es re-pegable: si el correo existe, solo lo promove y no toca la clave (para cambiarla, el cuarto parámetro en `true`). `quitar_super('correo')` quita la marca sin borrar la cuenta. Detrás de `public.es_super()` solo hay una fila en `public.supers`, así que tampoco se puede "olvidar" el super: `select * from public.supers` lo muestra.

## 19. Despliegue en Cloudflare Pages (pos-control.pages.dev)

Es una SPA compilada por Vite: **Pages tiene que ejecutar el build y publicar `dist`**, no el repositorio. Los tres campos están en *Workers & Pages → tu proyecto → Settings → Build & deploy → Production build → Edit settings*:

| Campo | Valor |
|---|---|
| Root directory | `/` (la raíz del repo **ya** tiene `package.json` e `index.html`; no hay que mover nada) |
| Build command | `npm run build` |
| Build output directory | `dist` |

Con "Save and Deploy" (o "Retry deployment" en el último deploy) se recompila. También vale el preset *Framework = React/Vite*, que rellena esos campos.

**Cómo saber si está mal, sin abrir el panel:** `curl -s https://<dominio>/ | tail -c 200`. Si el HTML termina en `<script type="module" src="/src/main.jsx">`, está sirviendo el **código fuente sin compilar** (el navegador no entiende JSX y la pantalla queda blanca, `#root` vacío, sin errores en el build). Si está bien, dirá `<script ... src="/assets/index-<hash>.js">`. Prueba extra: si `/vite.config.js` o `/package.json` responden 200, Pages está publicando el repo tal cual, lo que además expone los `.sql` y los `docs/` en internet. Un `dist` compilado solo contiene `index.html`, `/assets/*`, `sw.js`, `manifest.json` e `icons/`.

**RAMAS / vistas previas:** cada push de rama genera un alias `HASH.proyecto.pages.dev`; la producción es el branch de producción (`main`). Para que el dominio propio apunte, *Custom domains* dentro del proyecto.

**Después de cambiar iconos o el manifiesto**, subir `VERSION` en `public/sw.js` (ver §17) o el PWA vieja seguirá sirviendo la caché anterior.
