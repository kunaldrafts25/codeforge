SELECT 'PracticeVersion', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "PracticeVersion" t
UNION ALL SELECT 'PracticeJob', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "PracticeJob" t
UNION ALL SELECT 'PracticeOutbox', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "PracticeOutbox" t
UNION ALL SELECT 'PracticeSolve', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY "ownerId", "problemId")) FROM "PracticeSolve" t
UNION ALL SELECT 'Problem', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "Problem" t
UNION ALL SELECT 'ProblemTest', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "ProblemTest" t
UNION ALL SELECT 'User', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "User" t
UNION ALL SELECT 'UserSession', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "UserSession" t
UNION ALL SELECT 'QuizQuestion', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizQuestion" t
UNION ALL SELECT 'QuizTest', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizTest" t
UNION ALL SELECT 'QuizAttempt', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizAttempt" t
UNION ALL SELECT 'QuizResponse', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizResponse" t
UNION ALL SELECT 'AuditLog', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "AuditLog" t
UNION ALL SELECT 'PracticeJudgeRuntime', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "PracticeJudgeRuntime" t
UNION ALL SELECT '_prisma_migrations', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "_prisma_migrations" t;
