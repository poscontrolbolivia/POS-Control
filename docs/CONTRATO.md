# CONTRATO · Supabase backend ↔ cliente POS

**Estado:** v1.1 · IA-1 + hilo principal · Archivos de referencia: `supabase/schema.sql` + `supabase/migraciones/001_super.sql` → `002_seguridad.sql` → `003_comensales.sql` (pegar en el SQL editor en ese orden; ver §8; idempotentes).
**Destinatarios:** IA-2 (Salón/operación), IA-3 (login/layout/gestión), y cualquier contribuidor futuro.
Este documento define el modelo de datos, las RPCs con firma exacta, las convenciones y el mapeo 1:1 desde las acciones locales de `src/services/store.jsx` (hoy localStorage) hacia Supabase.

---

## 0. Reglas de oro (no negociables)

1. **Nunca mutar tablas de negocio directamente.** `cuentas`, `cuenta_mesas`, `cuenta_items`, `pagos`, `turnos_caja` son **solo SELECT** para el cliente; toda escritura va por RPC (transaccionales y con validación de rol en la base). El cliente NO tiene permisos de INSERT/UPDATE/DELETE sobre ellas aunque las pida: fallará con `permission denied`.
2. **`empresa_id` nunca se envía en el payload de datos**: la empresa activa la fija la base (`private.fijar_empresa`) al inicio de cada RPC a partir de `p_empresa_id` + membresía real del `auth.uid()`. Un uuid de empresa ajeno ⇒ error, y el RLS devuelve 0 filas.
3. **IDs `uuid` generados en la base** (`gen_random_uuid()`). El cliente no inventa ids; usa los que devuelven las RPCs.
4. **Dinero = `numeric(10,2)`, moneda Bs.** Nunca float en la capa de datos. Redondeos/validaciones de importes: en la base.
5. **Snapshot en items:** al agregar un producto se congelan `nombre_snapshot` y `precio_snapshot` en `cuenta_items`. El ticket/cobro SIEMPRE usa el snapshot, nunca `productos` actual.
6. **Coordenadas del mapa de mesas: lienzo normalizado 1000 × 600** (x,w ∈ [0,1000]; y,h ∈ [0,600]), idéntico al canvas actual de `SalonPage.jsx` y `store.jsx`. La base lo valida con CHECKs.
7. **Tablas de plataforma ocultas** (`limites`, `throttle`, `auditoria`, migración 002): `force row level security` SIN políticas + `revoke all` desde `public/anon/authenticated` — el tenant no las ve ni por REST (403); solo se escriben desde funciones `security definer` y se leen por RPC privativas del super. La cuota de artículos es invisible para el cliente: la UI nunca muestra "plan gratuito", solo recibe el mensaje de la base al exceder el límite.
8. **Hardening obligatorio en toda función pública nueva**: `revoke all on function … from public, anon;` + `grant execute … to authenticated;` (a `anon` solo si es pre-login, como `empresa_por_codigo`) y `set search_path = ''`.

---

## 1. Modelo de datos (resumen de `schema.sql`)

### Tablas maestro / catálogo (SELECT para todos; escritura directa solo rol admin vía RLS)

| Tabla | Columnas clave | Notas |
|---|---|---|
| `empresas` | `id`, `nombre`, `moneda='Bs'`, `iva_pct`, `propina_pct`, `config jsonb` | El tenant. Config de negocio (← `s.config` del store). |
| `perfiles` | `user_id` (PK = auth.users), `display_name` | Creada por trigger al sign up. Nombres para tickets. |
| `membresias` | `empresa_id`, `user_id`, `rol ∈ {admin,cajero,mesero}`, `pin_descuento_hash` | Usuario↔empresa. Alta de miembros: SQL/dashboard (ver §7). `unique(empresa_id,user_id)`. |
| `zonas` | `id`, `empresa_id`, `nombre`, `orden` | |
| `mesas` | `id`, `empresa_id`, `zona_id`, `nombre`, `x,y,w,h`, `forma ∈ {cuadrada,redonda,rect}`, `capacidad`, `activa` | x/y/w/h en escala 1000×600. `activa=false` en vez de borrar. |
| `secciones_menu` | `id`, `empresa_id`, `nombre`, `orden` | ← `s.secciones` |
| `productos` | `id`, `empresa_id`, `seccion_id`, `nombre`, `precio numeric(10,2)`, `activo`, `imagen_path text NULL` | ← `s.productos`. Borrar = `activo=false` (histórico intacto). `imagen_path` (002): ruta de Storage con CHECK de forma `productos/{uuid-empresa}/{uuid}.{webp|jpg}`; el miniato se muestra a 45×45 px y se guarda a 90 px (2× retina) en el bucket público `pos-imagenes`. |

