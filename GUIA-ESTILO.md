# Guía de estilo · POS Control

Una sola idea para toda la app: **qué tocar se ve de un vistazo**. Los colores salen del logo y viven en
`src/styles/tokens.css`; si cambias uno ahí, cambia en todas las pantallas y temas.

## Paleta (60 % azul · 30 % verde · 10 % naranja)
| Uso | Color | Token |
|---|---|---|
| Azul primario (marca, foco, selección) | `#0B5DA8` | `--logo-blue` / `--ac` |
| Azul oscuro (apoyo) | `#083D7C` | `--logo-navy` |
| Verde primario (acción principal) | `#1F8236` (el verde del logo `#248F3C`, un paso más oscuro para que el texto blanco tenga contraste AA) | `--btn-green` |
| Verde claro (brillo, estados) | `#4CC248` | `--logo-green-claro` |
| Naranja (atención) | `#F68B1F` | `--logo-orange` |
| Amarillo (acento) | `#F7C63D` | `--logo-yellow` |
| Rojo (destructivo) | `#E4002B` | `--btn-red` |
| Neutros | `#FFFFFF` `#F3F5F7` `#A0A8B0` `#444B52` | `--card` `--gris-claro` `--gris-medio` `--gris-oscuro` |
| Texto | `#1F2937` / `#4B5563` | `--ink` / `--mut` |

## Botones (la regla que no se rompe)
1. **Principal = verde sólido** (`success` o `primary`). **Uno solo por paso, pantalla o diálogo**: la siguiente acción lógica.
2. **Secundario = `ghost`**: fondo blanco, borde y texto azul. Todo lo demás.
3. **Destructivo = `danger`** (rojo suave). `danger solid` solo para confirmar algo irreversible.
4. `violet`, `teal`, `slate` = azul oscuro sólido, solo para una acción de apoyo importante. `orange` y `warning` solo marcan estado o atención; no son acciones normales.
5. Si hay más de 3 botones a la vista, lo menos frecuente va en **«Más…»** (`<MasMenu>`).

## Pantallas
- **Ancho y espacio**: `--pagina-max`, `--pagina-pad`, `--pagina-gap`. Despacho es la excepción: usa todo el ancho para ver más comandas.
- **Cabecera**: siempre `<CabeceraPagina titulo datos acciones />`: título a la izquierda, acción principal a la derecha.
- **Avisos y vacíos**: siempre `<Aviso>` (icono + texto + botón si hace falta). No crear estilos nuevos.
- **Tamaños táctiles**: botones de 44 px de alto como mínimo (48 px en Despacho).
- **Textos**: todo en `es.json`, `en.json` y `pt.json`.
