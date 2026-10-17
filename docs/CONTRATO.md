> **Nota v0.13:** TODO el backend vive en UN solo archivo idempotente: `supabase/setup.sql`. El antiguo archivo suelto del super y la carpeta de migraciones numeradas (001–007) **ya no existen**: todo está fusionado dentro de `setup.sql` (se pega COMPLETO en el SQL Editor y admite re-pegadas sin romper nada). Las menciones a `schema.sql`, `00x_*.sql` o «migración 00x» en este documento son históricas (antes/ex-archivos sueltos) y hoy corresponden a **secciones internas** de `setup.sql`.

# CONTRATO · Supabase backend ↔ cliente POS

**Estado:** v1.3 (v0.13 de la app) · Archivo de referencia: `supabase/setup.sql` (único SQL del proyecto; idempotente, envuelto en `begin;` … `commit;`; ver §8).
**Destinatarios:** IA-2 (Salón/operación), IA-3 (login/layout/gestión), y cualquier contribuidor futuro.
Este documento define el modelo de datos, las RPCs con firma exacta, las convenciones y el mapeo 1:1 desde las acciones locales de `src/services/store.jsx` (hoy localStorage) hacia Supabase.

---

## 0. Reglas de oro (no negociables)

1. **Nunca mutar tablas de negocio directamente.** `cuentas`, `cuenta_mesas`, `cuenta_items`, `pagos`, `turnos_caja` son **solo SELECT** para el cliente; toda escritura va por RPC (transaccionales y con validación de rol en la base). El cliente NO tiene permisos de INSERT/UPDATE/DELETE sobre ellas aunque las pida: fallará con `permission denied`.
2. **`empresa_id` nunca se envía en el payload de datos**: la empresa activa la fija la base (`private.fijar_empresa`) al inicio de cada RPC a partir de `p_empresa_id` + membresía real del `auth.uid()`. Un uuid de empresa ajeno ⇒ error, y el RLS devuelve 0 filas.
3. **IDs `uuid` generados en la base** (`gen_random_uuid()`). El cliente no inventa ids; usa los que devuelven las RPCs.
4. **Dinero = `numeric(10,2)`; la moneda es de cada empresa (`empresas.moneda`, por defecto Bs, se cambia en Configuración).** Nunca float en la capa de datos. Redondeos/validaciones de importes: en la base.
5. **Snapshot en items:** al agregar un producto se congelan `nombre_snapshot` y `precio_snapshot` en `cuenta_items`. El ticket/cobro SIEMPRE usa el snapshot, nunca `productos` actual.
6. **Coordenadas del mapa de mesas: lienzo normalizado 1000 × 600** (x,w ∈ [0,1000]; y,h ∈ [0,600]), idéntico al canvas actual de `SalonPage.jsx` y `store.jsx`. La base lo valida con CHECKs.
7. **Tablas de plataforma ocultas** (`limites`, `throttle`, `auditoria`, migración 002): `force row level security` SIN políticas + `revoke all` desde `public/anon/authenticated` — el tenant no las ve ni por REST (403); solo se escriben desde funciones `security definer` y se leen por RPC privativas del super. Las cuotas (artículos y personas) son invisibles para el cliente: la UI nunca muestra números, solo recibe el aviso genérico de la base al llegar al tope.
8. **Hardening obligatorio en toda función pública nueva**: `revoke all on function … from public, anon;` + `grant execute … to authenticated;` (a `anon` solo si es pre-login, como `empresa_por_codigo`) y `set search_path = ''`.

---

## 1. Modelo de datos (resumen de `supabase/setup.sql`)

### Tablas maestro / catálogo (SELECT para todos; escritura directa solo rol admin vía RLS)

| Tabla | Columnas clave | Notas |
|---|---|---|
| `empresas` | `id`, `nombre`, `moneda='Bs'`, `iva_pct`, `propina_pct`, `config jsonb` | El tenant. Config de negocio (← `s.config` del store). |
| `perfiles` | `user_id` (PK = auth.users), `display_name` | Creada por trigger al sign up. Nombres para tickets. |
| `membresias` | `empresa_id`, `user_id`, `rol ∈ {admin,cajero,mesero,cocina,barra}`, `pin_descuento_hash` | Usuario↔empresa. Desde v0.13 los roles `cocina` y `barra` operan solo su pantalla de cola (§3.22); nunca tocan dinero ni catálogo. Alta de miembros: pantalla Equipo (admin) o super (ver §7). `unique(empresa_id,user_id)`. |
| `zonas` | `id`, `empresa_id`, `nombre`, `orden` | |
| `mesas` | `id`, `empresa_id`, `zona_id`, `nombre`, `x,y,w,h`, `forma ∈ {cuadrada,redonda,rect}`, `capacidad`, `activa` | x/y/w/h en escala 1000×600. `activa=false` en vez de borrar. |
| `secciones_menu` | `id`, `empresa_id`, `nombre`, `orden` | ← `s.secciones` |
| `productos` | `id`, `empresa_id`, `seccion_id`, `nombre`, `precio numeric(10,2)`, `activo`, `imagen_path text NULL`, `areas text[]` | ← `s.productos`. Borrar = `activo=false` (histórico intacto). `imagen_path` (sección 002): ruta de Storage con CHECK de forma `productos/{uuid-empresa}/{uuid}.{webp|jpg}`; el miniato se muestra a 45×45 px y se guarda a 90 px (2× retina) en el bucket público `pos-imagenes`. `areas` (v0.13): áreas de impresión del artículo, `text[] not null default array['cocina']` con CHECK `areas <@ array['cocina','barra']` y mínimo 1 valor ⇒ un combo puede ir a cocina Y barra a la vez; su snapshot viaja a `cuenta_items.areas`. |

### Tablas de plataforma (sección 002 de `supabase/setup.sql`) — OCULTAS para el tenant

| Tabla | Columnas clave | Notas |
|---|---|---|
| `auditoria` | `id bigint`, `empresa_id`, `actor`, `accion`, `detalle jsonb`, `en`, `actor_nombre`, `actor_rol`, `entity_type`, `entity_label` | Force RLS sin políticas + `revoke all`. Escrita solo por `private.auditar()` (security definer). Lectura: antes solo por `super_listar_auditoria()`; desde v0.13 el admin del negocio también lee la SUYA por RPC (`auditoria_listar`, §3.22) — la tabla sigue sin acceso REST directo. Las columnas legibles (v0.13, todas NULL-ables) se rellenan desde `perfiles`/`membresias`: quién, con qué rol y sobre qué entidad (p. ej. `cuenta_item`/nombre del plato, `insumo`/nombre). |
| `limites` | `empresa_id` (PK), `max_productos int` (NULL = ilimitado), `max_miembros int` (NULL = ilimitado), `plan 'gratis'\|'pago'` (Básico 20/3 · Premium sin límite, ver `private.plan_defaults`), `notas`, `actualizado_en`, `actualizado_por` | Force RLS deny-all ⇒ por REST devuelve **403**; el comercio no puede leer ni cambiar su cuota. Escrita solo por RPCs del super y por el trigger `trg_nueva_cuota`. Ver §3.19. |
| `throttle` | `clave text` (PK: prefijo+IP), `intentos`, `hasta` | Force RLS sin políticas + `revoke all`. Solo lo toca `private.throttle_ok()` desde `empresa_por_codigo`. Ver §3.18. |

