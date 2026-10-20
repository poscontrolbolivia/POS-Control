# v0.30.0 · Para llevar en el Salón + exportación completa de una empresa
- **Para llevar** (Salón → pestaña 🥡 junto a «Todas»): **＋ Nuevo cliente** pide nombre (obligatorio) y teléfono (opcional) y crea el pedido «Cliente 1 para llevar · Ernesto». Los números siguen 1, 2, 3… y **reinician cada día**, aparte de los turnos del mostrador. El pedido sigue abierto mientras se prepara: se le agregan productos, se envía a cocina/barra y se cobra desde Caja como cualquier cuenta.
- **✎ Editar cliente** cambia nombre/teléfono. **➜ Pasar a mesa** lista las mesas libres, pide comensales y mueve la cuenta (con lo ya enviado a cocina) a esa mesa; el Salón salta a esa mesa. El nombre del cliente sale en la comanda y en el ticket.
- Mientras se mira la pestaña, los otros aparatos se refrescan cada 20 s (el mesero y el cajero ven los mismos pedidos).
- **Exportar «Completo (.zip)»** (Super admin → tabla de empresas): `datos.json` + las **fotos reales** de productos y los comprobantes QR. Ahora el respaldo (versión 3) incluye también **inventario (insumos, recetas, movimientos), devoluciones, áreas listas de cocina y las áreas del equipo**.
- **Importar** acepta `.zip` o `.json`. Con `.zip` se restauran las fotos en la empresa nueva (se suben a su carpeta). Con `.json` se recrea todo menos las fotos.
- **Corregido el importador**: antes recreaba productos solo con nombre, precio y activo; ahora conserva número de ítem, áreas de impresión, opciones, notas/extras de cada ítem, etiquetas de mesa 2a/2b, detalle de cuenta, modo del turno y los vínculos devolución ↔ ítem ↔ turno.
- SQL: `install/supabase-setup-final.sql` (vuelve a pegarlo; es idempotente). Columnas nuevas en `cuentas` (`canal`, `cliente_nombre`, `cliente_tel`); funciones nuevas `abrir_para_llevar`, `editar_cliente_llevar`, `pasar_llevar_a_mesa`; `super_importar_empresa` ahora devuelve jsonb y recibe `p_con_fotos`. Siguen siendo solo 2 SQL. **Pégalo ANTES de publicar la web.**
- Librería nueva: `jszip` (se carga solo al exportar/importar).
- Verificado: build, `check-i18n`, tests nuevos `tests/respaldoZip.mjs` (8 ✓) y sintaxis SQL (pglast). NO probado en navegador ni contra una base real de Supabase. `tests/ticket.mjs` ya fallaba (12) en v0.29.0, igual que ahora; no lo toqué.

# v0.29.0 · PDF de cierre de turno / de día y comprobantes en Caja
- **PDF automático al cerrar**: al confirmar el cierre de caja se descarga un PDF. Si el negocio trabaja **por cajero** es «CIERRE DE TURNO» (el de ese cajero); si trabaja **compartida / 24 horas** es «CIERRE DEL DÍA». También hay un botón **📄 PDF del turno** en Caja para sacarlo antes de cerrar.
- **Contenido**: datos del negocio, quién abrió y cerró, cuentas cobradas, personas atendidas, **consumo promedio por persona**, ticket promedio; ventas (consumo, descuentos, propinas, **TOTAL DE VENTAS**) y por método (efectivo, QR, tarjeta); devoluciones; caja (fondo, ingresos, egresos, esperado, contado, diferencia); **cantidad de cada plato (Cocina) y de cada bebida (Barra)** con importes y subtotales; los 5 más vendidos; y la lista de **comprobantes QR con su enlace** a la foto.
- Platos y bebidas se separan por el **área de impresión** del producto (Cocina = platos, Barra = bebidas; otras áreas salen con su propio nombre). Los ítems anulados no cuentan.
- **Comprobantes en Caja**: cada ticket de la lista del turno muestra **📎** por cada pago con foto.
- Los enlaces de fotos del PDF son temporales (**7 días**); pasado ese plazo la foto se abre igual desde 📎 en Caja.
- Librería nueva: `jspdf` (se carga solo al generar el PDF; no pesa en el arranque). Sin SQL nuevo.
- Verificado: build, `check-i18n`, `tests/cierre.mjs` (11 ✓, incluye generar el PDF) y revisión visual del PDF. NO probado con un cierre real en navegador. Pendiente: volver a bajar el PDF de un cierre antiguo desde el historial (hoy solo se genera al cerrar o con el botón del turno abierto).

