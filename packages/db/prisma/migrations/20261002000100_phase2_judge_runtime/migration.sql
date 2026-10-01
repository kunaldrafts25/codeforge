-- Additive runtime admission record; prior applied migrations remain unchanged.
CREATE TABLE "PracticeJudgeRuntime" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policy" JSONB NOT NULL,
  "policyHash" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeJudgeRuntime_bounds" CHECK (
    "policyHash" ~ '^[0-9a-f]{64}$' AND "evidenceHash" ~ '^[0-9a-f]{64}$'
    AND "expiresAt" > "heartbeatAt" AND "expiresAt" <= "heartbeatAt" + INTERVAL '2 minutes'
  )
);
