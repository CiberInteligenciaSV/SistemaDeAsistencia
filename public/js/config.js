// Configuración global de Supabase para GitHub Pages
// ATENCIÓN: Reemplaza estos valores con la URL y tu "anon public key"
const _SUPABASE_URL = 'https://edrdxiyyxiedezwekwzo.supabase.co';
const _SUPABASE_ANON_KEY = 'sb_publishable_jN0geXUtTxTyuQFm0WgNUw_v2DdqqgE';

// Inicializar cliente Supabase globalmente
window.supabaseClient = supabase.createClient(_SUPABASE_URL, _SUPABASE_ANON_KEY);
console.log(">>> CONFIG.JS CARGADO EXITOSAMENTE <<<", !!window.supabaseClient);