# v0.28.0 · Foto del comprobante en cobros con QR
- Al elegir **QR** como método de pago (cobro de cuenta, abono y venta de mostrador) aparece **📷 Tomar foto** (abre la cámara del teléfono), **🖼 Subir foto** y la nota «Opcional: puedes omitirla». Con foto puesta se ve la miniatura, **Cambiar** y **Quitar**. Si no pones nada, cobra igual.
- La foto se reduce en el aparato (máx. 1280 px, ~300 KB) y se guarda en un **bucket privado** `pos-comprobantes` (solo miembros de la empresa; se ve con enlace temporal de 5 min). La ruta viaja en `pagos.detalle.comprobante`, sin columnas nuevas. En modo demo queda solo en memoria.
- El botón de cobrar espera a que termine de subir la foto, para no perderla.
- En la cuenta, cada pago con comprobante muestra **📎** para abrirlo.
- SQL: bucket y políticas añadidos a `install/supabase-setup-final.sql` (vuelve a pegarlo; es idempotente). Siguen siendo solo 2 SQL.
- Verificado: build, `check-i18n`, tests existentes y sintaxis SQL. NO probado con cámara real ni contra la base. Pendiente: ver el comprobante también desde Caja.

# v0.27.0 · Precio extra y opciones que son productos (tercer paso)
- **Min. por unidad** en cada lista (p. ej. «2 gaseosas»: obligatoria, mín. 2, máx. 2). Antes solo había obligatoria + máximo.
- **Precio extra por opción** (salsa especial +2): se suma al precio de esa unidad; el chip lo muestra y el ticket cobra el total.
- **Opción = producto de inventario**: cada opción puede apuntar a un producto; al **cobrar**, se descuenta del inventario la receta de ese producto (×cantidad de la unidad). Ejemplo: producto «Combo parrilla» con listas «Carne» (opciones ligadas a Lomo, Costilla…) y «Gaseosas» (mín. 2, máx. 2).
- **Seguridad**: el cliente solo manda lista y opción; el **servidor** lee precio extra y producto de `empresas.config.indicaciones` (nunca confía en un precio del navegador).
- SQL: `cuenta_items.extras` (jsonb), `agregar_items` y `cobrar_cuenta` actualizados. Todo está en `install/supabase-setup-final.sql` (vuelve a pegarlo; es idempotente). Siguen siendo solo 2 SQL: el setup y el de super admin.
- Verificado: build, `check-i18n`, `tests/indicaciones.mjs` (12 ✓) y sintaxis SQL (pglast). NO probado en navegador ni cobrando de verdad.

# v0.26.0 · Listas de indicaciones y pedido por unidad (segundo paso)
- **+ Indicaciones** (Menú): crea una lista con nombre y opciones (p. ej. «Término de carne»: Azul, Medio, ¾, Bien cocida), **obligatoria u opcional** y **máximo por unidad** (1, 2… o sin límite). Se aplica a **grupos completos** o a **productos sueltos**; un producto puede tener varias listas. Las «opciones» sueltas antiguas de cada producto siguen funcionando como una lista opcional, así no se pierde nada.
- **Cartel al tocar un producto con indicaciones**: botones **− / +** para la cantidad y debajo las listas. Cada toque en una opción se aplica a la unidad en curso y, al completarla, pasa a la siguiente: **3 carnes y tocar 3 veces «Azul» = 3 carnes término azul**. Se puede tocar el número de una unidad para corregirla. No deja agregar mientras falte una opción obligatoria en alguna unidad. Campo de **texto libre** por unidad.
- Cada unidad viaja como su propio ítem con su nota; las iguales se juntan solas («2× Carne — Medio») y las distintas quedan separadas en la comanda.
- Las listas se guardan en `empresas.config` (jsonb existente): **no hay SQL nuevo** en este zip.
- Pendiente (tercer zip): **precio extra** por opción y **opciones que son productos** con descuento de inventario (combo parrilla + 2 gaseosas). Eso sí toca el SQL (`agregar_items` y el descuento de inventario).
- Verificado: build, `check-i18n` y `tests/indicaciones.mjs` (9 ✓). NO probado en navegador ni contra la base real.