### Tablas de plataforma (002_seguridad.sql) — OCULTAS para el tenant

| Tabla | Columnas clave | Notas |
|---|---|---|
| `auditoria` | `id bigint`, `empresa_id`, `actor`, `accion`, `detalle jsonb`, `en` | Force RLS sin políticas + `revoke all`. Escrita solo por `private.auditar()` (security definer). Lectura solo por `super_listar_auditoria()`. |
| `limites` | `empresa_id` (PK), `max_productos int` (NULL = ilimitado), `plan 'gratis'\|'pago'`, `notas`, `actualizado_en`, `actualizado_por` | Force RLS deny-all ⇒ por REST devuelve **403**; el comercio no puede leer ni cambiar su cuota. Escrita solo por RPCs del super y por el trigger `trg_nueva_cuota`. Ver §3.19. |
| `throttle` | `clave text` (PK: prefijo+IP), `intentos`, `hasta` | Force RLS sin políticas + `revoke all`. Solo lo toca `private.throttle_ok()` desde `empresa_por_codigo`. Ver §3.18. |

`public.productos` además lleva el trigger `trg_controlar_cuota` (002) que exige la cuota de `limites` en el INSERT/UPDATE ⇒ la cuota se cumple en el servidor aunque se edite la app (detalles en §3.19).

### Tablas de negocio (SELECT directo; MUTACIÓN solo por RPC)

| Tabla | Columnas clave | Notas |
|---|---|---|
| `cuentas` | `id`, `empresa_id`, `tipo ∈ {mesa,directa}`, `numero` (directa), `estado ∈ {abierta,precuenta,cerrada}`, `comensales`, `propina`, `descuento`, `nota`, `abierta_por/abierta_en`, `cerrada_por/cerrada_en` | ← `s.cuentas`. Los `items`/`pagos` viven en tablas propias. |
| `cuenta_mesas` | PK `(cuenta_id, mesa_id)`, `empresa_id` | n:m: una cuenta puede abarcar varias mesas (unión). |
| `cuenta_items` | `id`, `empresa_id`, `cuenta_id`, `producto_id`, `nombre_snapshot`, `precio_snapshot`, `qty ≥ 1`, `estado ∈ {pendiente,enviado,anulado}`, `nota`, `motivo_anulacion`, `enviado_en`, `creada_en` | Anular CONSERVA la fila (auditoría). qty≤0 en `cambiar_qty_item` elimina la fila (igual que el reducer). |
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
| anular ítem **enviado** | admin (+motivo obligatorio) |
| aplicar_extras / cobrar **con descuento** (rol ≠ admin) | + PIN correcto |
| cobrar_cuenta, abrir_turno, registrar_movimiento_caja, cerrar_turno | admin, cajero |
| actualizar_comensales (003) | admin, cajero, mesero |
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
Pendiente: cualquier miembro. **Enviado: solo admin y `p_motivo` no vacío** (guardado en `motivo_anulacion`). El ítem NO se borra, queda `anulado` (excluido de totales).

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

