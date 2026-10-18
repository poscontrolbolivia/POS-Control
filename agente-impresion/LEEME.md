# Agente de impresión (PC del local)

Sirve para que la app imprima **sin el cuadro de confirmación del navegador** y para **asignar una impresora de Windows distinta a cada grupo** (Cocina, Barra, Caja). El navegador no puede hacer ninguna de las dos cosas por sí solo.

## Instalar (una vez, en la PC que tiene las impresoras)
1. Instala Node.js 18 o superior (https://nodejs.org).
2. Copia esta carpeta (`agente-impresion`) a la PC.
3. Abre `iniciar-agente.bat` con el Bloc de notas y cambia `ORIGEN` por la dirección de tu app (la misma que abres en Chrome). Guárdalo.
4. Haz doble clic en `iniciar-agente.bat`. Deja la ventana abierta mientras vendes (puedes ponerlo en Inicio de Windows para que arranque solo).

## Asignar impresoras
En la app: **Configuración → Impresoras** (o **Estación**) → en cada grupo elige *Impresora de Windows por nombre (sin diálogo)*, elige la impresora de la lista y pulsa **Probar**. Cada PC guarda su propia asignación.

## Teléfonos
Los teléfonos no necesitan nada instalado. En **Configuración → Impresoras → ¿Dónde se imprime?** elige *En la estación de impresión*, deja una PC con la app abierta en **Estación → Iniciar estación**, y todo lo que se envíe desde un teléfono sale por las impresoras de esa PC.

## Notas
- Envía bytes ESC/POS (RAW): es para **impresoras térmicas** de 58/80 mm instaladas en Windows con su driver (o «Generic / Text Only»). Para láser/PDF usa la salida *Diálogo de Windows*.
- Solo escucha en `127.0.0.1` (esta PC) y, con `--origen`, solo acepta tu app.
- Chrome puede preguntar una vez si permites a la app conectarse a dispositivos de tu red local; acepta.
- Prueba sin impresora: `POS_AGENTE_SIMULAR=1 node agente.mjs` (guarda los trabajos en `simulado/`).
