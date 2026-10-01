SELECT 'User', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "User" t
UNION ALL SELECT 'QuizQuestion', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizQuestion" t
UNION ALL SELECT 'QuizTest', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizTest" t
UNION ALL SELECT 'QuizAttempt', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizAttempt" t
UNION ALL SELECT 'QuizResponse', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "QuizResponse" t
UNION ALL SELECT 'AuditLog', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "AuditLog" t
UNION ALL SELECT '_prisma_migrations', count(*), md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM "_prisma_migrations" t;
