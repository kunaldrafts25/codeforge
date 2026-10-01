-- CreateTable
CREATE TABLE "PracticeVersion" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "package" JSONB NOT NULL,
    "packageHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validation" JSONB,
    "reviewerId" TEXT,
    "rightsBasis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "PracticeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "input" TEXT,
    "requestHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "originJobId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" TEXT,
    "publicResult" JSONB,
    "privateResult" JSONB,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeOutbox" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSolve" (
    "ownerId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSolve_pkey" PRIMARY KEY ("ownerId","problemId")
);

-- CreateIndex
CREATE INDEX "PracticeVersion_problemId_status_idx" ON "PracticeVersion"("problemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeVersion_problemId_number_key" ON "PracticeVersion"("problemId", "number");

-- CreateIndex
CREATE INDEX "PracticeJob_state_availableAt_idx" ON "PracticeJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "PracticeJob_ownerId_createdAt_idx" ON "PracticeJob"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeJob_ownerId_idempotencyKey_key" ON "PracticeJob"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeJob_originJobId_generation_key" ON "PracticeJob"("originJobId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeOutbox_jobId_key" ON "PracticeOutbox"("jobId");

-- CreateIndex
CREATE INDEX "PracticeOutbox_deliveredAt_availableAt_idx" ON "PracticeOutbox"("deliveredAt", "availableAt");

-- AddForeignKey
ALTER TABLE "PracticeVersion" ADD CONSTRAINT "PracticeVersion_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeVersion" ADD CONSTRAINT "PracticeVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeVersion" ADD CONSTRAINT "PracticeVersion_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeJob" ADD CONSTRAINT "PracticeJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeJob" ADD CONSTRAINT "PracticeJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PracticeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeJob" ADD CONSTRAINT "PracticeJob_originJobId_fkey" FOREIGN KEY ("originJobId") REFERENCES "PracticeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeOutbox" ADD CONSTRAINT "PracticeOutbox_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PracticeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSolve" ADD CONSTRAINT "PracticeSolve_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSolve" ADD CONSTRAINT "PracticeSolve_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewed invariants: append-only packages; no applied Phase 1 table changes.
ALTER TABLE "PracticeVersion" ADD CONSTRAINT "PracticeVersion_bounds" CHECK (
  "number" > 0 AND "packageHash" ~ '^[0-9a-f]{64}$' AND
  "status" IN ('DRAFT', 'VALIDATED', 'APPROVED', 'PUBLISHED', 'WITHDRAWN') AND
  ("reviewerId" IS NULL OR "reviewerId" <> "authorId") AND
  ("status" NOT IN ('APPROVED', 'PUBLISHED') OR
    ("validation" IS NOT NULL AND "reviewerId" IS NOT NULL AND "approvedAt" IS NOT NULL))
);
ALTER TABLE "PracticeJob" ADD CONSTRAINT "PracticeJob_bounds" CHECK (
  "kind" IN ('RUN', 'SUBMIT', 'VALIDATE') AND
  "language" IN ('cpp', 'python', 'java', 'javascript') AND
  "state" IN ('QUEUED', 'COMPILING', 'RUNNING', 'TERMINAL', 'CANCELLED', 'DEAD_LETTER') AND
  octet_length("source") BETWEEN 1 AND 65536 AND
  ("input" IS NULL OR octet_length("input") <= 65536) AND
  "attempt" BETWEEN 0 AND 3 AND "fence" >= 0 AND "generation" > 0 AND
  "sourceHash" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$'
);
CREATE FUNCTION codeforge_freeze_practice_package() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Practice packages are append-only';
  END IF;
  IF ROW(NEW."problemId", NEW."number", NEW."authorId", NEW."package", NEW."packageHash", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."problemId", OLD."number", OLD."authorId", OLD."package", OLD."packageHash", OLD."createdAt") THEN
    RAISE EXCEPTION 'Create a new immutable problem version';
  END IF;
  IF OLD."status" = 'WITHDRAWN' AND NEW."status" <> 'WITHDRAWN' THEN
    RAISE EXCEPTION 'Withdrawn versions cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PracticeVersion_immutable" BEFORE UPDATE OR DELETE ON "PracticeVersion"
  FOR EACH ROW EXECUTE FUNCTION codeforge_freeze_practice_package();

CREATE FUNCTION codeforge_freeze_practice_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."ownerId", NEW."versionId", NEW."kind", NEW."language", NEW."source", NEW."sourceHash", NEW."input", NEW."requestHash", NEW."idempotencyKey", NEW."policy", NEW."generation", NEW."originJobId", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."ownerId", OLD."versionId", OLD."kind", OLD."language", OLD."source", OLD."sourceHash", OLD."input", OLD."requestHash", OLD."idempotencyKey", OLD."policy", OLD."generation", OLD."originJobId", OLD."createdAt") THEN
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
CREATE TRIGGER "PracticeJob_immutable" BEFORE UPDATE ON "PracticeJob"
  FOR EACH ROW EXECUTE FUNCTION codeforge_freeze_practice_job();
