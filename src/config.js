// Datos de Supabase (proyecto "POS Control Project"). La anon/publishable key es pública por diseño;
// la seguridad real la dan RLS + RPCs. Mientras estén vacíos, la app usa datos simulados locales.
export const SUPABASE_URL = 'https://oeyrnenclklmczlfoxzy.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_f-yDXislPsQz5YqvUS0Umw_cSNhy65o'
export const MONEDA = 'Bs'
export const USAR_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
