-- Create node_microclimates table to store pre-calculated profiles

CREATE TABLE IF NOT EXISTS public.node_microclimates (
    device_id TEXT PRIMARY KEY,
    dli_avg NUMERIC,
    dli_class TEXT NOT NULL DEFAULT 'unknown',
    vpd_avg NUMERIC,
    vpd_class TEXT NOT NULL DEFAULT 'unknown',
    v_grav NUMERIC,
    v_dry NUMERIC,
    drain_class TEXT NOT NULL DEFAULT 'unknown',
    retention_hours NUMERIC,
    is_historical_rate BOOLEAN NOT NULL DEFAULT false,
    last_watered_at TIMESTAMPTZ,
    current_phase INTEGER,
    days_of_data INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.node_microclimates ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (adjust according to your auth rules)
CREATE POLICY "Allow read access to authenticated users" 
ON public.node_microclimates FOR SELECT 
TO authenticated 
USING (true);

-- Create policy for service role / admin inserts
CREATE POLICY "Allow full access to service role" 
ON public.node_microclimates FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role');

-- Create an updated_at trigger (assuming the function already exists or we create it)
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_node_microclimates_updated_at ON public.node_microclimates;
CREATE TRIGGER set_node_microclimates_updated_at
BEFORE UPDATE ON public.node_microclimates
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();
