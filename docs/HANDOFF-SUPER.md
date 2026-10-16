# HANDOFF-SUPER · carril SUPER ADMIN (dueño de la plataforma)

**Estado:** v1 · 2026-10-16 · carril independiente (no tocó ningún archivo compartido).

Archivos creados por este carril (todos nuevos, dentro de su carril):

| Ruta | Qué es |
|---|---|
| `src/services/super/cliente.js` | Cliente Supabase propio del panel + traducción de errores a español. |
| `src/services/super/superApi.js` | `esSuper()`, `listarEmpresas()`, `exportarEmpresa()`, `importarEmpresa()`, `fijarEmpresa()` y el modo "operando otra empresa" + validación/resumen del respaldo. |
| `src/components/super/SuperPage.jsx` | Panel: tabla de empresas, aviso permanente, exportar, importar, selector de idioma. |
| `src/components/super/EmpresasTabla.jsx` | Tabla + confirmación en pantalla del botón **Entrar**. |
| `src/components/super/ImportarBloque.jsx` | Archivo o JSON pegado, resumen contado antes de importar, resultado con **Entrar ahora**. |
| `src/components/super/IdiomaSelector.jsx` | Selector `es / en / pt` en `localStorage['pos-idioma-app']`, autónomo para el carril i18n. |
| `src/components/super/super.css` | Clases nuevas con prefijo `super-` (no redefine `.ghost`, `.panel`… para no alterar el resto). |

Dependencias: `@supabase/supabase-js` (ya estaba en `package.json`, nada que instalar).

---

## 1. Cómo se decide mostrar el módulo Super

Regla de oro: **la base es la que manda**; el flag del cliente es solo UX.

1. El usuario hace login normal en `LoginPage` (`sb.auth.signInWithPassword`).
2. Se llama a la RPC `public.es_super()` (lee `public.supers` con `auth.uid()`).
3. Si devuelve `true`, se guarda `es_super: true` en la sesión de `localStorage['pos-sesion']`.
4. `App.jsx` añade el módulo `{ id: 'super', nombre: 'Super' }` cuando `sesion.es_super` es `true`, y renderiza `<SuperPage/>` si `modulo === 'super'`.

`SuperPage` **vuelve a comprobar** `es_super()` al montarse (apartado "Comprobando permisos"), así que
aunque alguien edite el `localStorage` a mano solo verá el botón: las RPCs le responderán
`requiere super` y el panel lo mostrará en español. El flag `es_super` es una comodidad, no un permiso.

El super que **no pertenece a ninguna empresa** también debe poder entrar (es el dueño, no un cliente):
el parche de `LoginPage` de la sección 2 lo contempla.

---

## 2. Parches exactos para los archivos compartidos (los mergea el dueño del proyecto)

> Choque probable con el otro carril: `App.jsx`, `LoginPage.jsx`, `Topbar.jsx`, `store.jsx`,
> `config.js` y `services/supabase*.js` los está editando ahora mismo IA-2/IA-3.
> Cada bloque dice **archivo**, **dónde** y **qué insertar**; si el otro carril cambió esas líneas,
> adapta el ancla, no el código.

### 2.1 `src/components/auth/LoginPage.jsx`

**(a) Import**, junto a los imports existentes (línea ~4):

```js
import { esSuper } from '../../services/super/superApi.js'
```

**(b) `listo()` pasa a `async` y añade el flag** (hoy son las líneas ~86-96):

```js
// ANTES
const listo = (emp, rol, user) => {
  fijarEmpresa(emp.id)
  const sesion = {
    empresaId: emp.id, rol, supabase: true,
    usuario: user ? user.email : usuario.trim(),
    nombre: (user && user.email ? user.email.split('@')[0] : usuario.trim()),
    empresa: emp.nombre,
  }
  guardarSesionSup(sesion)
  onEntrar(sesion)
}

// DESPUÉS
const listo = async (emp, rol, user) => {
  fijarEmpresa(emp?.id ?? null)
  const superUsuario = await esSuper().catch(() => false) // solo decide si se muestra el panel
  const sesion = {
    empresaId: emp?.id ?? null, rol: superUsuario && !emp ? 'super' : rol, supabase: true,
    es_super: superUsuario,                              // ← flag que lee App.jsx
    usuario: user ? user.email : usuario.trim(),
    nombre: (user && user.email ? user.email.split('@')[0] : usuario.trim()),
    empresa: emp?.nombre || 'Plataforma',
  }
  guardarSesionSup(sesion)
  onEntrar(sesion)
}
```

