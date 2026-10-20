export const SUPABASE_URL = 'https://oeyrnenclklmczlfoxzy.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_f-yDXislPsQz5YqvUS0Umw_cSNhy65o'
export const MONEDA = 'Bs'
export const USAR_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const SOPORTE_WHATSAPP = '59177299692'

// La versión sale del package.json en el build (vite.config.js) y va impresa al pie del ticket.
export const VERSION = typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : __APP_VERSION__