`public.membresias` lleva `trg_cuota_miembros` (BEFORE INSERT, errcode 22000) y `public.productos` lleva `trg_controlar_cuota` (sección 002) que exigen la cuota de `limites` en el INSERT/UPDATE ⇒ la cuota se cumple en el servidor aunque se edite la app (detalles en §3.19).

### Tablas de inventario (v0.13) — SOLO rol admin

Las tres tablas nacen en la sección 009 de `supabase/setup.sql`. RLS con el mismo patrón que `trabajos_impresion`: el cliente tiene **solo SELECT** (y encima filtrado `private.es_admin()`); toda escritura real la hacen las RPCs `security definer` (§3.23). Con `force row level security` ⇒ un anon/authenticated no-admin no ve filas ni puede insertar por REST.

| Tabla | Columnas clave | Notas |
|---|---|---|
| `insumos` | `id`, `empresa_id`, `nombre`, `unidad` (default `'unidad'`), `stock numeric(12,3)`, `stock_min numeric(12,3)`, `costo numeric(12,2)`, `activo`, `creada_en`, `actualizado_en` | Índice único `unique(empresa_id, lower(nombre))` ⇒ `insumo_guardar` puede upsertear por nombre. El stock **puede quedar negativo** (no hay CHECK): las salidas por venta nunca bloquean el cobro. |
| `recetas` | `id`, `empresa_id`, `producto_id → productos`, `insumo_id → insumos`, `cantidad numeric(12,3) > 0`, `creada_en` | `unique(producto_id, insumo_id)`. FKs `on delete cascade` (borrar un plato o un insumo limpia sus recetas). Es la receta de cuánto consume cada plato; no guarda proporciones de costo. |
| `insumos_movimientos` | `id`, `empresa_id`, `insumo_id → insumos`, `tipo ∈ {entrada,salida,venta,ajuste}`, `cantidad numeric(12,3)`, `stock_after`, `nota`, `usuario`, `usuario_nombre`, `en` | Historial de stock. `venta` lo escribe `cobrar_cuenta` automáticamente (§3.13); `entrada/salida/ajuste` salen de `insumo_movimiento`. `usuario_nombre` es snapshot de `perfiles.display_name`. |

### Tablas de negocio (SELECT directo; MUTACIÓN solo por RPC)

| Tabla | Columnas clave | Notas |
|---|---|---|
| `cuentas` | `id`, `empresa_id`, `tipo ∈ {mesa,directa}`, `numero` (directa), `estado ∈ {abierta,precuenta,cerrada}`, `comensales`, `propina`, `descuento`, `nota`, `abierta_por/abierta_en`, `cerrada_por/cerrada_en` | ← `s.cuentas`. Los `items`/`pagos` viven en tablas propias. |
| `cuenta_mesas` | PK `(cuenta_id, mesa_id)`, `empresa_id` | n:m: una cuenta puede abarcar varias mesas (unión). |
| `cuenta_items` | `id`, `empresa_id`, `cuenta_id`, `producto_id`, `nombre_snapshot`, `precio_snapshot`, `qty ≥ 1`, `estado ∈ {pendiente,enviado,listo,anulacion,anulado}`, `nota`, `motivo_anulacion`, `enviado_en`, `creada_en`, `areas text[]` (snapshot del producto), `listo_en`, `anulacion_motivo`, `anulacion_por`, `anulacion_pedida_en`, `anulacion_estado_previo`, `anulacion_resuelta_por`, `anulacion_resuelta_en` | Anular CONSERVA la fila (auditoría). qty≤0 en `cambiar_qty_item` elimina la fila (igual que el reducer). Estados (v0.13): `enviado→listo` por salida de cocina/barra; `anulacion` = anulación PEDIDA aún no aprobada (guarda el estado previo para poder rechazar); `anulado` = excluido de totales. |
| `pagos` | `id`, `empresa_id`, `cuenta_id`, `metodo ∈ {efectivo,qr,tarjeta,mixed}`, `monto`, `detalle jsonb`, `creada_por/creada_en` | `detalle` p.ej. `{"recibido":100,"cambio":23}` (efectivo), `{"referencia":"..."}` (QR). El `monto` es lo que se imputa a la cuenta (el cambio NO se suma). |
| `turnos_caja` | `id`, `empresa_id`, `abierto_por/abierto_en`, `fondo`, `cerrado_en/cerrado_por`, `contado`, `esperado`, `movimientos jsonb` | `movimientos = {"movimientos":[{id,tipo,monto,motivo,creada_en,usuario}], "cierre":{...}}`. Un turno abierto por empresa. |

### Vista de estado (para el salón y realtime)

`public.v_estado_mesas` (`security_invoker=true`, respeta RLS): una fila por mesa →

```
empresa_id, mesa_id, mesa, zona_id, x, y, w, h, forma, capacidad, activa,
cuenta_id, cuenta_estado, comensales, propina, descuento,
subtotal,   -- suma de items vivos
total,      -- max(0, subtotal − descuento) + propina  (= totalFinal del store)
items_enviados, items_pendientes
```

Colores del mapa de `SalonPage`: libre ⇒ `cuenta_id is null`; por cobrar ⇒ `cuenta_estado='precuenta'`; enviada ⇒ `items_enviados > 0`; ocupada ⇒ resto.

---

## 2. Política de empresa en el cliente (setup tras el login)

Flujo obligatorio (la capa `supa` reemplaza a `store.jsx` manteniendo las mismas acciones):

```js
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// 1) LOGIN → elegir empresa
const { data: { user } } = await supabase.auth.getUser()
//   empresas del usuario (la política SELECT solo muestra en las que soy miembro):
const { data: empresas } = await supabase
  .from('empresas')
  .select('id, nombre')            // via join implícita de RLS; o:
  // .from('membresias').select('rol, empresa:empresas(id, nombre)').eq('user_id', user.id)

localStorage.setItem('empresa_activa_id', chosen.id)   // + rol elegido: 'membresias.rol'

// 2) EN CADA RPC: pasar p_empresa_id
const { data: cuentaId, error } = await supabase.rpc('abrir_cuenta', {
  p_empresa_id: localStorage.getItem('empresa_activa_id'),
  p_mesa_id: mesaId, p_comensales: 2,
})
if (error) throw error            // los raise exception de la base llegan en error.message
```

- **No existe un "login de empresa" separado**: cada RPC llama `private.fijar_empresa(p_empresa_id)` (valida membresía contra `auth.uid()` y fija `app.empresa_id` transaccional). Si omites `p_empresa_id` en RPCs donde es default-null y el usuario tiene **exactamente una** empresa, se resuelve solo (fallback); con dos o más ⇒ error. **Pasar siempre `p_empresa_id` es la norma.**
- SELECTs directos (vistas, tablas) de usuarios de una sola empresa funcionan sin setting (fallback de `private.empresa_activa()`); usuarios multiempresa deben leer por RPC/vistas parametrizadas en el futuro o cerrar sesión de la otra empresa.
- Hardening opcional futuro: Auth Hook "custom access token" para meter `app_empresa_id` como claim del JWT.
- Cambiar de empresa = volver al picker + re-crear el estado cliente (no hay estado de sesión en la base por empresa).