**(c) llamadas a `listo` con `await`** (líneas ~77 y ~156):

```js
// en entrar(), rama de empresa única:
if (filasEmpresas.length === 1) { await listo(filasEmpresas[0], conRol(filasEmpresas[0]), user); return }
// en el picker multiempresa:
onClick={() => listo(emp, emp.rol, userRef)}   // queda igual
```

**(d) permitir el login de un super sin membresías** (línea ~75):

```js
// ANTES
if (!filasEmpresas.length) throw new Error('Este usuario no pertenece a ninguna empresa activa.')

// DESPUÉS
if (!filasEmpresas.length) {
  const superUsuario = await esSuper().catch(() => false)
  if (!superUsuario) throw new Error('Este usuario no pertenece a ninguna empresa activa.')
  await listo(null, 'super', user)   // entra sin empresa: App abre directamente el panel Super
  return
}
```

### 2.2 `src/App.jsx`

**(a) imports** (junto a `import ConfigAdmin …`, línea ~12):

```js
import SuperPage from './components/super/SuperPage.jsx'
import { empresaViendo, salirDeEmpresa } from './services/super/superApi.js'
```

**(b) módulo extra** (líneas ~37-39, donde se arma `modulos`):

```js
if (sesion.rol === 'admin') modulos.push({ id: 'config', nombre: 'Configuración' })
if (sesion.es_super) modulos.push({ id: 'super', nombre: 'Super' })
```

**(c) arrancar en el panel cuando no hay empresa** (líneas ~22-24):

```js
const [modulo, setModulo] = useState('salon')
const entrar = u => { setSesion(u); setModulo(u.es_super && !u.empresaId ? 'super' : 'salon') }
```

**(d) render del módulo** (junto a `{modulo === 'config' && …}`, líneas ~46-50):

```js
{modulo === 'super' && sesion.es_super && <SuperPage sesion={sesion} />}
```

**(e) aviso permanente mientras se opera otra empresa** (opcional pero recomendado: el banner de
`SuperPage` solo se ve dentro del panel; este va pegado al Topbar y cubre Salón/Caja/Venta).
Insertar justo después de `<Topbar … />`:

```jsx
{sesion.operando && (
  <div className="topbar-rol" style={{ background: '#8a6d1a', color: '#fff', padding: '6px 14px', borderRadius: 0, display: 'block', width: '100%', textAlign: 'center' }}>
    👁️ Estás viendo la empresa {sesion.empresa} — <button className="auth-enlace" onClick={() => { salirDeEmpresa(); window.location.reload() }}>volver a mi empresa</button>
  </div>
)}
```

**(f) limpieza al salir** (dentro de `salir`, líneas ~26-33):

```js
const salir = () => {
  if (sesion?.operando) salirDeEmpresa()   // borra 'pos-super-sesion-anterior' y el modo operando
  if (sesion?.supabase) { … }              // resto igual que hoy
}
```

### 2.3 `src/components/auth/Topbar.jsx`

No es obligatorio: el Topbar pinta los `modulos` que le pasa `App.jsx`, y el botón **Super** llega solo.
Si se quiere marca visual, añadir dentro de `.topbar-izq` (después del `topbar-user`):

```jsx
{sesion?.es_super && (
  <span className="topbar-rol" style={{ background: '#3b2f63', color: '#fff' }} title="Dueño de la plataforma">super</span>
)}
```

### 2.4 Acuerdos de clave de `localStorage` (por qué mi carril escribe ahí)

| Clave | Dueño | Qué hace este carril |
|---|---|---|
| `pos-sesion` | `store.jsx` / `LoginPage.jsx` | La reescribe con otra `empresaId` + `operando: true` al pulsar **Entrar**; dispara el evento `pos-sesion` que `StoreProvider` ya escucha. |
| `pos-empresa-activa-id` | `services/supabase.js` (`fijarEmpresa`) | Se pone al mismo uuid para que `rpc()` inyecte el `p_empresa_id` correcto. |
| `pos-super-sesion-anterior` | solo este carril | Snapshot de la sesión real del super, para poder **Salir**. |
| `pos-idioma-app` | reservado i18n | Lo escribe `IdiomaSelector`. |

