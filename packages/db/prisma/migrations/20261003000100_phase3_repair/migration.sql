-- Phase 3 Repair Migration: sealed manifest immutability + ContestSettlementJob finishedAt column
-- This migration adds a trigger that prevents mutations to SEALED ContestManifest rows,
-- and adds the finishedAt column to ContestSettlementJob which was missing from the original schema.

-- Add missing finishedAt to ContestSettlementJob (was defined in settlement but not in original migration)
ALTER TABLE "ContestSettlementJob" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);

-- Add missing payload column for operation result storage
ALTER TABLE "ContestSettlementJob" ADD COLUMN IF NOT EXISTS "payload" JSONB;

-- Create trigger function for sealed manifest immutability
CREATE OR REPLACE FUNCTION codeforge_freeze_contest_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Once a manifest is SEALED, its content fields become immutable.
  -- Only status transitions (SEALED -> SUPERSEDED) are permitted.
  IF OLD."status" = 'SEALED' THEN
    IF ROW(
      NEW."contestId", NEW."revision", NEW."title", NEW."slug", NEW."description",
      NEW."startTime", NEW."endTime", NEW."registrationOpensAt", NEW."registrationClosesAt",
      NEW."freezeAt", NEW."capacity", NEW."isRated", NEW."divisionMin", NEW."divisionMax",
      NEW."scoringPolicy", NEW."ratingPolicy", NEW."problems", NEW."manifestHash",
      NEW."runtimePolicyHash", NEW."authorId", NEW."reviewerId", NEW."approvedAt"
    ) IS DISTINCT FROM ROW(
      OLD."contestId", OLD."revision", OLD."title", OLD."slug", OLD."description",
      OLD."startTime", OLD."endTime", OLD."registrationOpensAt", OLD."registrationClosesAt",
      OLD."freezeAt", OLD."capacity", OLD."isRated", OLD."divisionMin", OLD."divisionMax",
      OLD."scoringPolicy", OLD."ratingPolicy", OLD."problems", OLD."manifestHash",
      OLD."runtimePolicyHash", OLD."authorId", OLD."reviewerId", OLD."approvedAt"
    ) THEN
      RAISE EXCEPTION 'Sealed manifest content is immutable. Only status transitions are permitted.';
    END IF;
    -- Only SEALED -> SUPERSEDED is a valid status transition
    IF NEW."status" NOT IN ('SEALED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'Invalid sealed manifest transition: SEALED can only transition to SUPERSEDED';
    END IF;
  END IF;
  -- Prevent deletion of sealed manifests directly (use ON DELETE RESTRICT on FK)
  RETURN NEW;
END;
$$;

-- Apply trigger to ContestManifest table
DROP TRIGGER IF EXISTS codeforge_freeze_contest_manifest_trig ON "ContestManifest";
CREATE TRIGGER codeforge_freeze_contest_manifest_trig
  BEFORE UPDATE ON "ContestManifest"
  FOR EACH ROW EXECUTE FUNCTION codeforge_freeze_contest_manifest();

-- Add scope filter index on PracticeJob for efficient scope-filtered queries (P3-R2)
CREATE INDEX IF NOT EXISTS "PracticeJob_ownerId_scope_kind_idx"
  ON "PracticeJob"("ownerId", "scope", "kind");

-- Add check on ContestSettlementJob state values
ALTER TABLE "ContestSettlementJob" DROP CONSTRAINT IF EXISTS "ContestSettlementJob_state_bounds";
ALTER TABLE "ContestSettlementJob" ADD CONSTRAINT "ContestSettlementJob_state_bounds"
  CHECK ("state" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'TERMINAL', 'FAILED', 'DEAD_LETTER'));

-- Add check on ContestSettlementJob type values
ALTER TABLE "ContestSettlementJob" DROP CONSTRAINT IF EXISTS "ContestSettlementJob_type_bounds";
ALTER TABLE "ContestSettlementJob" ADD CONSTRAINT "ContestSettlementJob_type_bounds"
  CHECK ("type" IN ('FINALIZE', 'REPLAY', 'CORRECTION', 'REJUDGE_REPLAY', 'DISQUALIFY_REPLAY'));