---

## 3. RPCs — firma exacta, entradas y salidas

Convención jsonb: arrays siempre `jsonb`; claves en snake_case; montos como números.
Roles mínimos por RPC (validados en la base; el `permisos.js` del cliente es solo UX):

| RPC | Roles | 
|---|---|
| abrir/venta/items/qty/nota/enviar/anular(pendiente)/unir/separar/mover/extras/pre-cuenta/reabrir | admin, cajero, mesero |
| anular ítem **enviado/listo** (corte directo `anular_item`) | admin, cajero (+motivo obligatorio; regla añadida en v0.13: antes era solo admin) |
| aplicar_extras / cobrar **con descuento** (rol ≠ admin) | + PIN correcto |
| cobrar_cuenta, abrir_turno, registrar_movimiento_caja, cerrar_turno | admin, cajero |
| actualizar_comensales (sección 003) | admin, cajero, mesero |
| `cola_de_area`, `pedir_anulacion` (v0.13) | admin, cajero, mesero, cocina, barra |
| `marcar_salida`, `deshacer_salida` (v0.13) | admin, cajero, cocina, barra |
| `resolver_anulacion` (v0.13) | admin, cajero |
| `auditoria_listar`, `inventario_listar`, `insumo_guardar`, `insumo_borrar`, `insumo_movimiento`, `receta_reemplazar`, `movimientos_listar` (v0.13) | solo admin |
| super_* (cuota, auditoría, export/import) · fijar_empresa a empresa ajena | solo super (vía `public.supers`) |

### 3.1 `abrir_cuenta(p_empresa_id uuid, p_mesa_id uuid, p_comensales integer = 1) → uuid`
Crea cuenta tipo `mesa` en `abierta` y su `cuenta_mesas`. Error si la mesa ya tiene cuenta activa o no existe/está inactiva. Devuelve el `cuenta_id`.

### 3.2 `abrir_venta_directa(p_empresa_id uuid) → uuid`
Cuenta tipo `directa`, `numero = max(numero del día en la empresa) + 1` (serializado con advisory lock empresa/día; día = timezone del DB, configurar America/La_Paz). Devuelve `cuenta_id`.

### 3.3 `agregar_items(p_cuenta_id uuid, p_items jsonb, p_empresa_id uuid = null) → jsonb`
`p_items = [{ producto_id: uuid, qty?: int (>0, default 1), nota?: string }]`.
Merge: si existe ítem `pendiente` del mismo producto **sin nota**, suma `qty`; si no, inserta nuevo con snapshot nombre/precio. Cuenta debe estar `abierta`. Devuelve **todos** los items de la cuenta:
`[{ id, producto_id, nombre, precio, qty, estado, nota, motivo_anulacion, enviado_en, creada_en }]`.

### 3.4 `cambiar_qty_item(p_item_id uuid, p_delta integer, p_empresa_id uuid = null) → jsonb`
`p_delta` (típicamente ±1). Solo ítems `pendiente` (enviado ⇒ error: anular y re-agregar). Si `qty + delta <= 0` **elimina** la fila. Devuelve `{ id, eliminado: bool, item?: {...} }`.

### 3.5 `poner_nota(p_item_id uuid, p_nota text, p_empresa_id uuid = null) → void`
Solo pendiente. `p_nota` NULL ⇒ `''`.

### 3.6 `enviar_items(p_cuenta_id uuid, p_item_ids jsonb = null, p_empresa_id uuid = null) → integer`
`NULL` ⇒ todos los `pendiente`; si no, array de uuids. Pasa a `enviado` + `enviado_en=now()`. Devuelve nº de items enviados. Cuenta `abierta`.

### 3.7 `anular_item(p_item_id uuid, p_motivo text, p_empresa_id uuid = null) → void`
Pendiente: cualquier miembro (admin/cajero/mesero). **Enviado/listo/anulacion: solo admin o cajero y `p_motivo` no vacío** (guardado en `motivo_anulacion`; desde v0.13 el cajero se sumó al corte directo). El ítem NO se borra, queda `anulado` (excluido de totales). Para que cocina/barra puedan solicitar sin ejecutar existe el flujo de aprobación §3.22.

### 3.8 `unir_mesas(p_cuenta_id uuid, p_mesa_ids jsonb, p_empresa_id uuid = null) → jsonb`
Suma mesas a la cuenta (las ya unidas se ignoran). Si una mesa tenía cuenta activa propia, **se absorbe**: sus items pasan a la cuenta destino y su cuenta se cierra (`estado=cerrada`, `nota='unida a otra cuenta'`, igual que el reducer). Devuelve `{ cuenta_id, absorbidas: [uuid...] }`.

### 3.9 `separar_mesa(p_cuenta_id uuid, p_mesa_id uuid, p_empresa_id uuid = null) → uuid`
Saca la mesa de la cuenta (deben quedar ≥1; la cuenta debe tener ≥2 mesas) y crea **cuenta nueva vacía** para ella. Los items se reparten manualmente con `mover_items`. Devuelve el `cuenta_id` nuevo.

### 3.10 `mover_items(p_cuenta_id uuid, p_item_ids jsonb, p_mesa_destino uuid = null, p_cuenta_destino_id uuid = null, p_empresa_id uuid = null) → uuid`
Al menos un destino. Con `p_mesa_destino`: usa la cuenta activa de esa mesa o **crea una** (comportamiento del demo). Mueve solo items no anulados. Devuelve el `cuenta_id` destino.

### 3.11 `aplicar_extras(p_cuenta_id uuid, p_propina numeric = null, p_descuento numeric = null, p_pin text = null, p_empresa_id uuid = null) → jsonb`
Cuenta `abierta` o `precuenta`. NULL = no toca ese campo. Descuento > 0 con rol ≠ admin exige `p_pin` (bcrypt vs `membresias.pin_descuento_hash`; sin hash o PIN malo ⇒ error). Devuelve `{ cuenta_id, subtotal, descuento, propina, total }` (total = `max(0, subtotal − descuento) + propina`).

### 3.12 `pre_cuenta(p_cuenta_id uuid, p_empresa_id uuid = null) → void` / `reabrir_cuenta(...) → void`
`abierta ↔ precuenta`. (Acciones `'precuenta'` / `'reabrir'` del store.)