Si el otro carril renombra alguna de esas claves, hay que cambiar las constantes de la cabecera de
`src/services/super/superApi.js` (son las tres primeras).

---

## 3. Notas de seguridad

* **Nunca se usa la service key en el navegador.** Este carril usa la `publishable / anon key` de
  `src/config.js` y únicamente RPCs `security definer` (`es_super`, `super_listar_empresas`,
  `super_exportar_empresa`, `super_importar_empresa`, `fijar_empresa`). Nadie hace `insert`/`update`
  directo sobre `empresas`, `mesas`, `membresias` ni `auth.users`.
* **La validación está en la base.** Cada RPC de la migración empieza con
  `if not public.es_super() then raise exception 'requiere super'`. El flag `es_super` del cliente
  solo decide si se pinta el botón.
* **`public.supers` es la lista más sensible del sistema**: un miembro puede leer y modificar
  cualquier empresa. Solo el dueño de la plataforma; semilla actual
  `85201957-cdfb-4235-acfe-dd1a54e348d0` (revisar antes de vender). La política RLS de `supers`
  (`supers_propio`) ya evita que un cliente la espíe.
* **El `jsonb` exportado contiene datos de cliente** (correos del equipo, roles, nombres, tickets e
  importes). Es un respaldo confiable: tratar los `.json` descargados como dato personal (no
  subirlos a un repo, no enviarlos por WhatsApp, borrarlos tras la importación).
* **`super_importar_empresa` crea usuarios** con bcrypt de la clave inicial (`pos12345` por defecto
  o la que se escriba en el panel). Aviso para el dueño: hay que forzar cambio de clave en el primer
  login del cliente recreado.
* **El botón Entrar no eleva privilegios en la base**: `fijar_empresa` rechaza a quien no sea super
  ni miembro (`no pertenece a esa empresa`), y el panel muestra ese texto tal cual.

---

## 4. Lo que la base todavía NO deja hacer (léelo antes de prometer "entrar a cualquier empresa")

> **ACTUALIZADO 2026-10-16 — RESUELTO: `supabase/migraciones/002_seguridad.sql` está APLICADA en el
> proyecto real.** Los tres huecos de backend descritos abajo (que reproducimos tal cual por
> contexto histórico) quedaron cerrados en la sección 1 de esa migración: `private.fijar_empresa`
> acepta super sin membresía, `private.mi_rol()` le da rol `admin` efectivo en la empresa que está
> viendo, y `public.fijar_empresa` fija el GUC **de sesión** (el cliente ya manda el header
> `X-Session-Id` en `src/services/supabase.js`, así que los SELECT directos ven la empresa). La
> "Opción B" de más abajo NO se aplicó como archivo suelto `002_super_entrar.sql` (ese archivo no
> existe): su contenido vive dentro de `002_seguridad.sql`. El aviso `sondearAcceso` del panel
> (`super.entrar.avisoAcceso`) queda para instalaciones donde la migración aún no se pegó.

Hoy funcionan, probados contra la base real: listado global, exportación completa e importación
round-trip. La parte **"operar la empresa desde la app"** tenía tres huecos de backend, ajenos a este
carril:

1. **Escrituras.** Las RPCs de negocio llaman `private.fijar_empresa(p_empresa_id)`
   (`supabase/schema.sql:364`), que exige **membresía real** y no mira `es_super()`.
   Un super que pulse Entrar en una empresa ajena recibirá
   `el usuario actual no tiene membresía en la empresa …` al abrir una cuenta o cobrar.
2. **Lecturas.** `src/services/tiendaSupabase.js` hace `SELECT` directos (`sb.from('mesas')…`) y la
   política usa `private.empresa_activa()`, que lee el GUC `app.empresa_id`. Ese GUC vive en la
   conexión de Postgres y PostgREST lo limpia entre peticiones HTTP, así que
   `public.fijar_empresa()` **no** lo conserva para las siguientes llamadas.
   (Además la versión de `empresa_activa()` de `001_super.sql` devuelve `null` para un super sin GUC,
   aunque tenga membresía.)
