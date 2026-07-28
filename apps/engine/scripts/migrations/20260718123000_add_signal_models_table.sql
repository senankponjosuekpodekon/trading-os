CREATE TABLE IF NOT EXISTS signal_models (
    name TEXT PRIMARY KEY,
    model_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