# v0.25.0 · Menú reestructurado (primer paso)
- **Pantalla Menú nueva**: con el negocio vacío solo se ve **+ Grupo**; con grupos, también **+ Producto**. Los grupos aparecen **minimizados** (nombre, nº de productos y a qué impresora/área van) y se abren al tocarlos; **Mostrar todo / Ocultar todo**.
- Dentro de un grupo cada producto es una fila compacta: **Nº de ítem · nombre · precio · Editar**; se ordena tocando el encabezado de cada columna (Nº, Nombre, Precio) y hay un **buscador** por número, nombre o precio (abre solo los grupos con coincidencias).
- **+ Grupo / Editar grupo / + Producto / Editar producto abren en primer plano** (ventana encima de todo, Esc o tocar fuera para cerrar, Guardar / Cancelar). En la ventana del grupo se elige a qué impresora/área se envía; en la del producto: nombre, precio, grupo, foto, visible, «agotado hoy», eliminar y, en «Avanzado», imprimir en otros grupos (p. ej. combo cocina + barra). Se conservan los cambios masivos (precio %, precio fijo, mover de grupo, áreas, activar/ocultar, agotado).
- **Nº de ítem**: consecutivo por negocio y **no se reutiliza** aunque se borre un producto (`productos.numero`, `empresas.contador_productos`, trigger; los productos existentes se numeran por orden de creación). Requiere volver a pegar `install/supabase-setup-final.sql`.
- Pendiente (siguientes zips): listas de **Indicaciones** con reglas por unidad, cartel de cantidad (+/−) al tocar un producto con indicaciones, texto libre, precio extra y opciones que son productos con descuento de inventario (combos). La caja de «indicaciones rápidas» actual se mantiene mientras tanto.
- Verificado: build, `check-i18n` y SQL (pglast). `npm test` muestra 12 ✗ en `tests/ticket.mjs` que **ya existen en la v0.24.0** (el test no encuentra el encabezado CANT/DESCRIPCION/P.UNIT/IMPORTE); no los causa este cambio. NO probado en navegador ni contra la base real.

# v0.24.0 · cobro por partes, teclado fluido, rojo de peligro, cocina en demo, ticket como Soft Restaurant y una sola marca
## Marca de color: el verde es la marca, el azul manda en la información
Hasta ahora la app tenía **dos colores peleándose por el puesto de "principal"**: el verde del logo (mayoría de usos) y el azul heredado del login de Catering Control, que era el que vestía los botones primarios. Decidido: **verde = marca, azul = interacción e información**, y así queda en los 3 temas.
- `button.primary` (28 botones: Cobrar, Guardar cambios, Abrir turno, Confirmar) pasó de azul a **verde `#238f41`**; `button.info` (8: Buscar, Editar, Sumar días) se queda **azul**, que es lo que significa "información". `button.success` ya era verde y se mantiene.
- El azul sigue mandando donde el usuario elige, no donde la app se presenta: `--sel` (pestaña activa, sección seleccionada, área elegida), el foco de los campos, los chips sin seleccionar y los enlaces.
- La **placa del logo y el halo del login** (`--ac` → `--verde`) son ahora de marca: la primera pantalla de la app ya no es azul de otra app.
- Se acabó el tercer verde: `--ok`, `--ok-ink`, `--ok-bg` y `--ok-bd` apuntan a los verdes de marca (antes había un `#1d7a35` suelto). En el tema noche quedan en `#7be0a0` por contraste.
- El tema **forest** ya no re-inventa la marca: antes ponía `--ac` verde y `--sel` verde, así que era una segunda versión de la identidad. Ahora los tres temas comparten `--verde:#238f41` de marca y `--sel:#1f6fd0` de selección; forest solo cambia superficies y tinta.
- Medido en el navegador (estilos calculados, no a ojo): en los 3 temas el botón «Cobrar» sale `rgb(35,143,65)` y la pestaña activa `rgb(31,111,208)`; la placa del logo y «Entrar» del login también salen verde en los 3. Quedan 3 usos de `--btn-blue`: el estado seleccionado, `.eq-area.on` de Equipo y el modificador `.cc-blue` del login, los tres con rol informativo.
- `npm test` (56 ✓) y build en verde. Falta que lo veas en pantalla: es un cambio de identidad, se juzga mirando.