3. **Rol efectivo.** Al pulsar **Entrar** el panel pone `rol: 'admin'` en la sesión para que el dueño
   pueda ver todas las pantallas (Menú, Configuración, Caja). Eso es solo UI: las políticas de
   escritura de `schema.sql` consultan `private.mi_rol()`, que devuelve `NULL` si no hay membresía,
   así que un super sin membresía seguiría recibiendo "rol insuficiente". El parche de abajo lo cubre.

El panel lo detecta y lo dice en pantalla (`sondearAcceso`: compara las mesas del listado con las que
realmente se pueden leer) en vez de dejar un salón vacío.

### Opción A — sin tocar SQL (recomendada para la venta de plan)
El flujo "cliente sube de plan" no necesita que el super navegue por sus datos: basta con
**exportar → importar** (ya probado). El import devuelve un código nuevo y el equipo queda con la clave
inicial; el cliente entra con su propio login y ve TODO su histórico. Y si el super quiere asomarse,
que use un usuario con membresía real en esa empresa (dos cuentas: la de dueño y la operativa).

### Opción B — parche de backend para que "Entrar" funcione de verdad
**APLICADA** — no como archivo suelto, sino dentro de `supabase/migraciones/002_seguridad.sql`
(sección 1, ya ejecutada en el proyecto real). El código propuesto abajo se conserva como
referencia histórica; difiere en detalles menores (usa `private.es_super_compat()` en vez de
`public.es_super()` directamente y añade la validación «empresa inexistente»):

```sql
-- 1) que un super pueda fijar cualquier empresa en las RPCs de negocio
create or replace function private.fijar_empresa(p_empresa_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  v := coalesce(p_empresa_id, private.empresa_activa());
  if v is null then raise exception 'empresa no seleccionada: pase p_empresa_id o defina app.empresa_id'; end if;
  if not (public.es_super()
          or exists (select 1 from public.membresias m
                     where m.empresa_id = v and m.user_id = auth.uid())) then
    raise exception 'el usuario actual no tiene membresía en la empresa %', v;
  end if;
  perform set_config('app.empresa_id', v::text, true);
  return v;
end $$;
```

```sql
-- 2) que un super sin membresía tenga rol efectivo en la empresa que está viendo
create or replace function private.mi_rol()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.rol from public.membresias m
      where m.empresa_id = private.empresa_activa() and m.user_id = auth.uid() limit 1),
    case when public.es_super() then 'admin' end   -- solo si empresa_activa() ya validó al super
  );
$$;
```

```sql
-- 3) que los SELECT directos del super sepan qué empresa está viendo (header por petición)
--    Requiere que el cliente mande 'x-empresa' en cada llamada:
--    sb.from('mesas').select('*').setHeaders({ 'x-empresa': id })  y lo mismo en rpc().
--    (Eso vive en services/supabase.js y services/tiendaSupabase.js → carril del otro agente.)
create or replace function app.pre_request()
returns void language plpgsql security definer set search_path = '' as $$
declare h text := nullif(current_setting('request.header.x-empresa', true), '');
begin
  if h is null then return; end if;
  -- solo se acepta el header si el que llama es super o miembro: si no, se ignora.
  if public.es_super()
     or exists (select 1 from public.membresias m
                where m.empresa_id = h::uuid and m.user_id = auth.uid()) then
    perform set_config('app.empresa_id', h, false);
  end if;
exception when others then null;  -- un header basura no puede tumbar la API
end $$;

alter database postgres set pgrst.db_pre_request = 'app.pre_request';
-- note que PostgREST recarga la config al minuto (o reiniciar el proyecto).
```

Con A o B aplicadas, el botón **Entrar** del panel ya no necesita cambios de código: deja de lanzar el
aviso amarillo. Sin ellas, exportar/importar y el listado siguen funcionando igual.

---

## 5. Checklist de merge