### 3.17 `actualizar_comensales(p_cuenta_id uuid, p_comensales integer, p_empresa_id uuid = null) → integer` (migración 003)
Corregir el número de comensales **después** de abrir la cuenta (mesa o grupo). `security definer`, exige rol admin/cajero/mesero y valida contra la empresa activa. Rechaza fuera de 1..99 con «El número de comensales debe estar entre 1 y 99» (mismo rango que el CHECK de `cuentas.comensales`; se antepone para devolver mensaje en español y no un 23514). NO deja tocar una cuenta ya `cerrada` ni de otra empresa («No se pudo cambiar los comensales: la cuenta no está abierta en esta empresa»). Audita `comensales` en `public.auditoria` si 002 está aplicada. Devuelve el número fijado. Cliente: acción `comensales~` (`store.jsx` → `tiendaSupabase.js`, usado por `SalonPage.jsx`).

### 3.18 `empresa_por_codigo(p_codigo text) → table(id uuid, nombre text, moneda text)` (redefinida en 002)
Endpoint **pre-login** (ejecutable por `anon`): paso 1 del login. Con la migración 002 lleva throttle anti-fuerza-bruta: **30 consultas por IP en 10 minutos** (`private.throttle_ok('cod', 30)`); al agotar devuelve **0 filas** — indistinguible de un código inexistente, en vez de lanzar excepción (la excepción abortaría la transacción y el contador nunca se guardaría, además de delatar la existencia de empresas). Código con menos de 3 caracteres ⇒ también 0 filas sin ruido. El cliente muestra "código no encontrado" en ambos casos.

### 3.19 RPCs de plataforma (super) — migraciones 001 + 002
Todas empiezan con `if not public.es_super() then raise exception 'requiere super'` y siguen la regla 8 (§0). El comercio normal recibe 403/`requiere super`:

| RPC | Qué hace |
|---|---|
| `super_listar_empresas() → jsonb` (001) | Todas las empresas con contadores. |
| `super_ajustar_empresa(p_empresa uuid, p_max_productos integer, p_plan text, p_notas text) → jsonb` (002) | Fija la cuota (`NULL` = sin límite ⇒ plan pago implícito) y el plan `'gratis'|'pago'` en `limites`; audita `super_ajustar_cuota`. |
| `super_ver_cuota(p_empresa uuid) → jsonb` (002) | Lee `{max_productos, plan, notas, productos_actuales}` solo para el panel del super. |
| `super_listar_auditoria(p_empresa uuid = null, p_limite integer = 200) → table(en, actor, accion, detalle, empresa_id)` (002) | Única lectura posible de `auditoria` (tope duro 1000). |
| `super_registrar_exporte(p_empresa uuid) → void` (002) | El panel la llama tras descargar el .json: deja prueba de qué empresa salió de la plataforma y cuándo. |
| `super_exportar_empresa(p_empresa uuid) → jsonb` (001, **redefinida en 002**) | Snapshot con `version: 2`; el bloque `equipo` incluye ahora `user_id` (necesario para reasignar dueños del histórico). Exporta también `cuentas`, `cuenta_mesas`, `cuenta_items`, `pagos` y `turnos`. |
| `super_importar_empresa(p_datos jsonb, p_codigo text, p_clave_inicial text = 'pos12345') → uuid` (001, **redefinida en 002**) | Además del catálogo, **restaura el HISTÓRICO** completo reasignando `abierta_por/cerrada_por/creada_por/abierto_por/cerrado_por` vía el mapa `user_id` de origen → usuario recreatedo (bcrypt coste 10 explícito; usuarios nuevos confirmados con clave temporal). El super está exento del trigger de cuota ⇒ un snapshot de 500 artículos se instala entero. Audita `super_importo`. |
| `fijar_empresa(p_empresa uuid) → void` (001/002) | GUC de **sesión** (`set_config(..., false)`); requiere membresía o ser super; el super además audita `super_entro`. Requiere header `X-Session-Id` en el cliente (conexión pinzada, §2). Con 002 un super puede fijar CUALQUIER empresa y operar (`private.mi_rol()` le da rol `admin` efectivo). |

Reglas de negocio de la cuota (trigger `private.controlar_cuota_productos` sobre `productos`): empresa nueva nace con 30 (trigger `trg_nueva_cuota` en `empresas`); dar de baja (`activo=false`) nunca se bloquea; editar precio/nombre/foto no consume; **reactivar un artículo inactivo sí consume**; `max_productos NULL` = ilimitado; los super están exentos.

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

