-- AlterTable
ALTER TABLE "Contest" ADD COLUMN "freezeAt" TIMESTAMP(3),
ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN "activeManifestId" TEXT;

-- AlterTable
ALTER TABLE "ContestParticipant" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'REGISTERED',
ADD COLUMN "ratingAtRegistration" INTEGER NOT NULL DEFAULT 1500,
ADD COLUMN "withdrawnAt" TIMESTAMP(3),
ADD COLUMN "disqualifiedAt" TIMESTAMP(3),
ADD COLUMN "disqualificationReason" TEXT;

-- AlterTable
ALTER TABLE "PracticeJob" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'PRACTICE',
ADD COLUMN "contestId" TEXT,
ADD COLUMN "admittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContestManifest" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "registrationOpensAt" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3) NOT NULL,
    "freezeAt" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL DEFAULT 1000,
    "isRated" BOOLEAN NOT NULL DEFAULT false,
    "divisionMin" INTEGER,
    "divisionMax" INTEGER,
    "scoringPolicy" TEXT NOT NULL DEFAULT 'icpc-binary-v1',
    "ratingPolicy" TEXT NOT NULL DEFAULT 'codeforge-pairwise-elo-v1',
    "problems" JSONB NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "runtimePolicyHash" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestSubmission" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "problemLabel" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "verdict" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestScoreboardSnapshot" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "asOfTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestScoreboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestRatingLedger" (
    "id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldRating" INTEGER NOT NULL,
    "newRating" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "performance" INTEGER,
    "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
    "manifestHash" TEXT NOT NULL,
    "scoringHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestRatingLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestDispute" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "resolutionReason" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestSettlementJob" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "errorReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestSettlementJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContestManifest_contestId_revision_key" ON "ContestManifest"("contestId", "revision");

-- CreateIndex
CREATE INDEX "ContestManifest_contestId_status_idx" ON "ContestManifest"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContestSubmission_jobId_key" ON "ContestSubmission"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestSubmission_contestId_userId_idempotencyKey_key" ON "ContestSubmission"("contestId", "userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ContestSubmission_contestId_admittedAt_idx" ON "ContestSubmission"("contestId", "admittedAt");

-- CreateIndex
CREATE INDEX "ContestSubmission_contestId_problemLabel_idx" ON "ContestSubmission"("contestId", "problemLabel");

-- CreateIndex
CREATE INDEX "ContestSubmission_contestId_userId_idx" ON "ContestSubmission"("contestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestScoreboardSnapshot_contestId_revision_isFrozen_key" ON "ContestScoreboardSnapshot"("contestId", "revision", "isFrozen");

-- CreateIndex
CREATE INDEX "ContestScoreboardSnapshot_contestId_createdAt_idx" ON "ContestScoreboardSnapshot"("contestId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ContestRatingLedger_generation_contestId_userId_key" ON "ContestRatingLedger"("generation", "contestId", "userId");

-- CreateIndex
CREATE INDEX "ContestRatingLedger_userId_isAuthoritative_idx" ON "ContestRatingLedger"("userId", "isAuthoritative");

-- CreateIndex
CREATE INDEX "ContestRatingLedger_contestId_generation_idx" ON "ContestRatingLedger"("contestId", "generation");

-- CreateIndex
CREATE INDEX "ContestDispute_contestId_status_idx" ON "ContestDispute"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContestSettlementJob_operationId_key" ON "ContestSettlementJob"("operationId");

-- CreateIndex
CREATE INDEX "ContestSettlementJob_contestId_state_idx" ON "ContestSettlementJob"("contestId", "state");

-- CreateIndex
CREATE INDEX "PracticeJob_scope_state_idx" ON "PracticeJob"("scope", "state");

-- CreateIndex
CREATE INDEX "PracticeJob_contestId_idx" ON "PracticeJob"("contestId");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_activeManifestId_fkey" FOREIGN KEY ("activeManifestId") REFERENCES "ContestManifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestManifest" ADD CONSTRAINT "ContestManifest_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestManifest" ADD CONSTRAINT "ContestManifest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestManifest" ADD CONSTRAINT "ContestManifest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "ContestManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PracticeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PracticeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestScoreboardSnapshot" ADD CONSTRAINT "ContestScoreboardSnapshot_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestRatingLedger" ADD CONSTRAINT "ContestRatingLedger_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestRatingLedger" ADD CONSTRAINT "ContestRatingLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestDispute" ADD CONSTRAINT "ContestDispute_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestDispute" ADD CONSTRAINT "ContestDispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestDispute" ADD CONSTRAINT "ContestDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSettlementJob" ADD CONSTRAINT "ContestSettlementJob_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariant constraints
ALTER TABLE "ContestManifest" ADD CONSTRAINT "ContestManifest_bounds" CHECK (
  "revision" > 0 AND "manifestHash" ~ '^[0-9a-f]{64}$' AND "runtimePolicyHash" ~ '^[0-9a-f]{64}$' AND
  "status" IN ('DRAFT', 'SEALED', 'SUPERSEDED') AND
  "scoringPolicy" = 'icpc-binary-v1' AND "ratingPolicy" = 'codeforge-pairwise-elo-v1' AND
  ("reviewerId" IS NULL OR "reviewerId" <> "authorId") AND
  ("status" <> 'SEALED' OR ("approvedAt" IS NOT NULL AND "reviewerId" IS NOT NULL))
);

ALTER TABLE "PracticeJob" ADD CONSTRAINT "PracticeJob_scope_bounds" CHECK (
  "scope" IN ('PRACTICE', 'CONTEST')
);

-- Update trigger function to include scope, contestId, and admittedAt in immutable input check
CREATE OR REPLACE FUNCTION codeforge_freeze_practice_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."ownerId", NEW."versionId", NEW."kind", NEW."language", NEW."source", NEW."sourceHash", NEW."input", NEW."requestHash", NEW."idempotencyKey", NEW."policy", NEW."generation", NEW."originJobId", NEW."createdAt", NEW."scope", NEW."contestId", NEW."admittedAt")
    IS DISTINCT FROM ROW(OLD."ownerId", OLD."versionId", OLD."kind", OLD."language", OLD."source", OLD."sourceHash", OLD."input", OLD."requestHash", OLD."idempotencyKey", OLD."policy", OLD."generation", OLD."originJobId", OLD."createdAt", OLD."scope", OLD."contestId", OLD."admittedAt") THEN
    RAISE EXCEPTION 'Execution input is immutable';
  END IF;
  IF OLD."state" IN ('TERMINAL', 'CANCELLED', 'DEAD_LETTER') AND NEW."state" <> OLD."state" THEN
    RAISE EXCEPTION 'Create a new execution generation';
  END IF;
  IF OLD."publicResult" IS NOT NULL AND ROW(NEW."publicResult", NEW."privateResult", NEW."verdict") IS DISTINCT FROM ROW(OLD."publicResult", OLD."privateResult", OLD."verdict") THEN
    RAISE EXCEPTION 'Terminal evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