- [ ] `package.json` → `@supabase/supabase-js` presente (ya lo está, v2.118).
- [ ] `LoginPage.jsx`: import `esSuper`, `listo` `async` con flag `es_super`, `await listo(...)`, login de super sin membresías (2.1).
- [ ] `App.jsx`: imports de `SuperPage` y `superApi`, módulo `super`, `entrar()` con módulo inicial, rama `{modulo === 'super' && sesion.es_super && <SuperPage/>}`, banner `sesion.operando`, `salirDeEmpresa()` en `salir()` (2.2).
- [ ] `Topbar.jsx`: opcional, chip `super` (2.3).
- [x] ~~Decidir si se aplica `002_super_entrar.sql` (sección 4) y probar el header `x-empresa` en el carril de datos.~~ → **RESUELTO (2026-10-16)**: se aplicó `supabase/migraciones/002_seguridad.sql` (contiene el parche); el mecanismo elegido fue el GUC de sesión + header **`X-Session-Id`** (ya cableado en `src/services/supabase.js`), no el header `x-empresa`/`app.pre_request`.
- [ ] Confirmar el `user_id` semilla de `public.supers` antes de vender a ningún cliente.
- [ ] `npm run build` tras el merge y prueba manual con una cuenta real de super.
- [ ] i18n: conectar `IdiomaSelector` (prop `value`/`onChange` + `localStorage['pos-idioma-app']`) al diccionario cuando exista.

## 6. Qué quedó probado y qué no (honesto)

* Probado contra la base real (Node, anon key, sin sesión): cliente creado, `es_super()` degrada a
  `false`, todo error de falta de sesión/config se traduce a español, `validarSnapshot`,
  `nombreArchivo` (`pos-control-cafe-nuevo-2026-10-16.json`), rechazos de uuid/código/snapshot.
* Probado por renderizado SSR: `SuperPage`, `EmpresasTabla` (con datos, vacía y con error),
  `ImportarBloque`, `IdiomaSelector` montan sin crash.
* `npm run build`: **0 errores**, pero como todavía nadie importa `SuperPage` desde `App.jsx`, Vite no
  mete mi carril en el bundle; por eso se validó además con un bundle aparte de
  `src/components/super/SuperPage.jsx` (correcto, 32 KB + 3.7 KB de CSS).
* **Sin probar de verdad** (hace falta un login de super real): listado `super_listar_empresas`,
  descarga real del `.json`, importación desde el panel y el flujo Entrar/Salir en navegador.

---

## 7. Novedades para el panel super · migración 002_seguridad.sql (APLICADA, 2026-10-16)

* **Cuota de artículos por empresa** (el modelo de negocio gratis→pago): RPCs solo-super
  `super_ajustar_empresa(p_empresa, p_max_productos, p_plan 'gratis'|'pago', p_notas)` y
  `super_ver_cuota(p_empresa) → {max_productos, plan, notas, productos_actuales}`. Client-side ya
  cableado en `src/services/super/superApi.js` (`verCuota`, `ajustarCuota`). La tabla `limites` es
  oculta (deny-all ⇒ REST 403): el comercio no ve su cuota; solo choca con el límite al crear el
  artículo 31 y recibe el mensaje de venta de la base. Las empresas nacen con 30 (trigger
  `trg_nueva_cuota`); el super está exento del trigger de cuota para que la importación no se rompa.
* **Auditoría de accesos privilegiados**: `super_listar_auditoria(p_empresa, p_limite≤1000)` es la
  única lectura posible de la tabla oculta `auditoria`; acciones registradas: `super_entro`,
  `super_ajustar_cuota`, `super_exporto`, `super_importo`, `throttle_agotado`, `comensales`.
  `super_registrar_exporte(p_empresa)` (client: `registrarExporte`) la llama el panel tras descargar
  el .json para dejar prueba de qué empresa salió de la plataforma.
* **Export/import v2**: `super_exportar_empresa` ahora emite `version: 2` y el bloque `equipo`
  incluye `user_id`; `super_importar_empresa` **restaura el histórico** (cuentas, cuenta_mesas,
  cuenta_items, pagos, turnos_caja) reasignando dueños vía el mapa `user_id` origen → usuario
  recreatedo. Dos gotchas de GoTrue resueltos en 002: las columnas de token de `auth.users` van `''`
  (no NULL, o GoTrue responde 500) y bcrypt con coste 10 explícito.
* **Hardening de convención** (aplicado a toda función nueva de la migración):
  `revoke all … from public, anon;` + `grant execute … to authenticated;` + `set search_path = ''`.
* **Throttle pre-login**: `empresa_por_codigo` (30/IP/10 min) devuelve 0 filas al agotar — el panel
  no debe asumirlo como empresa inexistente en pruebas de carga.