## Ticket con la estructura de Soft Restaurant
- **Encabezado como el de Soft Restaurant** (nombre del negocio en cuerpo doble, **sucursal**, **dirección** y `Tel … · NIT …` uno bajo otro). Los cuatro campos se editan en **Configuración · Datos del negocio** y viajan en el jsonb `empresas.config` que ya existía: **no hace falta aplicar SQL nuevo**.
- **Salón, mesa y el que atiende en cuerpo doble**, uno por renglón. En venta de mostrador dice «MOSTRADOR» y «Cajero: …» en vez de «Mesero».
- **Datos genéricos**: `Orden: n` (el lugar de la cuenta entre las abiertas el mismo día) y `Personas: n` en el mismo renglón; `Abrió: fecha hora`, `Cobró: fecha hora` y `Cajero: el que cobró` uno por renglón. La fecha ahora sale **sin segundos**.
- **Tabla de 4 columnas**: `CANT · DESCRIPCION · P.UNIT · IMPORTE`, con los montos alineados al borde derecho del papel en 32, 42, 48 y 80 columnas.
- **TOTAL en cuerpo doble**, y debajo **3 renglones punteados** (`. . . .`) para que el cliente anote algo a mano.
- **«NO ES UN COMPROBANTE FISCAL»** (y «PROPINA NO INCLUIDA» si está configurado el porcentaje), gracias, y al pie la marca con la versión leída de `package.json`: `*** POS CONTROL v0.24.0 ***` (`vite.config.js` → `__APP_VERSION__` → `VERSION`).
- Dos cortes de datos encontrados al medir el renderizado (no a ojo):
  - Las filas de columnas se hacían `L.push(cadena)` en vez de `L.push({ texto: cadena })`, así que el encabezado de la tabla y **todos los ítems salían en blanco** y solo se veían las continuaciones. Corregido.
  - Un producto de más de 13 letras o un monto de 6 cifras se **recortaba en silencio**. Ahora lo que no cabe en su columna continúa en el renglón siguiente y un monto largo le roba columnas a la descripción en vez de pasarse del ancho del papel.
- Nuevo `tests/ticket.mjs` (dentro de `npm test`): arma el ticket con el propio módulo de la app (SSR de Vite) y mide 30 cosas — 4 anchos de papel, montos normales y de seis cifras, que ningún renglón se recorte, que las columnas cierren en el borde, el orden de la estructura, el punteado, el anulado, la marca con versión y la salida ESC/POS (56 renglones → 56 renglones, cortina incluida).
- **PC437 de la impresora**: faltaban `·` (0xF7) y `—`, así que en papel el encabezado `Tel … · NIT …` y las rayas de los ítems anulados salían como «?». Ahora tienen su byte.
- 1 109 claves i18n en es/en/pt, `npm test` y build en verde. **No probado imprimiendo en papel** (la salida ESC/POS, el modo texto del agente y la vista de Windows comparten `lineaATexto`, que es lo que mide el test).