---

## 5. Errores

`raise exception` en español legible por usuarios finales (mostrar `error.message` en toast). Códigos habituales: mesa ya ocupada, cuenta cerrada/estado incorrecto, rol insuficiente, PIN incorrecto, pago insuficiente (`'el pago (X Bs) no cubre el total (Y Bs)'`), turno ya abierto/no abierto. Desde 002/003 se suman: cuota agotada (`'El plan gratuito permite N artículos como máximo. Para tener más artículos, solicite el plan de pagos.'` — mensaje de venta; la UI **no** muestra "plan gratuito" en ningún otro sitio, es decisión de negocio) y comensales fuera de rango (`'El número de comensales debe estar entre 1 y 99'`). El throttle de `empresa_por_codigo` **no** lanza error: devuelve 0 filas (§3.18). Regla: **toda mutación es todo-o-nada**; ante error, el cliente re-sincroniza desde la base (nunca aplica el cambio local "por las dudas").

## 6. Permisos por rol (la base manda; `src/services/permisos.js` es solo UX)

- **mesero:** abrir/crear cuentas, items, enviar, anular pendientes, unir/separar/mover, extras sin descuento, pre-cuenta/reabrir. NO cobra, NO anula enviados, NO caja, NO toca catálogo.
- **cajero:** todo lo del mesero + cobrar + turnos/movimientos de caja. Descuento ⇒ necesita PIN propio.
- **admin:** todo + anular enviados + descuentos sin PIN + CRUD catálogo/config + alta de miembros (vía SQL por ahora).

## 7. Fuera de alcance en v1 (para coordinar)

- Alta de empresas/miembros desde la app (hoy: dashboard/SQL; ver seed comentado al final de `schema.sql`). **Primer admin:** `update public.membresias set user_id = auth.uid() ...` funciona SOLO en sesión autenticada; en el SQL editor usar el insert por email (seed Opción A, comentado y listo).
- `dividir_cuenta` (por ítems/partes/personas): se compone en el cliente con `separar_mesa` + `mover_items` + `cobrar_cuenta`; RPC dedicada queda para v2 si hace falta atomicidad extra.
- Ticket impreso: IA-3 consume el jsonb de `cobrar_cuenta`; no toca la base.
- ~~Backups/migraciones versionadas~~ → ya se usan: SQL numerado e idempotente en `supabase/migraciones/` (pegar en el SQL Editor; el flujo con `supabase migration` de CLI queda para cuando haya proyecto local vinculado). Orden de deploy en §8.

---

## 8. Despliegue de migraciones — ORDEN EXACTO

Idempotentes, cada una se pega completa en el SQL Editor del proyecto Supabase, SIEMPRE en este orden (las siguientes dependen de las anteriores):

1. `supabase/schema.sql` — base: tablas, RLS multi-tenant, RPCs de negocio, `private.es_super_compat()`.
2. `supabase/migraciones/001_super.sql` — `supers`, `es_super()`, `fijar_empresa`, export/import (v1).
3. `supabase/migraciones/002_seguridad.sql` — cuota oculta (`limites`), auditoría, storage de miniaturas, throttle, hardening, super-entrar, export/import **v2 con histórico**. **Requiere 001** (usa `public.es_super()`/`supers`).
4. `supabase/migraciones/003_comensales.sql` — RPC `actualizar_comensales`. Degrada sin 002 (simplemente no audita), pero el orden correcto es aplicarla después.

**Estado en el proyecto Supabase real (`oeyrnenclklmczlfoxzy`):** 002_seguridad.sql y 003_comensales.sql **ya están aplicadas** (2026-10-16); schema y 001 lo estaban desde v0.3. Cada archivo termina con un `select` de verificación (en el SQL Editor `auth.uid()` es NULL ⇒ solo devuelve contados: filas de `limites`/`throttle`/`auditoria`, columna `imagen_path`, triggers, políticas de Storage, bucket).
