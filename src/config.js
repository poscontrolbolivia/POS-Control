// Datos de Supabase (proyecto "POS Control Project"). La anon/publishable key es pública por diseño;
// la seguridad real la dan RLS + RPCs. Mientras estén vacíos, la app usa datos simulados locales.
export const SUPABASE_URL = 'https://oeyrnenclklmczlfoxzy.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_f-yDXislPsQz5YqvUS0Umw_cSNhy65o'
export const MONEDA = 'Bs'
export const USAR_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

// WhatsApp de soporte (Alex, Bolivia), en formato internacional sin '+' ni espacios.
// Lo usa la pantalla "¿Olvidaste tu clave?" cuando el que no puede entrar es administrador
// de su negocio: el reset automático por correo está desactivado a propósito, así que el
// super admin le fija una clave nueva desde el panel. Cajeros y meseros NO vienen aquí:
// su clave la decide un administrador del negocio desde Configuración → Equipo.
export const SOPORTE_WHATSAPP = '59177299692'