### 3.13 `cobrar_cuenta(p_cuenta_id uuid, p_pagos jsonb, p_propina numeric = null, p_descuento numeric = null, p_pin text = null, p_empresa_id uuid = null) → jsonb`
Roles caja (admin/cajero). Atómico: aplica extras opcionales (misma regla de PIN), valida `Σ pagos ≥ total`, inserta `pagos`, cierra cuenta (`cerrada_por/cerrada_en`), **libera mesas** (`delete cuenta_mesas`), acumula el efectivo del turno (`movimientos.venta_efectivo`, `cuentas_cerradas++`) si hay turno abierto.
**Inventario (v0.13):** al cerrar, descuenta el stock por receta (`Σ qty × recetas.cantidad` por insumo de los ítems no anulados) y deja la baja como movimiento `tipo='venta'` en `insumos_movimientos`. Es **best-effort dentro de la misma RPC**: un fallo de inventario se atraga (`exception when others → null`) y NUNCA impide el cobro; el stock puede quedar negativo y se corrige a mano desde la pantalla Inventario.
`p_pagos = [{ metodo: 'efectivo'|'qr'|'tarjeta'|'mixed', monto: number, detalle?: object }]` (efectivo: `detalle={recibido, cambio}`, `monto` = imputado a la cuenta).
Devuelve **ticket listo para imprimir** (IA-3 usa esto para plantillas):
```json
{ "cuenta_id", "tipo", "numero", "mesas": ["Mesa 1","Mesa 2"],
  "items": [ ...igual 3.3... ], "pagos": [ {"metodo","monto","detalle"} ],
  "subtotal", "descuento", "propina", "total", "pagado", "cambio",
  "cerrada_en", "moneda": "Bs" }
```

### 3.14 `abrir_turno(p_empresa_id uuid, p_fondo numeric = 0) → uuid`
Roles caja. Un turno abierto por empresa (error si ya hay uno). Devuelve `turno_id`.

### 3.15 `registrar_movimiento_caja(p_tipo text, p_monto numeric, p_motivo text = null, p_turno_id uuid = null, p_empresa_id uuid = null) → jsonb`
`p_tipo ∈ {'ingreso','egreso'}`, `p_monto > 0`, turno abierto requerido. Devuelve `{ turno_id, movimiento: {id, tipo, monto, motivo, creada_en, usuario} }`.

### 3.16 `cerrar_turno(p_contado numeric, p_turno_id uuid = null, p_empresa_id uuid = null) → jsonb`
Calcula esperado = `fondo + pagos efectivo (cuentas cerradas en la ventana del turno) + Σ ingresos − Σ egresos`; escribe `esperado/contado/cerrado_en/cerrado_por` y snapshot en `movimientos.cierre`. Devuelve `{ turno_id, fondo, venta_efectivo, ingresos, egresos, esperado, contado, diferencia }`.

### 3.17 `actualizar_comensales(p_cuenta_id uuid, p_comensales integer, p_empresa_id uuid = null) → integer` (sección 003)
Corregir el número de comensales **después** de abrir la cuenta (mesa o grupo). `security definer`, exige rol admin/cajero/mesero y valida contra la empresa activa. Rechaza fuera de 1..99 con «El número de comensales debe estar entre 1 y 99» (mismo rango que el CHECK de `cuentas.comensales`; se antepone para devolver mensaje en español y no un 23514). NO deja tocar una cuenta ya `cerrada` ni de otra empresa («No se pudo cambiar los comensales: la cuenta no está abierta en esta empresa»). Audita `comensales` en `public.auditoria` si 002 está aplicada. Devuelve el número fijado. Cliente: acción `comensales~` (`store.jsx` → `tiendaSupabase.js`, usado por `SalonPage.jsx`).

### 3.18 `empresa_por_codigo(p_codigo text) → table(id uuid, nombre text, moneda text)` (definida una sola vez, con throttle)
Endpoint **pre-login** (ejecutable por `anon`): paso 1 del login. Con la migración 002 lleva throttle anti-fuerza-bruta: **30 consultas por IP en 10 minutos** (`private.throttle_ok('cod', 30)`); al agotar devuelve **0 filas** — indistinguible de un código inexistente, en vez de lanzar excepción (la excepción abortaría la transacción y el contador nunca se guardaría, además de delatar la existencia de empresas). Código con menos de 3 caracteres ⇒ también 0 filas sin ruido. El cliente muestra "código no encontrado" en ambos casos.

### 3.19 RPCs de plataforma (super) — secciones 001 + 002 de `supabase/setup.sql`
Todas empiezan con `if not public.es_super() then raise exception 'requiere super'` y siguen la regla 8 (§0). El comercio normal recibe 403/`requiere super`:

| RPC | Qué hace |
|---|---|
| `super_listar_empresas() → jsonb` (001) | Todas las empresas con contadores. |
| `super_ajustar_empresa(p_empresa uuid, p_max_productos integer, p_plan text, p_notas text, p_max_miembros integer) → jsonb` (v0.14) | Ajuste fino de cuotas; plan `'pago'` ⇒ ambos NULL; Básico sin valor ⇒ defaults. Audita `super_ajustar_cuota`. |
| `super_cambiar_plan(p_empresa uuid, p_plan text) → jsonb` (v0.14) | Un clic Básico ⇄ Premium con los defaults del plan; solo super; audita `super_cambio_plan`. |
| `mi_plan(p_empresa_id uuid) → jsonb` | `{plan, retencion_meses}` para cualquier miembro (desde v0.14 sin `max_productos`). |
| `super_ver_cuota(p_empresa uuid) → jsonb` (002) | Lee `{max_productos, plan, notas, productos_actuales}` solo para el panel del super. |
| `super_listar_auditoria(p_empresa uuid = null, p_limite integer = 200) → table(en, actor, accion, detalle, empresa_id)` (002) | Única lectura posible de `auditoria` (tope duro 1000). |
| `super_registrar_exporte(p_empresa uuid) → void` (002) | El panel la llama tras descargar el .json: deja prueba de qué empresa salió de la plataforma y cuándo. |
| `super_exportar_empresa(p_empresa uuid) → jsonb` (001, **redefinida en 002**) | Snapshot con `version: 2`; el bloque `equipo` incluye ahora `user_id` (necesario para reasignar dueños del histórico). Exporta también `cuentas`, `cuenta_mesas`, `cuenta_items`, `pagos` y `turnos`. |
| `super_importar_empresa(p_datos jsonb, p_codigo text, p_clave_inicial text = 'pos12345') → uuid` (001, **redefinida en 002**) | Además del catálogo, **restaura el HISTÓRICO** completo reasignando `abierta_por/cerrada_por/creada_por/abierto_por/cerrado_por` vía el mapa `user_id` de origen → usuario recreatedo (bcrypt coste 10 explícito; usuarios nuevos confirmados con clave temporal). El super está exento del trigger de cuota ⇒ un snapshot de 500 artículos se instala entero. Audita `super_importo`. |
| `fijar_empresa(p_empresa uuid) → void` (001/002) | GUC de **sesión** (`set_config(..., false)`); requiere membresía o ser super; el super además audita `super_entro`. Requiere header `X-Session-Id` en el cliente (conexión pinzada, §2). Con 002 un super puede fijar CUALQUIER empresa y operar (`private.mi_rol()` le da rol `admin` efectivo). |

