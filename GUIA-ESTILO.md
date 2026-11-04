# Guía de estilo · POS Control

Una sola idea para toda la app: **qué tocar se ve de un vistazo**. Los colores salen del logo y viven en
`src/styles/tokens.css`; si cambias uno ahí, cambia en todas las pantallas y temas.

## Paleta (60 % azul · 30 % verde · 10 % naranja)
| Uso | Color | Token |
|---|---|---|
| Azul primario (marca, foco, selección) | `#0B5DA8` | `--logo-blue` / `--ac` |
| Azul oscuro (apoyo) | `#083D7C` | `--logo-navy` |
| Azul claro del logo (flecha: login «Entrar» y el ojito) | `#1E88C8` | `--logo-blue-claro` |
| Dorado del logo (login «Soy nuevo», letra blanca) | `#F8B030` | `--logo-dorado` |
| WhatsApp (soporte y compartir) | `#25D366` | `--btn-whatsapp` |
| Verde primario (acción principal) | `#1F8236` (el verde del logo `#248F3C`, un paso más oscuro para que el texto blanco tenga contraste AA) | `--btn-green` |
| Verde claro (brillo, estados) | `#4CC248` | `--logo-green-claro` |
| Naranja (atención) | `#F68B1F` | `--logo-orange` |
| Amarillo (acento) | `#F7C63D` | `--logo-yellow` |
| Rojo (destructivo) | `#E4002B` | `--btn-red` |
| Neutros | `#FFFFFF` `#F3F5F7` `#A0A8B0` `#444B52` | `--card` `--gris-claro` `--gris-medio` `--gris-oscuro` |
| Texto | `#1F2937` / `#4B5563` | `--ink` / `--mut` |

## Botones (la regla que no se rompe)
0. **Dentro de la app NO hay botones con fondo blanco ni transparente.** Todo botón es de color sólido con texto claro
   (con el degradado `--gloss` y sombra del mismo color). Lo que antes era «ghost» ahora es azul sólido.
1. **Principal = verde sólido** (`success` o `primary`). **Uno solo por paso, pantalla o diálogo**: la siguiente acción lógica.
2. **Secundario = `ghost`**: **azul sólido** (`--btn-sec`, = `--logo-blue`) con texto blanco. Todo lo demás. El nombre se
   conserva por compatibilidad: no tiene nada de transparente.
3. **Destructivo = `danger`** (rojo suave). `danger solid` solo para confirmar algo irreversible.
4. `violet`, `teal`, `slate` = azul oscuro sólido, solo para una acción de apoyo importante. `orange` y `warning` solo marcan estado o atención; no son acciones normales.
5. Si hay más de 3 botones a la vista, lo menos frecuente va en **«Más…»** (`<MasMenu>`).
6. **Menús desplegables de Configuración** (bloques e Impresoras): píldoras sólidas. Nivel 1: azul oscuro cerrada y verde
   abierta. Nivel 2: azul cerrada y azul claro abierta. Nada de píldoras grises o blancas.

## Login (único lugar con colores propios)
- **Entrar** y el **ojito**: `--logo-blue-claro` con degradado.
- **Soy nuevo**: `--logo-dorado` con el degradado de WhatsApp y **letra blanca** (con sombra de texto oscura para leerse).
- **Compartir** y **Soporte**: mismo verde y degradado de WhatsApp (`--btn-whatsapp`).

## Menús con submenús (Salón por zonas, Caja)
- **Caja y reportes es UN solo menú** con submenús como los salones del mapa: **Caja** (turno y cobros) · **Cierres de caja**
  (solo admin) · **Reportes** (quien tenga `ver_reportes`). Se arma en `CajaHub`; los enlaces `#caja`, `#cierres` y `#reportes`
  abren el submenú correspondiente. No crear otra pestaña para algo que ya es un submenú.
- Los submenús son píldoras `.tab`: **la marcada es azul sólido** (`.tab.on`), las demás chips. Un CSS de pantalla nunca debe
  poner `background`/`border` a `.tab` (pisa la marcada): solo tamaño, o `.tab:not(.on)`.

## Configuración
Un bloque abierto a la vez: **Idioma y tema · Datos del negocio · Modo de caja · Impresoras · Equipo · Plan**.
Aquí solo van ajustes: el turno, los cierres y los reportes viven en el menú Caja. Los ajustes que se guardan al instante
(modo de caja, mostrar propina) no llevan botón Guardar; los datos del negocio sí.

## Edición del mapa
Al editar, el mapa guarda cada cambio al instante. **✓ Terminar edición** los conserva y **✕ Cancelar edición** los deshace
(pide confirmar en línea y vuelve a dejar mesas y salones como estaban al entrar; lógica en `descartarEdicion.js`).

## Pantallas
- **Ancho y espacio**: `--pagina-max`, `--pagina-pad`, `--pagina-gap`. Despacho es la excepción: usa todo el ancho para ver más comandas.
- **Cabecera**: siempre `<CabeceraPagina titulo datos acciones />`: título a la izquierda, acción principal a la derecha.
- **Avisos y vacíos**: siempre `<Aviso>` (icono + texto + botón si hace falta). No crear estilos nuevos.
- **Tamaños táctiles**: botones de 44 px de alto como mínimo (48 px en Despacho).
- **Textos**: todo en `es.json`, `en.json` y `pt.json`.

