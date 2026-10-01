-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'PROBLEM_SETTER', 'REVIEWER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "ProblemJudgeMode" AS ENUM ('STDIO', 'FUNCTIONAL', 'INTERACTIVE', 'OUTPUT_ONLY');

-- CreateEnum
CREATE TYPE "ProblemScoring" AS ENUM ('BINARY', 'ICPC_PENALTY', 'ATCODER_POINTS', 'IOI_SUBTASK');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('PENDING', 'QUEUED', 'COMPILING', 'RUNNING', 'ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT', 'MEMORY_LIMIT', 'RUNTIME_ERROR', 'COMPILATION_ERROR', 'OUTPUT_LIMIT', 'PRESENTATION_ERROR', 'JUDGE_FAILURE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'ENDED', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContestFormat" AS ENUM ('ICPC', 'IOI', 'ATCODER', 'CF_HACKS', 'MIXED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ_SINGLE', 'MCQ_MULTI', 'NUMERIC', 'FILL_IN_BLANK', 'TRUE_FALSE', 'MATCH_FOLLOWING', 'ORDERING', 'DESCRIPTIVE', 'CODE_SNIPPET', 'SELECT_OUTPUT', 'SQL_QUERY', 'DRAG_DROP', 'HOTSPOT');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'REVIEWED', 'CALIBRATING', 'LIVE', 'RETIRED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "username" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordAlgo" TEXT NOT NULL DEFAULT 'argon2id',
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "country" TEXT,
    "organization" TEXT,
    "oauthProvider" TEXT,
    "oauthId" TEXT,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "bannedReason" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 1500,
    "maxRating" INTEGER NOT NULL DEFAULT 1500,
    "problemsSolved" INTEGER NOT NULL DEFAULT 0,
    "contestsCount" INTEGER NOT NULL DEFAULT 0,
    "lastContestAt" TIMESTAMP(3),
    "aptitudeTheta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aptitudeScaled" INTEGER NOT NULL DEFAULT 500,
    "aptitudeTestsTaken" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "streakFreezesAvailable" INTEGER NOT NULL DEFAULT 2,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "fingerprint" TEXT,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "statementMd" TEXT NOT NULL,
    "inputFormat" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "notes" TEXT,
    "difficultyBand" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1500,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 20,
    "judgeMode" "ProblemJudgeMode" NOT NULL DEFAULT 'STDIO',
    "scoringMode" "ProblemScoring" NOT NULL DEFAULT 'BINARY',
    "timeLimitMs" INTEGER NOT NULL DEFAULT 2000,
    "memoryLimitKb" INTEGER NOT NULL DEFAULT 262144,
    "outputLimitKb" INTEGER NOT NULL DEFAULT 64,
    "codeLimitKb" INTEGER NOT NULL DEFAULT 64,
    "perLanguageOverrides" JSONB NOT NULL DEFAULT '{}',
    "allowedLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "functionSignature" JSONB,
    "checkerType" TEXT NOT NULL DEFAULT 'token',
    "checkerCode" TEXT,
    "checkerEpsilon" DOUBLE PRECISION,
    "interactorCode" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyTags" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT,
    "license" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'DRAFT',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "totalSubmissions" INTEGER NOT NULL DEFAULT 0,
    "totalAccepted" INTEGER NOT NULL DEFAULT 0,
    "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "dislikes" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT NOT NULL,
    "coordinatorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "testerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTest" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "subtaskId" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "inputBlobKey" TEXT NOT NULL,
    "outputBlobKey" TEXT NOT NULL,
    "inputSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "explanationMd" TEXT,

    CONSTRAINT "ProblemTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemSubtask" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "aggregation" TEXT NOT NULL DEFAULT 'min',
    "dependsOnIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ProblemSubtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarterCode" (
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "StarterCode_pkey" PRIMARY KEY ("problemId","language")
);

-- CreateTable
CREATE TABLE "ReferenceSolution" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isJury" BOOLEAN NOT NULL DEFAULT true,
    "complexityNote" TEXT,

    CONSTRAINT "ReferenceSolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemHint" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "textMd" TEXT NOT NULL,

    CONSTRAINT "ProblemHint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Editorial" (
    "problemId" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "authorId" TEXT,

    CONSTRAINT "Editorial_pkey" PRIMARY KEY ("problemId")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "format" "ContestFormat" NOT NULL DEFAULT 'ICPC',
    "isRated" BOOLEAN NOT NULL DEFAULT false,
    "divisionMin" INTEGER,
    "divisionMax" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "passcode" TEXT,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "freezeAtMinutes" INTEGER,
    "registrationOpensAt" TIMESTAMP(3),
    "registrationClosesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblem" (
    "contestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "ContestProblem_pkey" PRIMARY KEY ("contestId","problemId")
);

-- CreateTable
CREATE TABLE "ContestParticipant" (
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isVirtual" BOOLEAN NOT NULL DEFAULT false,
    "virtualStartAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "problemStates" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("contestId","userId")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contestId" TEXT,
    "language" TEXT NOT NULL,
    "codeBlobKey" TEXT NOT NULL,
    "codeSize" INTEGER NOT NULL DEFAULT 0,
    "verdict" "Verdict" NOT NULL DEFAULT 'PENDING',
    "testsPassed" INTEGER NOT NULL DEFAULT 0,
    "testsTotal" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER,
    "memoryUsedKb" INTEGER,
    "compilerOutput" TEXT,
    "judgeWorkerHost" TEXT,
    "judgeKernelVersion" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "judgedAt" TIMESTAMP(3),
    "pasteCount" INTEGER NOT NULL DEFAULT 0,
    "pasteBytesTotal" INTEGER NOT NULL DEFAULT 0,
    "keystrokeStats" JSONB,
    "editorTimeSpentMs" INTEGER,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionTestResult" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "testIndex" INTEGER NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "timeMs" INTEGER,
    "memoryKb" INTEGER,
    "checkerMsg" TEXT,

    CONSTRAINT "SubmissionTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "oldRating" INTEGER NOT NULL,
    "newRating" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "performance" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hack" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "hackerId" TEXT NOT NULL,
    "victimSubmissionId" TEXT NOT NULL,
    "testBlobKey" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "parentTemplateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "type" "QuestionType" NOT NULL,
    "topic" TEXT NOT NULL,
    "subtopic" TEXT,
    "cognitiveLevel" TEXT,
    "stemMd" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "difficultyBand" TEXT NOT NULL,
    "estimatedSeconds" INTEGER NOT NULL DEFAULT 60,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyTagged" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yearsSeen" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "pValue" DOUBLE PRECISION,
    "discrimination" DOUBLE PRECISION,
    "pointBiserial" DOUBLE PRECISION,
    "meanTimeSeconds" INTEGER,
    "irtA" DOUBLE PRECISION,
    "irtB" DOUBLE PRECISION,
    "irtC" DOUBLE PRECISION,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizTest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "isAdaptive" BOOLEAN NOT NULL DEFAULT false,
    "randomizeOptions" BOOLEAN NOT NULL DEFAULT true,
    "randomizeOrder" BOOLEAN NOT NULL DEFAULT true,
    "passCutoffScaled" INTEGER,
    "sectionalCutoffsJson" JSONB,
    "proctorLevel" TEXT NOT NULL DEFAULT 'strict',
    "requireWebcam" BOOLEAN NOT NULL DEFAULT true,
    "requireFullscreen" BOOLEAN NOT NULL DEFAULT true,
    "requireScreenShare" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizTestItem" (
    "testId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "QuizTestItem_pkey" PRIMARY KEY ("testId","questionId")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "durationActualSeconds" INTEGER,
    "rawScore" DOUBLE PRECISION,
    "scaledScore" INTEGER,
    "percentile" DOUBLE PRECISION,
    "sectionalScores" JSONB NOT NULL DEFAULT '{}',
    "thetaEstimate" DOUBLE PRECISION,
    "suspicionScore" INTEGER NOT NULL DEFAULT 0,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewerNotes" TEXT,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizResponse" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "presentedOrder" INTEGER NOT NULL,
    "optionOrderShown" INTEGER[],
    "answerPayload" JSONB NOT NULL,
    "isCorrect" BOOLEAN,
    "pointsAwarded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "markedForReview" BOOLEAN NOT NULL DEFAULT false,
    "firstShownAt" TIMESTAMP(3) NOT NULL,
    "lastChangedAt" TIMESTAMP(3) NOT NULL,
    "totalTimeSeconds" INTEGER NOT NULL,
    "changeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuizResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptId" TEXT,
    "submissionId" TEXT,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTs" TIMESTAMP(3),

    CONSTRAINT "ProctorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorRecording" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "startTs" TIMESTAMP(3) NOT NULL,
    "endTs" TIMESTAMP(3) NOT NULL,
    "retainUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProctorRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlagiarismMatch" (
    "id" TEXT NOT NULL,
    "fromSubmissionId" TEXT NOT NULL,
    "toSubmissionId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "algorithm" TEXT NOT NULL,
    "matchedFragments" JSONB NOT NULL DEFAULT '[]',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlagiarismMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconUrl" TEXT,
    "rarity" TEXT NOT NULL DEFAULT 'common',

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "DailyChallenge" (
    "date" DATE NOT NULL,
    "problemId" TEXT NOT NULL,

    CONSTRAINT "DailyChallenge_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "problemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "durationDays" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discussion" (
    "id" TEXT NOT NULL,
    "problemId" TEXT,
    "contestId" TEXT,
    "authorId" TEXT NOT NULL,
    "title" TEXT,
    "bodyMd" TEXT NOT NULL,
    "parentId" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discussion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_rating_idx" ON "User"("rating" DESC);

-- CreateIndex
CREATE INDEX "User_aptitudeScaled_idx" ON "User"("aptitudeScaled" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_refreshTokenHash_idx" ON "UserSession"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_idx" ON "VerificationToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_slug_key" ON "Problem"("slug");

-- CreateIndex
CREATE INDEX "Problem_status_isPublic_idx" ON "Problem"("status", "isPublic");

-- CreateIndex
CREATE INDEX "Problem_rating_idx" ON "Problem"("rating");

-- CreateIndex
CREATE INDEX "Problem_difficultyBand_idx" ON "Problem"("difficultyBand");

-- CreateIndex
CREATE INDEX "Problem_authorId_idx" ON "Problem"("authorId");

-- CreateIndex
CREATE INDEX "ProblemTest_problemId_orderIndex_idx" ON "ProblemTest"("problemId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");

-- CreateIndex
CREATE INDEX "Contest_status_startTime_idx" ON "Contest"("status", "startTime");

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_rank_idx" ON "ContestParticipant"("contestId", "rank");

-- CreateIndex
CREATE INDEX "Submission_userId_submittedAt_idx" ON "Submission"("userId", "submittedAt" DESC);

-- CreateIndex
CREATE INDEX "Submission_problemId_idx" ON "Submission"("problemId");

-- CreateIndex
CREATE INDEX "Submission_contestId_idx" ON "Submission"("contestId");

-- CreateIndex
CREATE INDEX "Submission_verdict_idx" ON "Submission"("verdict");

-- CreateIndex
CREATE INDEX "SubmissionTestResult_submissionId_idx" ON "SubmissionTestResult"("submissionId");

-- CreateIndex
CREATE INDEX "RatingChange_userId_idx" ON "RatingChange"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RatingChange_userId_contestId_key" ON "RatingChange"("userId", "contestId");

-- CreateIndex
CREATE INDEX "QuizQuestion_status_topic_idx" ON "QuizQuestion"("status", "topic");

-- CreateIndex
CREATE INDEX "QuizQuestion_difficultyBand_idx" ON "QuizQuestion"("difficultyBand");

-- CreateIndex
CREATE UNIQUE INDEX "QuizTest_slug_key" ON "QuizTest"("slug");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_idx" ON "QuizAttempt"("userId");

-- CreateIndex
CREATE INDEX "QuizAttempt_testId_idx" ON "QuizAttempt"("testId");

-- CreateIndex
CREATE INDEX "QuizResponse_attemptId_idx" ON "QuizResponse"("attemptId");

-- CreateIndex
CREATE INDEX "QuizResponse_questionId_idx" ON "QuizResponse"("questionId");

-- CreateIndex
CREATE INDEX "ProctorEvent_userId_idx" ON "ProctorEvent"("userId");

-- CreateIndex
CREATE INDEX "ProctorEvent_attemptId_idx" ON "ProctorEvent"("attemptId");

-- CreateIndex
CREATE INDEX "ProctorEvent_serverTs_idx" ON "ProctorEvent"("serverTs");

-- CreateIndex
CREATE INDEX "PlagiarismMatch_similarity_idx" ON "PlagiarismMatch"("similarity");

-- CreateIndex
CREATE UNIQUE INDEX "PlagiarismMatch_fromSubmissionId_toSubmissionId_algorithm_key" ON "PlagiarismMatch"("fromSubmissionId", "toSubmissionId", "algorithm");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_slug_key" ON "Badge"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPlan_slug_key" ON "StudyPlan"("slug");

-- CreateIndex
CREATE INDEX "Discussion_problemId_idx" ON "Discussion"("problemId");

-- CreateIndex
CREATE INDEX "Discussion_parentId_idx" ON "Discussion"("parentId");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTest" ADD CONSTRAINT "ProblemTest_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTest" ADD CONSTRAINT "ProblemTest_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemSubtask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemSubtask" ADD CONSTRAINT "ProblemSubtask_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarterCode" ADD CONSTRAINT "StarterCode_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceSolution" ADD CONSTRAINT "ReferenceSolution_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemHint" ADD CONSTRAINT "ProblemHint_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Editorial" ADD CONSTRAINT "Editorial_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionTestResult" ADD CONSTRAINT "SubmissionTestResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingChange" ADD CONSTRAINT "RatingChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingChange" ADD CONSTRAINT "RatingChange_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hack" ADD CONSTRAINT "Hack_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizTestItem" ADD CONSTRAINT "QuizTestItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "QuizTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizTestItem" ADD CONSTRAINT "QuizTestItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "QuizTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizResponse" ADD CONSTRAINT "QuizResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizResponse" ADD CONSTRAINT "QuizResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorRecording" ADD CONSTRAINT "ProctorRecording_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismMatch" ADD CONSTRAINT "PlagiarismMatch_fromSubmissionId_fkey" FOREIGN KEY ("fromSubmissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismMatch" ADD CONSTRAINT "PlagiarismMatch_toSubmissionId_fkey" FOREIGN KEY ("toSubmissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyChallenge" ADD CONSTRAINT "DailyChallenge_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Discussion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
