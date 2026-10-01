-- AlterTable
ALTER TABLE "QuizQuestion" ADD COLUMN     "license" TEXT,
ADD COLUMN     "rightsAttestedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "QuizTest" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "withdrawalReason" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnBy" TEXT;

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "activeKey" TEXT,
ADD COLUMN     "deadlineAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuizResponse" ADD COLUMN     "scoringSnapshot" JSONB;

-- Existing attempts remain readable. This freezes the currently stored content
-- at migration time; operators must investigate previously modified questions.
UPDATE "QuizResponse" AS response
SET "scoringSnapshot" = jsonb_build_object(
    'type', question."type"::text,
    'stemMd', question."stemMd",
    'payload', question."payload",
    'scoringPolicy', test."sections"->0->'scoringPolicy'
)
FROM "QuizAttempt" AS attempt, "QuizTest" AS test, "QuizQuestion" AS question
WHERE response."attemptId" = attempt."id"
  AND response."questionId" = question."id"
  AND attempt."testId" = test."id";

-- Refuse to guess which duplicate active attempt should survive. The operator
-- must resolve any duplicates and record the decision before deploying.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "QuizAttempt"
    WHERE "submittedAt" IS NULL
    GROUP BY "testId", "userId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active quiz attempts require manual resolution';
  END IF;
END $$;

UPDATE "QuizAttempt"
SET "activeKey" = "testId" || ':' || "userId"
WHERE "submittedAt" IS NULL;

UPDATE "QuizAttempt" AS attempt
SET "deadlineAt" = attempt."startedAt" + test."durationMinutes" * INTERVAL '1 minute'
FROM "QuizTest" AS test
WHERE attempt."testId" = test."id";

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_activeKey_key" ON "QuizAttempt"("activeKey");
