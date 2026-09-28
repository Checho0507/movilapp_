CREATE TABLE IF NOT EXISTS subscription_plans (
  key text PRIMARY KEY,
  label text NOT NULL,
  days integer NOT NULL CHECK (days > 0),
  price_cop integer NOT NULL DEFAULT 0 CHECK (price_cop >= 0),
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO subscription_plans (key, label, days, price_cop)
VALUES
  ('trial', 'Prueba gratuita', 60, 0),
  ('daily', 'Diario', 1, 3000),
  ('weekly', 'Semanal', 7, 12500),
  ('biweekly', 'Quincenal', 15, 20000),
  ('monthly', 'Mensual', 30, 30000)
ON CONFLICT (key) DO NOTHING;
