-- Approved historical manifests remain evidence after supersession. Freeze the
-- whole row (including identifiers and timestamps) except the one-way status.
CREATE OR REPLACE FUNCTION codeforge_freeze_contest_manifest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('SEALED', 'SUPERSEDED') THEN
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'Approved manifest content is immutable';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (
      OLD."status" = 'SEALED' AND NEW."status" = 'SUPERSEDED'
    ) THEN
      RAISE EXCEPTION 'Approved manifests only permit SEALED to SUPERSEDED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION codeforge_prevent_delete_sealed_manifest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('SEALED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Approved manifest history cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;