## Iconos en botones (poco y siempre igual)
Un botón con texto **no lleva emoji** salvo que sea de esta lista corta, y entonces el mismo texto lleva siempre el mismo icono:
| Acción | Icono |
|---|---|
| Añadir / Nuevo / Invitar / Registrar | ＋ |
| Editar / Renombrar | ✎ |
| Eliminar | 🗑 |
| Cancelar / Cerrar / Quitar / Descartar / Rechazar | ✕ |
| Confirmar / Aprobar / Resolver / Marcar listo / Terminar edición | ✓ |
| Deshacer | ↩ |
| Actualizar / Probar de nuevo | ↻ |
Además se conservan: ← Atrás, ▲▼ ▾▸ (ordenar y desplegar), los métodos de pago (💵 Efectivo · 📱 QR · 💳 Tarjeta),
los modos 🪑 Mesas · 🥡 Para llevar · 🧾 Mostrador y 🧩 Mapa · ☰ Lista. El resto (🔥 🖨 📄 📷 ↺ ✂ 🔗…) no se usa.
Un botón solo con icono (sin texto) sí puede llevar cualquiera de los anteriores, con `aria-label`.

## Mapa / Lista
Siempre con `<VistaMapaLista>` (🧩 Mapa · ☰ Lista), a la **derecha** del encabezado, igual en Salón, Caja y Reportes.
En Salón, **Editar mapa** (y al editar: Terminar / Cancelar) va **abajo, junto al zoom** (− 100 % +), no arriba.

## Panel de pedido
Barra fija: **← Atrás · nombre de la mesa · acción principal** (sin icono). Debajo, los pasos; luego la fila
**Comensales · quién abrió y hora · ⋯**. No se repite el estado («abierta») porque ya lo dicen los pasos.

## Dónde va cada botón (regla de colocación: no se negocia)
La misma función va **siempre en el mismo sitio**, con el mismo texto, icono y color, en todos los menús.
| Lugar | Alineación | Orden de izquierda a derecha |
|---|---|---|
| **Encabezado** de pantalla o sección (`CabeceraPagina`, `.adm-card-cab`) | Grupo a la **derecha** | herramientas secundarias → Mapa/Lista → **principal al final** (extremo derecho) |
| **Pie** de formulario, diálogo o confirmación (`.barra`) | A la **izquierda**, justo debajo de los campos | **principal primero** → secundarios → **Cancelar al final**. Si lo que se confirma es destructivo, el rojo sólido va primero |
| **Fila** de una lista o tabla | A la **derecha** de la fila | lo frecuente → **«Más…» al final**; lo destructivo va dentro de «Más…» |
| **Pestañas y zonas** | Debajo del encabezado, a la izquierda | las zonas van **siempre arriba** del mapa o lista, nunca debajo |
| **Móvil** (≤ 640 px) | El grupo de acciones baja a **su propia línea, a todo el ancho** | mismo orden que en escritorio |

Reglas que salen de ahí:
1. **Mapa/Lista** es siempre `<VistaMapaLista>`, a la derecha del encabezado, igual en Salón, Caja, Venta directa y Reportes.
2. **Actualizar** es siempre un `ghost` dentro del grupo de acciones del encabezado; nunca suelto en el cuerpo.
3. **Crear / Nuevo** es siempre el verde principal, al final del grupo derecho del encabezado.
4. Un botón **nunca flota solo** en el lado opuesto de la pantalla. Si no cabe junto al título, baja a su línea.
5. Si dos pantallas hacen lo mismo (ej. editar un ítem, añadir un insumo), sus botones se ven y se colocan igual. Antes de
   inventar una colocación nueva, copia la de la pantalla que ya hace lo mismo.

## Textos y números que no se cortan
1. **Las mesas de un mapa son `<div role="button" tabIndex={0}>` con `onKeyDown`, jamás `<button>`.** Safari no usa `<button>`
   como contenedor de medidas y el número sale gigante y cortado. `npm run estilo` lo comprueba.
2. Todo texto dentro de una caja de tamaño variable (mesas, tarjetas, píldoras) se mide con unidades de contenedor
   (`cqw`/`cqh`) sobre un elemento con `container-type:size`; nunca con `px` o `rem` fijos.
3. Lo accesorio (zona, personas, importe, cifra) se oculta con `@container (max-height:…)` cuando no cabe. Lo esencial (el
   número de la mesa) siempre se ve completo.
4. Texto en línea: `min-width:0` y `overflow:hidden; text-overflow:ellipsis` (o `overflow-wrap:anywhere`). Nunca
   `overflow:hidden` solo.
5. Ventanas nativas del navegador (`alert`, `confirm`, `prompt`): prohibidas; se usa un aviso o recuadro en línea. También lo comprueba `npm run estilo`.

**Lista de revisión antes de entregar una pantalla:** ¿se ve bien a 360 px de ancho y en los tres temas? ¿cada botón está en el
sitio que le toca según la tabla de arriba? ¿hay un solo verde? ¿los textos están en es/en/pt? ¿pasa `npm test`?