Reglas de negocio de la cuota (trigger `private.controlar_cuota_productos` sobre `productos`): empresa nueva nace con 30 (trigger `trg_nueva_cuota` en `empresas`); dar de baja (`activo=false`) nunca se bloquea; editar precio/nombre/foto no consume; **reactivar un artículo inactivo sí consume**; `max_productos NULL` = ilimitado; los super están exentos.

### 3.20 Altas y equipo — sección 004 de `supabase/setup.sql`
Ninguna de estas funciones acepta `p_empresa_id`: usan `private.empresa_activa()`, así que el cliente las llama con `rpc(nombre, params, { conEmpresa: false })` (si se les manda `p_empresa_id`, PostgREST no encuentra la firma y devuelve 404 PGRST202).

| Objeto | Firma y comportamiento |
|---|---|
| trigger `trg_alta_empresa_registrado` → `private.registrar_empresa_del_registrado()` | AFTER INSERT en `auth.users`. Solo actúa si `raw_user_meta_data->>'alta_empresa' = 'true'` (el resto de los registros, incluido `equipo_invitar`, pasa de largo). Valida código (`^[a-z0-9][a-z0-9._-]*$`, 3..24 ⇒ 23514 `alta_codigo_invalido`) y nombre (1..80). Código repetido ⇒ 23505 `alta_codigo_tomado` y el `signUp` completo se revierte. Crea `empresas(nombre, codigo)` + `membresias(rol='admin')` + zona `Salón` con 8 mesas `1..8` (capacidad 4, rejilla 4×2 en el lienzo 1000×600) y audita `alta_empresa`. `limites` lo siembra `trg_nueva_cuota` (002) y `perfiles` lo crea `handle_new_user`; la metadata `display_name` es la que lee ese trigger, por eso el login manda también `display_name`. |
| `equipo_listar() → table(usuario_id uuid, nombre text, correo text, rol text, creado_en timestamptz)` | admin de la empresa activa. `auth.users.email` es `varchar`: se funde a `text` con `::text` en el `RETURN QUERY` o plpgsql aborta con 42804. |
| `equipo_invitar(p_nombre, p_correo, p_rol, p_clave) → uuid` | admin. Alta directa en `auth.users` (espejo de `super_importar_empresa`: bcrypt 10, `email_confirmed_at = now()`, columnas de token en `''` nunca NULL, `auth.identities`, `perfiles`, `membresias`). Rechaza rol fuera de `admin|cajero|mesero`, clave < 4 y correo repetido (23505 `equipo_correo_tomado`). Audita `equipo_invito`. |
| `equipo_restablecer(p_usuario_id uuid, p_clave text) → boolean` | admin. Solo sobre miembros de la empresa activa (no se fía del uuid). Audita `equipo_restablecio_clave`. |
| `equipo_revocar(p_usuario_id uuid) → boolean` | admin. No a sí mismo, no a un super, no al último admin de la empresa. Quita la membresía y, si la persona queda sin empresa, borra su `auth.users`; si tiene histórico de negocio (FK `ON DELETE NO ACTION`) captura `foreign_key_violation` y deja la cuenta viva sin accesos. Audita `equipo_revoco`. |
| `super_resetear_clave(p_usuario_id uuid, p_clave text) → boolean` | `public.es_super()`; cross-tenant, sin acotar a la empresa activa. Existe como atajo por API: hoy no tiene pantalla (el super puede entrar en la empresa y usar el Equipo de `ConfigAdmin`). |

**Claves olvidadas (decisión del dueño):** no hay reset por correo. Un administrador que no puede entrar escribe al WhatsApp de `SOPORTE_WHATSAPP` (`src/config.js`) y el super le fija clave — o bien entra en esa empresa desde el panel Super (002 le da rol `admin` efectivo) y usa **Configuración → Equipo → Nueva clave**. Un cajero/mesero recibe clave nueva de un administrador de su negocio desde esa misma pantalla.

### 3.21 Quién es super — `crear_super` / `quitar_super` (sección «super fusionado» de `supabase/setup.sql`)
El super **no se crea desde la app**: el alta self-service (§3.20) solo sabe dar de alta empresas y su admin. La marca de super es una fila en `public.supers`, y se mintea desde el SQL Editor. Hoy estas funciones viven DENTRO de `setup.sql` (el archivo suelto del super ya no existe); al final del archivo hay un bloque «★ PASO OPCIONAL ★» listo para promocionarse:

```sql
select public.crear_super('tu@correo.com', 'ClaveMin8Caracteres', 'Tu nombre', true)
where false;   -- ← quita el `where false` y pega el archivo completo para que se ejecute
```

- `crear_super(p_correo, p_clave, p_nombre default 'Super', p_reemplazar_clave default false) → uuid`. Crea la cuenta en GoTrue (espejo de `equipo_invitar`: bcrypt 10, `email_confirmed_at = now()`, columnas de token en `''`, `auth.identities`) y mete la fila en `supers`. **Re-pegable**: si el correo ya existe, promove sin tocar la clave; solo cambia la clave si se pasa `p_reemplazar_clave := true`. Rechaza correo sin dominio y clave de menos de 8. Audita `super_alta` con `empresa_id NULL` (es evento de plataforma, no de negocio).
- `quitar_super(p_correo) → boolean`: borra solo la fila de `supers`; la cuenta y sus datos siguen intactos y puede seguir entrando como usuario normal.
- Ambas están **revocadas a `anon` y `authenticated`** (medido: llamar `POST /rest/v1/rpc/crear_super` con la publishable key ⇒ 42501 `permission denied`; `has_function_privilege` da `false` para esos dos roles y `true` para `service_role`). Nadie con cuenta de negocio puede crearse super.
- La clave queda escrita en el historial de consultas del SQL Editor: si molesta, borrar esa consulta después, o fijar la clave luego con `super_resetear_clave` (§3.20).

### 3.22 Cocina/barra · salida y anulación con aprobación — v0.13 (sección 009 de `supabase/setup.sql`)
Todas `security definer`, `set search_path = ''`, revocadas a `public/anon` y otorgadas a `authenticated`; el gate de rol lo ejecuta `private.exigir_rol(...)` en la base (el mapa `permisos.js` del cliente es solo UX). A diferencia de las RPCs de equipo (§3.20), estas SÍ aceptan `p_empresa_id`, así que el cliente las llama con la convención normal de `rpc()` (se inyecta `p_empresa_id` automáticamente, CONTRATO §2).