## Cobro por partes, teclado, colores, caja y cocina
- **Cobro parcial**: en una cuenta abierta, al pulsar «Cobrar» aparecen casillas junto a cada ítem. Se marcan las 2 cervezas, el botón «Poner selección (Bs …)» vuelca ese subtotal en la línea de pago y «Abonar Bs …» cobra solo eso **dejando la mesa abierta con su saldo** (la mesa sigue pedida, sigue en salón y en caja). Sirve también para el del grupo que se va pagando su parte: se marca su ítem o se escribe el monto a mano. Si el abono cubre todo el saldo, el servidor lo rechaza y hay que usar «Confirmar cobro».
  - Nuevo RPC `public.abonar_cuenta(p_cuenta_id, p_pagos, p_empresa_id)` en `install/supabase-setup-final.sql` (idempotente, `create or replace`). Suma el efectivo del abono al `venta_efectivo` del turno **en el momento del abono** (el dinero ya está en el cajón), y la descripción de lo marcado viaja en `pagos.detalle.concepto` — sin columnas nuevas.
  - `cobrar_cuenta` ahora descuenta los pagos previos al calcular cuánto falta. `cerrar_turno` cuenta el efectivo por la fecha del pago (`pagos.creada_en`), no por la del cierre del turno.
  - El saldo se ve en todas partes: en la ventana de la cuenta (líneas «Pagado −», «SALDO» y cada abono con su hora), en salón y en el resumen de cajas (total en negro + ✓ abonado en verde), en el traspaso de caja y en el ticket (`Abono: 2× Cerveza` + `SALDO`).
- **Teclado que saltaba al escribir un monto** (causa raíz, dos capas):
  1. Los campos de dinero eran `type="number"`; en cuanto el texto era intermedio («19.», «,5») el navegador devolvía cadena vacía, React lo vaciaba y el cursor salía. Ahora son `type="text"` con `inputMode="decimal"` + `autoComplete="off"` en toda la app (cobro, caja, pre-arqueo, cierre, fondo, movimientos, configuración, inventario, carta) con `onFocus select` para reemplazar de un golpe.
  2. El de verdad: la cabecera de la ventana de cuenta reenfocaba el botón «← Salir» **en cada tecla**, porque su efecto dependía de `onClose` (una función nueva en cada render). Medido en el navegador: tras `Retroceso`, `document.activeElement` era `BUTTON.pm-atras`. El efecto ahora depende solo del montaje.
  - `limpiarMonto` reescrito con la regla del último separador: `1.234,56` era `1.23` (guardaba Bs 1,23 en vez de Bs 1.234,56). Cobijado por `tests/montos.mjs` (14 aserciones, ya dentro de `npm test`).
- **Rojo = atrás / borrar / restar / precaución** en toda la app: ✕ de nota, propina, descuento y líneas de pago; «Cancelar», «Quitar», «Quitar foto», «✕ Limpiar», «Volver» (venta en mostrador y enlaces del login) y «Eliminar» del menú ⋯. El botón de «Egreso» de caja pasó a rojo sólido (resta del cajón). `+`/`−` ahora son verde/rojo sólidos también en el tamaño y capacidad de las mesas (`me-step`), «Aplicar» del descuento es azul de marca, y «＋ Agregar línea», «＋ Añadir línea», «＋ mesa» y «Segundo pago» son verdes, y los chips de filtro sin seleccionar llevan tinte de acento en vez de gris.
- **Caja reordenada**: arriba el mapa o la lista de mesas (igual que en salón, con su saldo y su abono), debajo el turno, los movimientos y los tickets; botón de **pre-arqueo** (cuenta sin cerrar el turno) aparte del cierre. El historial de cierres se fue a **Configuración** (solo administradores) y todas las secciones de configuración son tarjetas cerradas que se abren al tocar.
- Cocina y Barra también funcionan en modo demo (la cola se arma con los pedidos guardados en el equipo), para poder probar y demostrar sin servidor.
- Build de Vite en verde. Las claves i18n y `npm test` se miden al final, en el punto anterior.

---

