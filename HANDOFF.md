# HANDOFF · POS Control · v0.2 (2026-10-16)

App Vite + React 19, modo demo con datos locales (localStorage). `npm install && npm run dev`.
Login demo (2 pasos empresa→usuario): `admin / 1234`, `cajero / 1234`, `mesero / 1234`.

## Estado de carriles
- **IA-1 (backend)**: `supabase/schema.sql` (1886 líneas, idempotente: pegar en SQL Editor) + `docs/CONTRATO.md` (RPCs y mapeo 1:1 store→RPC). Multi-tenant: `empresa_id` en 12 tablas, 42 políticas RLS con `private.empresa_activa()` (GUC `app.empresa_id` + membresía), 17 RPCs atómicas con validación de rol, advisory locks, vista `v_estado_mesas`, seed comentado.
- **IA-2 (operación)**: `salon/SalonPage.jsx` (mapa 1000×600, zonas, edición admin, badge de mesas unidas) · `pedido/PedidoPanel.jsx` (comensales, secciones, comanda, unir/separar mesas, mover ítems, propina %, descuento con PIN demo para cajero, pagos mixtos con cambio, impresión) · `caja/CajaPage.jsx` (turno con fondo, ingresos/egresos, arqueo con faltante/sobra, historial) · `venta/VentaDirecta.jsx` (menú táctil, carrito, turno número, 1–2 líneas de pago, ticket) · `ticket/Ticket.jsx` (`imprimirTicket` vía iframe oculto, 58/80 mm, comanda/pre-cuenta/ticket).
- **IA-3 (acceso/admin)**: `auth/LoginPage.jsx` (empresa→usuario/clave) · `auth/Topbar.jsx` · `admin/MenuAdmin.jsx` (secciones con orden ▲▼, productos CRUD/activo) · `admin/ConfigAdmin.jsx` (negocio, moneda, IVA, propina).
- **Capa compartida (hilo principal)**: `services/store.jsx` (reducer con todas las acciones; `mesaIds`, `canal`, caja, menú), `services/permisos.js` (matriz §3 de GUÍA), `App.jsx` (login + módulos), `config.js` (URL + publishable key reales; `USAR_SUPABASE` aún no cableado en datos).

## Verificado
- `npm run build` 0 errores (32 módulos).
- Flujo navegador: login → abrir mesa con comensales → ítems por sección → enviar a cocina → propina 10% → cobro mixto (efectivo+QR) → mesa liberada → caja con turno abierto y resumen → venta directa con cobro e impresión.
- Escaneo de secretos: limpio (solo publishable key).

## Pendiente / siguiente
## Pendiente / siguiente
1. ~~**Cablear Supabase**~~ → **HECHO en v0.3** (ver sección abajo). Queda: re-pegar `schema.sql` corregido en el SQL Editor del proyecto `oeyrnenclklmczlfoxzy` (2 bugs de PostgreSQL encontrados al cablear).
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
**YA APLICADA (coord, 2026-10-16 14:45)**: `supabase/schema.sql` re-pegado completo en el SQL Editor (hash verificado `837BCFDE…`, envuelto en `begin; … commit;`) ⇒ los 2 fixes (`min(uuid)::text` y `sum(text)`) ya están en la base. Verificado después del re-pegado: 43 políticas RLS, 3 RPCs `super_*`, datos intactos (5 mesas / 9 productos / 1 empresa).

Quedan en la base, generados por mis pruebas de wiring: **1 venta directa #1 cobrada y 1 turno de caja abierto**. Cerrar el turno desde Caja (contado 0) o borrarlos si se quiere el demo limpio.

---

# v0.3 · Super admin multiempresa + exportar/importar (2026-10-16)

## Base de datos: `supabase/migraciones/001_super.sql` — **APLICADA y verificada**
Idempotente; se ejecuta DESPUÉS de `schema.sql`. Aporta:
- `public.supers(user_id)` con semilla al uid del dueño + política de lectura propia.
- `public.es_super()`, y `private.es_super_compat()` en `schema.sql` (devuelve false si la tabla `supers` no existe, para que un schema sin la migración no reviente las políticas).
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
