// Configuración global de Supabase para GitHub Pages
// ATENCIÓN: Reemplaza estos valores con la URL y tu "anon public key"
const _SUPABASE_URL = 'https://edrdxiyyxiedezwekwzo.supabase.co';
const _SUPABASE_ANON_KEY = 'sb_publishable_jN0geXUtTxTyuQFm0WgNUw_v2DdqqgE';

// Inicializar cliente Supabase globalmente
if (!_SUPABASE_ANON_KEY.startsWith('eyJ')) {
    console.warn(">>> ADVERTENCIA: La API KEY no tiene el formato estándar de Supabase (JWT).");
}

// Configuración para evitar errores de sesión (Auth) y optimizar Realtime
window.supabaseClient = supabase.createClient(_SUPABASE_URL, _SUPABASE_ANON_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'cyber-auth-key-' + Math.random(), // Evitar colisiones
        storage: window.sessionStorage // Usar memoria volátil
    }
});

// Captura global de errores de promesas para depuración
window.addEventListener('unhandledrejection', event => {
    if (event.reason && event.reason.code === '403') {
        console.warn(">>> BLOQUEO 403 DETECTADO: Probablemente RLS o API Key. El sistema intentará continuar...");
        event.preventDefault();
    }
});

console.log(">>> SISTEMA DE CONFIGURACIÓN LISTO <<<", !!window.supabaseClient);
