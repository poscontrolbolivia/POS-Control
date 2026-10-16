# GUÍA · POS Control (versión gratuita multiempresa)

Guía de producto y decisiones de diseño. Referencia de inspiración: **Soft Restaurant** (simplicidad, configuración amplia, flujo mesa→comanda→cuenta→caja), corregido con lo aprendido de otros sistemas en los que trabajó el dueño.

---

## 1. Posicionamiento

POS web (React + Supabase) para restaurantes y pequeños comercios de comida:
- **Venta en mesa** (salón con mapa visual) y **venta directa al mostrador** (turno número, para llevar).
- **Versión gratuita para fichar empresas**: todas las empresas comparten UNA base de datos, pero cada usuario solo ve y opera los datos de la empresa a la que está registrado. Aislamiento por RLS + `empresa_id` en todas las tablas + RPCs que validan membresía.
- Meta: que un negocio real pueda operar el día 1 con demo local y migrar a Supabase sin cambiar la UI (la capa `store.jsx` se cambia por RPCs, mismo contrato).

## 2. Login y multiempresa (diferencia clave vs otros sistemas)

1. **Paso 1 — Empresa**: el usuario escribe/elige el código de su empresa. En la versión gratuita la lista no es pública (privacidad); se ingresa el código asignado al registrarse.
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
- Zonas (Salón, Terraza, Bar…) creadas por el admin; la vista filtra por zona.
- Mesa: nombre, forma (cuadrada/rectángula/redonda), capacidad, posición y tamaño editables **solo en modo edición (admin)**.
- Estados por color: `libre`, `ocupada`, `enviada a cocina` (hay ítems enviados), `por cobrar` (pre-cuenta). Cuentas unidas a varias mesas muestran el total global en cada mesa del grupo.
- Click en mesa libre → abrir cuenta (nº de comensales). Click en ocupada → panel de cuenta.

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
- Tablas: `empresas, perfiles, membresias, zonas, mesas, secciones_menu, productos, cuentas, cuenta_mesas, cuenta_items, pagos, turnos_caja`.
- RPCs atómicas: `abrir_cuenta, abrir_venta_directa, agregar_items, cambiar_qty_item, poner_nota, enviar_items, anular_item, unir_mesas, separar_mesa, mover_items, aplicar_extras, cobrar_cuenta, abrir_turno, registrar_movimiento_caja, cerrar_turno`.
- Ver `supabase/schema.sql` y `docs/CONTRATO.md`. El cliente hoy usa `store.jsx` (demo); la migración es 1:1 por acción.

## 11. Versión gratuita → de pago (fogging de empresas)

- Gratuita: 1 empresa 1 sucursal, 2-3 usuarios, sin facturación electrónica, soporte por formulario. La empresa se registra (nombre + código) y paga con QR de transferencia manual al inicio (Bolivia).
- Límites por RLS + columna `plan` en `empresas` (chequeada en RPCs: máx usuarios, máx mesas).
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
- v0.3 (esta entrega): conexión real a Supabase (RPCs + RLS activos), panel **super admin** con **exportar/importar empresa**, selector de **idiomas es/en/pt**, impresión silenciosa y PWA.
- v0.4: registration de empresa nueva desde la app, reportes y cortes.
- v0.5: impresión por red + menú digital QR.
- v0.6: inventario y recetas (insumos → costo de plato → descuento automático de stock).

## 15. Super admin de la plataforma (dueño del software, no del negocio)

Petición del dueño: "que el super admin pueda acceder a todas las empresas, que se pueda exportar e importar la base de datos de esa empresa para si crece a una versión de pago poder llevar todos los datos, que el super admin pueda cambiar el idioma de la app a los 3 que están disponibles".

- **Quién es**: una fila en `public.supers` (hoy solo el uid del dueño). No es un rol de negocio: admin/cajero/mesero siguen siendo los únicos roles dentro de una empresa.
- **Puede**: listar todas las empresas con contadores (`super_listar_empresas`), **entrar** a cualquier empresa sin tener membresía (`fijar_empresa` + `X-Session-Id`), leer sus datos, y exportar/importar.
- **No puede** (y no hace falta que pueda aún): operar caja o comandas de una empresa ajena sin identificarse; los RPCs de operación validan rol además de empresa.
- **Migrar el schema**: `schema.sql` funciona sin la tabla `supers` gracias a `private.es_super_compat()`; la migración `001_super.sql` se aplica después y reescribe `empresa_activa()` / `es_miembro_de()`.

### 15.1 Exportar / importar (del plan gratis al plan de pago)

- `super_exportar_empresa(id) → jsonb`: snapshot de empresa, zonas, mesas, secciones, productos, cuentas, ítems, pagos, turnos y equipo (correo+rol+nombre). Cada hijo lleva el **nombre de su padre** (`zona_nombre`, `seccion_nombre`) porque los uuid originales no tienen sentido en otra base.
- `super_importar_empresa(datos, código, clave_inicial='pos12345') → uuid`: recrea todo en la base destino y crea con clave temporal a los usuarios que no existan. El import **no** pisa una empresa existente: exige un código libre.
- Uso previsto: exportar JSON → el cliente lo lleva a su propio proyecto Supabase → importar. También sirve como respaldo puntual.
- Round-trip probado contra la base real: 2 zonas, 5 mesas (todas con su zona), 3 secciones, 9 productos (todos con su sección), 1 membresía, moneda/IVA/propina y `config` conservados.

### 15.2 Idiomas

`src/i18n/` con diccionarios `es/en/pt` de claves idénticas, hook `useIdioma()` y `t(clave, params)`; el idioma activo se guarda en `localStorage['pos-idioma-app']` y se refleja en `document.documentElement.lang`. El español es la fuente de verdad: si falta una clave, se muestra el texto español y, en último término, la propia clave (nunca un vacío). Ticket y comanda se imprimen en el idioma activo manteniendo las 32 columnas.

## 16. Notas de UX verificadas en navegador

- El diálogo nativo de impresión (`print()`) y `confirm()`/`alert()` **bloquean la pestaña** en browsers embebidos: toda confirmación pasa por componentes propios, y la comanda/ticket silencioso va por **Web Serial + ESC/POS** (`services/impresora.js`) con cola y reintento.
- Al probar el salón desde automation hay que despachar `PointerEvent` sintéticos sobre `.mesa` (el `click` normal no dispara el handler) y leer el snapshot **después** del re-render de React.
