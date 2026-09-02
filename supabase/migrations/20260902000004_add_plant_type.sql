ALTER TABLE public.node_deployments
ADD COLUMN plant_type text DEFAULT 'tropical';

-- Ensure it's one of the valid types (optional constraint)
ALTER TABLE public.node_deployments
ADD CONSTRAINT valid_plant_type
CHECK (plant_type IN ('tropical', 'succulent', 'carnivorous', 'herb'));
