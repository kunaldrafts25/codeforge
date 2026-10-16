-- Phase 3 Repair: Prevent deletion of SEALED ContestManifest rows
CREATE OR REPLACE FUNCTION codeforge_prevent_delete_sealed_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'SEALED' THEN
    RAISE EXCEPTION 'Sealed manifest cannot be deleted. Only SUPERSEDED manifests can be archived.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS codeforge_prevent_delete_sealed_manifest_trig ON "ContestManifest";
CREATE TRIGGER codeforge_prevent_delete_sealed_manifest_trig
  BEFORE DELETE ON "ContestManifest"
  FOR EACH ROW EXECUTE FUNCTION codeforge_prevent_delete_sealed_manifest();