| RPC | Firma exacta (setup.sql) | Roles | Qué hace |
|---|---|---|---|
| `cola_de_area` | `public.cola_de_area(p_area text default 'cocina', p_empresa_id uuid default null) → jsonb` | admin, cajero, mesero, cocina, barra | La cola digital del área. Rechaza `p_area ∉ {cocina,barra}` con «El área debe ser cocina o barra». Devuelve un array de objetos-cuenta (cuentas NO cerradas con ítems vivos del área: estados `enviado/listo/anulacion` con `i.areas @> array[p_area]`, ordenados por `enviada_en`): `{ cuenta_id, mesa (nombres unidos o 'Mostrador'), canal: 'mesa'|'mostrador', comensales, abierta_en, enviada_en, items: [{ id, nombre, qty, nota, estado, areas, enviada_en, listo_en, anulacion_motivo }] }`. Un combo con 2 áreas aparece en las dos colas. |
| `marcar_salida` | `public.marcar_salida(p_item_ids jsonb, p_empresa_id uuid default null) → integer` | admin, cajero, cocina, barra | Pasa los ítems `enviado` → `listo` (+`listo_en=now()`); ignora los que no estén en `enviado`. `p_item_ids` = array jsonb de uuid (no-array ⇒ «Debe enviar una lista de ítems»). Devuelve nº de ítems marcados y audita `item_salida` con las etiquetas de los nombres. |
| `deshacer_salida` | `public.deshacer_salida(p_item_ids jsonb, p_empresa_id uuid default null) → integer` | admin, cajero, cocina, barra | Arrepentimiento: `listo` → `enviado` (limpia `listo_en`). Mismas validaciones y auditoría (`item_salida_deshacer`) que `marcar_salida`. |
| `pedir_anulacion` | `public.pedir_anulacion(p_item_id uuid, p_motivo text, p_empresa_id uuid = null) → boolean` | admin, cajero, mesero, cocina, barra | El cocinero/barra (o cualquiera con acceso) SOLICITA anular un ítem `enviado` o `listo`. Motivo obligatorio («El motivo es obligatorio»). La cuenta debe estar `abierta` o `precuenta`. El ítem pasa a `anulacion` guardando `anulacion_estado_previo` (para poder rechazar), `anulacion_motivo`, `anulacion_por=auth.uid()`, `anulacion_pedida_en`. Audita `item_anulacion_pedida`. |
| `resolver_anulacion` | `public.resolver_anulacion(p_item_id uuid, p_aprobar boolean, p_motivo text default null, p_empresa_id uuid = null) → boolean` | admin, cajero | resuelve la solicitud pendiente (error «Ese ítem no tiene una anulación pendiente» si el ítem no está en `anulacion`). **Aprueba** ⇒ `anulado` con `motivo_anulacion` = el motivo pasado o el pedido (fallback 'sin motivo') + `anulacion_resuelta_por/en`. **Rechaza** ⇒ vuelve al `anulacion_estado_previo` (o `enviado`) y limpia todos los campos `anulacion_*`. Audita `item_anulacion_resuelta`. |

Nota: el corte directo `anular_item` (§3.7) sigue existiendo para admin/cajero (con motivo obligatorio en ítems `enviado/listo/anulacion`); el flujo nuevo es para que cocina/barra **pidan** sin poder ejecutar.

### 3.23 Inventario — v0.13 (sección 009 de `supabase/setup.sql`) — SOLO rol admin
Siete RPCs nuevas en la tabla de abajo, más el descuento automático de stock que vive dentro de `cobrar_cuenta` (§3.13). Todas `security definer`, con gate `private.exigir_rol(array['admin'])`, y siguen la regla 8 (§0). El cliente las usa en `src/components/inventario/InventarioPage.jsx` (y `AuditoriaPage.jsx` para `auditoria_listar`); en modo demo no hay inventario.

| RPC | Firma exacta (setup.sql) | Qué hace |
|---|---|---|
| `inventario_listar` | `public.inventario_listar(p_empresa_id uuid default null) → jsonb` | Todo lo que necesita la pantalla de una sola vez: `{ insumos: [{id,nombre,unidad,stock,stock_min,costo,activo}] (ordenado por nombre), productos: [{id,nombre,recetas:[{insumo_id,cantidad}]}] (solo activos) }`. Es la lectura de recetas: **no existe** una `receta_listar` aparte. |
| `insumo_guardar` | `public.insumo_guardar(p_insumo jsonb, p_empresa_id uuid default null) → uuid` | Upsert. `p_insumo = { id?, nombre, unidad?, stock?, stock_min?, costo?, activo? }`. Con `id` ⇒ actualiza esa fila (de la empresa activa, si no «El insumo no existe en la empresa activa»); sin `id` ⇒ inserta o actualiza por nombre normalizado (`on conflict (empresa_id, lower(nombre))`). Nombre vacío ⇒ error; duplicado ⇒ «Ya existe otro insumo con ese nombre en la empresa». Devuelve el uuid del insumo. |
| `insumo_borrar` | `public.insumo_borrar(p_insumo_id uuid, p_empresa_id uuid default null) → boolean` | Borrado **real** (las recetas y los movimientos caen en cascada por FK). Audita `insumo_borrar`. |
| `insumo_movimiento` | `public.insumo_movimiento(p_insumo_id uuid, p_tipo text, p_cantidad numeric, p_nota text default null, p_empresa_id uuid default null) → numeric` | Movimiento manual: `p_tipo ∈ {entrada,salida,ajuste}` (otro ⇒ error), `p_cantidad > 0` obligatorio. `ajuste` **fija** el stock al valor pasado (no lo suma). Inserta el movimiento con `stock_after` y `usuario_nombre` snapshot. Devuelve el stock nuevo. Ojo: la base NO rechaza salidas que dejen stock negativo (el comentario del cliente que sugiere lo contrario es impreciso). Audita `insumo_movimiento`. |
| `receta_reemplazar` | `public.receta_reemplazar(p_producto_id uuid, p_lineas jsonb, p_empresa_id uuid default null) → integer` | Guarda la receta COMPLETA de un plato (borra y reinserta; reemplazo total, no parche). `p_lineas = [{ insumo_id, cantidad }]` con `cantidad > 0` y insumo de la empresa activa (faltantes ⇒ error en español). `p_lineas = []` ⇒ deja el plato sin receta. Devuelve el nº de líneas. Audita `receta_guardar`. |
| `movimientos_listar` | `public.movimientos_listar(p_dias integer default 7, p_limite integer default 200, p_empresa_id uuid default null) → jsonb` | Historial de `insumos_movimientos` (tipo `entrada/salida/venta/ajuste`) de la empresa: `[{ en, insumo_nombre ('(insumo eliminado)' si ya no existe), tipo, cantidad, stock_after, nota, usuario_nombre }]`. `p_dias` recortado a 1..90, `p_limite` a 1..500. |
| `auditoria_listar` | `public.auditoria_listar(p_dias integer default 7, p_accion text default null, p_actor uuid default null, p_limite integer default 300, p_empresa_id uuid default null) → jsonb` | **Auditoría local**: el admin del negocio lee la suya sin depender del super. Filtros opcionales por acción y por actor; `p_dias` 1..90, `p_limite` 1..500. Devuelve `[{ en, actor, actor_nombre, actor_rol, accion, detalle, entity_type, entity_label }]` (los NULL salen como '—'). `super_listar_auditoria` (§3.19) sigue intacta para el panel del super. |

Las funciones de inventario se apoyan en `private.auditar(empresa, accion, detalle, entity_type, entity_label)`: la firma histórica de 3 argumentos fue **reemplazada** por una de 5 con los dos últimos `default null` (antes de crearla se hace `drop` de la de 3, porque `create or replace` con más args crearía una función distinta y ambigua). Las ~40 llamadas viejas de 3 argumentos siguen válidas.

---

