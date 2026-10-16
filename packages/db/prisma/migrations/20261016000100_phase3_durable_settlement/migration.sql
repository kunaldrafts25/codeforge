-- Durable request identity and leased recovery for contest publication.
ALTER TABLE "ContestSettlementJob"
  ADD COLUMN "request" JSONB,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseUntil" TIMESTAMP(3);
CREATE INDEX "ContestSettlementJob_state_availableAt_idx"
  ON "ContestSettlementJob"("state", "availableAt");
-- Old queue rows had no recoverable input/actor and cannot safely be executed.
-- Preserve them as explicit operator-visible failures rather than guessing.
UPDATE "ContestSettlementJob" SET "state" = 'DEAD_LETTER',
  "errorReason" = 'Legacy operation has no durable request; resubmit with a new operation key'
  WHERE "state" IN ('QUEUED', 'RUNNING', 'FAILED') AND "request" IS NULL;
