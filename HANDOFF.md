# HANDOFF · POS Control v0.18.0

Estado actual en una pantalla. El historial detallado está en `CHANGELOG.md`.

## Qué es
Vite + React 19 + Supabase, PWA multiempresa en español (i18n es/en/pt, 982 claves, `node scripts/check-i18n.mjs`).
Backend: UN solo archivo, `supabase/setup.sql` (idempotente, atómico). **Se pega COMPLETO en el SQL Editor tras cada cambio.**
Docs: `docs/CONTRATO.md` (tablas y RPCs), `docs/GUIA.md`, `docs/NOMBRES.md`.

## Última entrega (v0.18.0: una vista por área y «ya salió» por área, bloque A de la petición; ver CHANGELOG. Siguen los bloques B y C)
Menú «⋯» de la mesa, subcuentas 2a/2b (`dividir_cuenta`) y opciones rápidas por producto: ver CHANGELOG. Requiere pegar `setup.sql` completo (sección 009). Sin probar en Supabase real ni en teléfono.

## Planes
- Básico: 20 artículos activos + 3 personas (admin incluido). Premium: sin límite. El comercio no ve números, solo un aviso genérico.
- Cambiar plan: panel Super → empresa → «Cuota» → «Pasar a Premium». Los valores por defecto se cambian SOLO en `private.plan_defaults()`.
- Super: cuenta en `public.supers` (se crea con `crear_super` desde el SQL Editor). Entra a cualquier empresa sin membresía (rol efectivo admin) y no cuenta para los topes.

## Verificado en esta entrega
- Bloque de planes (sección 2 de `setup.sql`) ejecutado contra el Supabase real dentro de una transacción revertida: compila, crea 3 triggers y 4 funciones, defaults 20/3 y Premium null/null. NO se aplicó en la base.
- `check-i18n` conforme. NO se pudo ejecutar `npm run build` ni el navegador en el entorno de trabajo (sin red para `npm install`): compilar y mirar el panel Super antes de desplegar.

## Verificado en v0.14.1
- `setup.sql` probado en un Postgres 16 local con `auth`/`storage` simulados: base nueva, pegarlo 2 veces y actualizar una base que ya tenía el SQL viejo → 0 errores; funciones, permisos (ACL), políticas, triggers, columnas e índices idénticos al archivo anterior (solo cambian las funciones que usaban `es_super_compat`). `npm run build` y `check-i18n` verdes.
- NO se aplicó a la base real: pegar el archivo completo en el SQL Editor.

## Pendiente
1. Pegar `setup.sql` completo en Supabase y correr `npm run test:cuotas` (y `test:aislamiento`) con negocios de PRUEBA.
2. Decisión de marca azul vs verde y token `--tap` para la ley de formas (ver CHANGELOG v0.13.1).
3. Retención (008) sin probar en base real; `tests/aislamiento.mjs` no cubre insumos/recetas.