## 4. Mapeo 1:1 · acción de `store.jsx` → llamada Supabase

| Acción local | Llamada RPC | Notas |
|---|---|---|
| `d({t:'abrir', mesaId, comensales})` | `rpc('abrir_cuenta', {p_empresa_id, p_mesa_id, p_comensales})` | ids uuid en vez de `'m1'` |
| `d({t:'abrir-directa'})` | `rpc('abrir_venta_directa', {p_empresa_id})` | número lo genera la base |
| `d({t:'item+', cuentaId, p})` | `rpc('agregar_items', {p_cuenta_id, p_items:[{producto_id:p.id, qty:1}]})` | p = fila de `productos` |
| `d({t:'qty', cuentaId, itemId, d})` | `rpc('cambiar_qty_item', {p_item_id, p_delta:d})` | |
| `d({t:'nota', cuentaId, itemId, nota})` | `rpc('poner_nota', {p_item_id, p_nota})` | |
| `d({t:'enviar', cuentaId})` | `rpc('enviar_items', {p_cuenta_id})` | sin p_item_ids = todos |
| `d({t:'anular', cuentaId, itemId, motivo})` | `rpc('anular_item', {p_item_id, p_motivo})` | base exige admin+motivo si enviado |
| `d({t:'precuenta'})` / `d({t:'reabrir'})` | `pre_cuenta` / `reabrir_cuenta` | |
| `d({t:'extras', cuentaId, propina?, descuento?})` | `rpc('aplicar_extras', {p_cuenta_id, p_propina, p_descuento, p_pin?})` | PIN cuando rol ≠ admin |
| `d({t:'comensales~', cuentaId, comensales})` | `rpc('actualizar_comensales', {p_cuenta_id, p_comensales})` | 003; corregir comensales tras la apertura (1..99, no en cuenta cerrada) |
| `d({t:'cobrar', cuentaId, pagos, propina?, descuento?})` | `rpc('cobrar_cuenta', {p_cuenta_id, p_pagos:[{metodo,monto,detalle}], p_propina?, p_descuento?, p_pin?})` | respuesta = objeto ticket |
| `d({t:'unir', cuentaId, mesaIds})` | `rpc('unir_mesas', {p_cuenta_id, p_mesa_ids})` | |
| `d({t:'separar', cuentaId, mesaId})` | `rpc('separar_mesa', {p_cuenta_id, p_mesa_id})` | |
| `d({t:'mover', cuentaId, itemIds, mesaDestino})` | `rpc('mover_items', {p_cuenta_id, p_item_ids, p_mesa_destino})` | o `p_cuenta_destino_id` |
| `d({t:'turno+', usuario, fondo})` | `rpc('abrir_turno', {p_empresa_id, p_fondo})` | usuario = auth.uid() implícito |
| `d({t:'turno-', usuario, contado})` | `rpc('cerrar_turno', {p_contado})` | |
| `d({t:'caja-mov+', tipo, monto, motivo})` | `rpc('registrar_movimiento_caja', {p_tipo, p_monto, p_motivo})` | |
| `d({t:'mesa+'|'mesa~'|'mesa-'})` | `insert/update/delete` directos en `mesas` (admin) | sin RPC: RLS exige admin. `mesa~` lleva además el **arrastre con posición persistida** (un solo dispatch al soltar el puntero: `{x,y}`) y el **cambio de salón** (`zona_id`); en `tiendaSupabase.js` mapea `cap→capacidad`, `zona→zona_id`. |
| `d({t:'zona+'|'zona~'|'zona-'})` | `insert/update/delete` en `zonas` (admin) | CRUD de salones con `orden` (renumerar con ▲▼ vía `zona~`). El borrado es **hard delete** y las mesas de esa zona quedan `zona_id=null` (no existe columna `activa` en `zonas`). |
| `d({t:'seccion+'|'seccion~'})` / `d({t:'producto+'|'producto~'})` | insert/update en `secciones_menu` / `productos` (admin) | `producto+`/reactivación pasan por el trigger de cuota (002): si excede el límite ⇒ error §5; el campo `imagen_path` se escribe directo tras subir el blob a Storage (ver fila siguiente) |
| foto de artículo (`MenuAdmin`) | `sb.storage.from('pos-imagenes').upload('productos/{empresa}/{producto}.webp', blob)` + `update productos set imagen_path` | pipeline en `src/services/imagenProducto.js` (comprime a 90 px ⇒ se muestra a 45 px); políticas de Storage atan la carpeta `{empresa}` al miembro (002 §3) |
| `d({t:'seccion-'})` | update `productos set activo=false where seccion_id=...` + delete sección | RLS admin |
| `d({t:'producto-'})` | update `productos set activo=false` | no hard-delete (snapshots) |
| `d({t:'cfg~', cambios})` | update `empresas set nombre/propina_pct/iva_pct/config` | admin |
| `cuentaActiva(s, mesaId)` | `select('*').from('v_estado_mesas').eq('mesa_id', id)` | o `from('cuentas').neq('estado','cerrada')` + `cuenta_mesas` |
| `totalCuenta` / `totalFinal` / `pagadoCuenta` | columnas `subtotal`/`total` de `v_estado_mesas`; pagos: `select('monto').eq('cuenta_id',...)` | la fuente de verdad del cobro es la RPC |
| `s.caja.turno` | `select('*').from('turnos_caja').eq('empresa_id', E).is('cerrado_en', null)` | |
| `s.usuariosDemo` | `membresias` + `auth.users` (login real) | desaparece |

**Refresh de estado:** tras cada RPC, recargar `v_estado_mesas` (y `cuentas/cuenta_items` de la cuenta abierta) o suscribirse por Realtime a `cuentas`/`mesas` (ver checklist del schema). Las RPCs devuelven payloads actualizados: re-serializar desde la respuesta cuando exista (agregar_items, cobrar, cerrar_turno).

**Pantallas nuevas de v0.13 (fuera del reducer):** `CocinaPage`, `InventarioPage` y `AuditoriaPage` NO son acciones del store: llaman sus RPCs (§3.22/§3.23) directamente con `rpc()` y se refrescan por poll + Realtime (`cuenta_items` en cocina). No tienen simulación demo: `CocinaPage` y `InventarioPage` muestran un aviso explícito sin conexión, y `AuditoriaPage` depende de datos que solo existen en la base real.

---

## 5. Errores

`raise exception` en español legible por usuarios finales (mostrar `error.message` en toast). Códigos habituales: mesa ya ocupada, cuenta cerrada/estado incorrecto, rol insuficiente, PIN incorrecto, pago insuficiente (`'el pago (X Bs) no cubre el total (Y Bs)'`), turno ya abierto/no abierto. Desde 002/003 se suman: cuota agotada (`'El plan gratuito permite N artículos como máximo. Para tener más artículos, solicite el plan de pagos.'` — mensaje de venta; la UI **no** muestra "plan gratuito" en ningún otro sitio, es decisión de negocio) y comensales fuera de rango (`'El número de comensales debe estar entre 1 y 99'`). El throttle de `empresa_por_codigo` **no** lanza error: devuelve 0 filas (§3.18). Regla: **toda mutación es todo-o-nada**; ante error, el cliente re-sincroniza desde la base (nunca aplica el cambio local "por las dudas").