# v0.23.0 · sistema de diseño (tokens) y orden visual
- **Causa raíz del «desastre»**: `base.css` se importaba DESPUÉS de toda la app, así que ganaba siempre a los CSS de cada pantalla. Por eso había `!important`, parches `html .x` y la mesa no abría a pantalla completa. Ahora se importa PRIMERO (`main.jsx`): cada pantalla puede sobrescribirlo sin trucos.
- **Nuevo `src/styles/tokens.css`**: único lugar con colores, sombras y radios (3 temas: claro, nocturno, bosque). Cero colores hexadecimales fuera de ese archivo (los 217 pasaron a variables). Los colores de peligro/correcto/aviso, roles (admin, cajero, mesero, cocina, barra) y banners tienen ahora versión para cada tema: en nocturno ya no quedan textos rojo-oscuro sobre fondo oscuro.
- **Seleccionado = `--sel`** (azul de marca con degradado y sombra, como Catering Control): UNA sola regla en `base.css` reemplaza las 5 copias (antes naranja liso con `!important`). Para volver al naranja basta `--sel: var(--btn-orange)` en `tokens.css`. En tema bosque usa el verde.
- **Barra superior**: queda en UNA fila en móvil e indica el módulo actual cuando el menú ☰ está plegado; pestañas con hover; sombra suave.
- **Mesa a pantalla completa** (corregido: antes salía como tarjeta flotante) y centrada en pantallas grandes.
- **Venta directa**: las fichas de producto ya no cortan palabras («Sándwic-h»).
- Tarjetas, campos y foco con la misma sombra/radio del sistema (`--sh-1`, `--r-md`…).
- `!important` solo queda en la regla anti-zoom de iPhone y 3 ajustes locales. Sin hex en `.css`/`.jsx` (excepciones deliberadas: `theme.js` color de la barra del navegador y `printWindows.js` papel blanco/negro).
- Verificado con capturas reales (Chromium) en móvil y escritorio, temas claro/nocturno/bosque; `npm test` y build verdes. NO probado con Supabase real.

---

# v0.22.3 · orden interno (sin cambios visibles a propósito)
- `--btn-blue/green/orange/yellow/teal` estaban definidos DOS veces en `base.css`: una con un color fijo y otra, más abajo, apuntando al logo. La primera quedaba muerta (la tapaba la segunda) — quedó solo la del logo, en un único lugar.
- «Pestaña/opción activa» (`.tab.on`, `.ck-tab.on`, `.vd-tab.on`, `.me-opc.on`…) tenía 5 reglas repartidas en 5 archivos de pantalla distintos, y no eran iguales: Cocina la pintaba azul con degradado; el resto, naranja liso. Ahora es una sola regla en `base.css`; todas quedan iguales (naranja del logo).
- Sin esto no hay forma fácil de saber, a simple vista, cuál de las 5 copias es «la buena» al tocar el color más adelante.

---

# v0.22.2 · deshecho el barniz parejo de botones
- La corrección de botones de la entrega anterior pintaba TODO botón sin clase de navy sólido y todo `.ghost` de celeste sólido, con una especificidad tan alta que tapaba el color propio de botones que ya lo tenían (ej. el de compartir del login, que ya era verde pero quedaba navy). Son ~90 botones los que usan `.ghost` (cancelar, cerrar, exportar, probar impresora…) y se pintaron todos igual sin que lo pidieras.
- Revertido: `button` y `button.ghost` vuelven a su estilo neutro (transparente/tarjeta) de siempre. Los colores por función que SÍ quieres se mantienen por clase, no a lo bruto: `.primary`/`.info` azul, `.success` verde, `.danger.solid`/`.rojo` rojo (ya en degradado, sin tocar), pestañas activas naranja.
- El botón de compartir del login vuelve a su verde de siempre (ya no lo tapaba el navy).
- El de mostrar/ocultar contraseña, que no tenía clase y por eso se veía como un botón en blanco, ahora tiene su propio círculo celeste (`.lg-ojo`): es un simple interruptor, no crea ni guarda ni elimina nada.

---

