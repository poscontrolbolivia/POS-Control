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