## 6. Permisos por rol (la base manda; `src/services/permisos.js` es solo UX)

- **mesero:** abrir/crear cuentas, items, enviar, anular pendientes, unir/separar/mover, extras sin descuento, pre-cuenta/reabrir, ver la cola de cocina/barra y pedir anulación de enviados (la aprueba cajero/admin). NO cobra, NO anula enviados por corte directo, NO caja, NO toca catálogo.
- **cajero:** todo lo del mesero + cobrar + turnos/movimientos de caja + anular enviados/listos con motivo + aprobar/rechazar anulaciones. Descuento ⇒ necesita PIN propio.
- **admin:** todo lo anterior + descuentos sin PIN + CRUD catálogo/config + pantalla Equipo + **inventario y auditoría local (roles exclusivos)**.
- **cocina / barra (v0.13):** ÚNICAMENTE su pantalla de área: `cola_de_area`, `marcar_salida`/`deshacer_salida` y `pedir_anulacion` (solicitud; nunca `resolver_anulacion`). No ven salón ni caja ni catálogo, no cobran, no autorizan nada hacia arriba. No pueden anular por corte directo (`anular_item` los rechaza).

## 7. Fuera de alcance en v1 (para coordinar)

- Alta de empresas/miembros desde la app: **resuelto en v0.5** (alta self-service + pantalla Equipo). El seed comentado que existía al final del antiguo esquema hoy vive al final de la sección base de `supabase/setup.sql`. **Primer admin:** `update public.membresias set user_id = auth.uid() ...` funciona SOLO en sesión autenticada; en el SQL editor usar el insert por email (seed Opción A, comentado y listo).
- `dividir_cuenta` (por ítems/partes/personas): se compone en el cliente con `separar_mesa` + `mover_items` + `cobrar_cuenta`; RPC dedicada queda para v2 si hace falta atomicidad extra.
- Ticket impreso: IA-3 consume el jsonb de `cobrar_cuenta`; no toca la base.
- ~~Backups/migraciones versionadas~~ → hoy: TODO el backend en un único archivo idempotente `supabase/setup.sql` (pegar COMPLETO en el SQL Editor tras cada cambio; el flujo con `supabase migration` de CLI queda para cuando haya proyecto local vinculado). Orden interno y despliegue en §8.

---

## 8. Despliegue del backend — UN solo archivo, UN solo pegado

`supabase/setup.sql` es el **único SQL del proyecto** (~4.900 líneas, envuelto en `begin;` … `commit;`): se pega COMPLETO en el SQL Editor de Supabase. Es idempotente y atómico — se puede re-pegar todas veces que haga falta (base nueva o ya instalada) sin duplicar ni romper nada; si algo falla, el `rollback` no deja nada a medias. **Regla: tras cada cambio en el backend, volver a pegar el archivo completo.** El antiguo archivo suelto del super y las migraciones numeradas como archivos (001–007) fueron fusionados dentro; hoy son secciones internas que ya corren en el orden correcto dentro del propio archivo:

1. Esquema base: tablas, RLS multi-tenant, RPCs de negocio, `public.es_super()`.
2. Sección 001 — `supers`, `es_super()`, `fijar_empresa`, export/import (v1).
3. Sección 002 — cuota oculta (`limites`), auditoría, storage de miniaturas, throttle, hardening, super-entrar, export/import **v2 con histórico**.
4. Sección 003 — RPC `actualizar_comensales`.
5. Sección 004 — trigger de alta self-service de empresa + RPCs `equipo_*` y `super_resetear_clave`.
6. Sección 006 — RPC `empresas_para_login` (lista de empresas del login, ejecutable por `anon`).
7. Sección 007 — cola de impresión (estación del local): `trabajos_impresion` + RPCs `encolar_impresion`/`reclamar_impresion`/`finalizar_impresion`/`listar_impresion`/`gestionar_impresion` + Realtime.
8. Sección 008 — retención de datos (purga nocturna pg_cron, solo plan gratis), `mi_plan`, `exportar_mi_empresa`.
9. Sección 009 (v0.13) — roles `cocina`/`barra`, `areas text[]` en productos/cuenta_items, estados `listo`/`anulacion`, RPCs de cola/salida/anulación (§3.22), `auditoria_listar` local y columnas legibles de auditoría (§1, §3.23), tablas y RPCs de inventario (§3.23) y **super fusionado** (`crear_super`/`quitar_super`, que antes vivían en el archivo suelto ya eliminado).

Al final del archivo, bloque «★ PASO OPCIONAL ★»: `select public.crear_super('tu@correo.com', 'ClaveMin8Caracteres', 'Tu nombre', true) where false;` — se editan las comillas, se quita el `where false` y el mismo pegado completo promociona al dueño a super. Sin tocarlo, el resto del archivo funciona igual.

**Ajuste del dashboard que necesita el alta self-service:** Authentication → Sign In / Up ⇒ **Allow new signups ON** y **Confirm email OFF** (sin autoconfirmación el `signUp` no devuelve sesión y el negocio queda a medio crear hasta que el usuario abra el correo). Comprobado y dejado ON/OFF desde la API de gestión el 2026-10-16 (`mailer_autoconfirm: true`, `disable_signup: false`).

**Estado en el proyecto Supabase real (`oeyrnenclklmczlfoxzy`):** las secciones 002, 003, 004 y 005 (2026-10-16; 004 dos veces: la primera aplicación falló en `equipo_listar` con 42804 y se re-aplicó con el `::text` corregido) quedaron aplicadas cuando aún eran archivos sueltos; el esquema y la 001 lo estaban desde v0.3. Con la fusión, la única verificación que vale hoy es **re-pegar `supabase/setup.sql` completo** (las 008/009 — retención y v0.13 — no se han probado contra la base real). Cada sección termina con un `select` de verificación (en el SQL Editor `auth.uid()` es NULL ⇒ solo devuelve contados: filas de `limites`/`throttle`/`auditoria`, columna `imagen_path`, triggers, políticas de Storage, bucket). Para probar una RPC de negocio con sesión real desde el editor: `begin; select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true); select set_config('app.empresa_id','<uuid>', true); select * from <rpc>(); commit;`.

**Prueba hecha de `crear_super` (2026-10-16, con cuenta desechable luego borrada):** la cuenta creada inicia sesión por `POST /auth/v1/token?grant_type=password` (200 con `access_token`; ojo, el parámetro es `grant_type`, no `grant`) y `POST /rest/v1/rpc/es_super` con ese token devuelve `true`. Re-pegar `crear_super` sin el flag devolvió el mismo uuid y mantuvo la clave vieja (login viejo 200, login con la clave nueva 400); con `p_reemplazar_clave := true` entró la clave nueva (200). `quitar_super` dejó `supers` en su valor anterior y la cuenta siguió pudiendo entrar. Borrar el usuario de prueba con `delete from auth.users` limpió en cascada `identities`, `perfiles` y `supers` (0 huérfanos).