# v0.22.1
- **Zoom involuntario**: en iPhone/iPad el navegador hacía zoom al tocar un campo (por ejemplo Caja → + Ingreso). Se evita con `maximum-scale=1` solo en iOS (el zoom con los dedos sigue funcionando) y fijando los campos a 16 px mínimo con `!important`, porque varias reglas con `font: inherit` dentro de etiquetas pequeñas los bajaban a ~13 px. Android y PC no cambian.
- **Casillas que se salían del margen**: red de seguridad global (`base.css`): campos y etiquetas pueden encogerse (`min-width:0`, `max-width:100%`), los mínimos de cada pantalla se acotan con `min(…, 100%)` (Caja, Salón, Impresoras, Equipo) y el `body` no se desplaza de lado.
- **Colores del logo**: los botones que seguían con el color del tema (pestaña de zona activa, botones de icono ✎ ✕ ✓) pasan a los colores sólidos del logo.
- **Impresoras sin pasos manuales**: al abrir la app en una PC con el agente instalado (`instalar-agente.bat`, arranca solo con Windows), los grupos sin configurar usan la impresora predeterminada de Windows. Solo PC; no toca lo ya elegido.
- Verificado en una base Postgres local: turno por cajero (cada uno con su fondo, su efectivo esperado solo de lo que cobró, cierres separados e historial por turno) y Premium por días (suma, indefinido, vuelta a Básico). Los cambios de pantalla compilan pero NO se vieron en un teléfono real.

# v0.22.0
- **Modo de caja por empresa** (Configuración → Modo de caja): «Caja compartida» (un turno para todo el local, como hasta ahora) o «Un turno por cajero» (cada cajero abre, cuenta y cierra el suyo; su efectivo esperado sale solo de lo que él cobró). Se guarda en `empresas.config.cajaModo`; cada turno recuerda con qué modo se abrió (`turnos_caja.modo`).
- Servidor: `private.caja_modo`, `private.turno_actual`; `abrir_turno`, `cerrar_turno`, `registrar_movimiento_caja`, `cobrar_cuenta`, devoluciones y `cierres_listar` ahora respetan el modo. Un cajero no cierra el turno de otro (solo el admin); en el historial el cajero ve solo sus turnos y el admin todos.
- Pantalla de caja: en modo por cajero muestra MI turno y avisa de los otros turnos abiertos. El modo no se puede cambiar con turnos abiertos.
- Pendiente: que el admin cierre desde la pantalla el turno de otro cajero (el servidor ya lo permite con `p_turno_id`). SQL validado con pglast; NO probado contra la base real ni en navegador.

# v0.21.1
- Corregido `cierres_listar`: los ingresos/egresos de caja se leían con la clave equivocada (`t` en vez de `tipo`) y salían en 0 en el historial de cierres.

# v0.21.0
- **Premium por días o indefinido** (super): `super_cambiar_plan(p_empresa, p_plan, p_dias)`; los días se SUMAN a los vigentes; al vencer la empresa vuelve sola a Básico (`limites.premium_hasta`, cron cada hora + comprobación al pedir `mi_plan` y al aplicar cuotas). En la tabla del super hay columna **Plan** y el botón **Plan / Premium** con +30/+90/+365 días, N días, indefinido y volver a Básico.
- **Historial de cierres** (Caja): RPC `cierres_listar(p_desde, p_hasta)`; por turno y agrupado por día (sirve para 24 h: el turno puede cruzar la medianoche), con efectivo/QR/tarjeta, ingresos, egresos, esperado/contado/diferencia, devoluciones y descarga CSV.
- **Colores del logo** en todos los botones (sólidos, sin transparencia ni dependencia del tema): paleta en `base.css` (`--logo-*`).
- Super en móvil: la tabla de empresas pasa a tarjetas; casillas/selectores ya no se salen de su tarjeta (impresoras, formularios).
- Equipo e Impresoras: los botones mostrar/ocultar quedan a la izquierda.
- SQL: todo dentro de `install/supabase-setup-final.sql` (sección v0.21). Validado con pglast; NO probado contra la base real ni en navegador.
