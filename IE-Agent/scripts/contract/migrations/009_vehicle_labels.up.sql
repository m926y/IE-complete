BEGIN;
CREATE TABLE IF NOT EXISTS vehicle_labels (
  gpsno text PRIMARY KEY,
  display_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE
);
INSERT INTO vehicle_labels(gpsno)
  SELECT DISTINCT d.gpsno FROM drivers d WHERE d.gpsno IS NOT NULL AND d.gpsno <> ''
    AND NOT EXISTS (SELECT 1 FROM vehicle_labels v WHERE v.gpsno = d.gpsno) ORDER BY d.gpsno
  ON CONFLICT (gpsno) DO NOTHING;
CREATE OR REPLACE FUNCTION ensure_vehicle_display_label() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gpsno IS NOT NULL AND NEW.gpsno <> '' THEN
    INSERT INTO vehicle_labels(gpsno) VALUES (NEW.gpsno) ON CONFLICT (gpsno) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_driver_vehicle_label ON drivers;
CREATE TRIGGER tr_driver_vehicle_label AFTER INSERT OR UPDATE OF gpsno ON drivers
  FOR EACH ROW EXECUTE FUNCTION ensure_vehicle_display_label();
-- Match the existing deployment's database role grants for this new read table.
GRANT SELECT ON vehicle_labels TO anon, authenticated, service_role;
COMMIT;
