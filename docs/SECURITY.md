# Security

**Owner:** CodeForge Security Engineering
**Disclosure:** `security@codeforge.example` (PGP key fingerprint TBD). Safe-harbour: good-faith research will not be referred to law enforcement.

This is the engineering security reference. The canonical commitments live in
[MASTER_PLAN.md](../MASTER_PLAN.md) §1 (findings) and §5 (non-negotiables).
This file documents what Stage 0 has shipped and what Stage 1+ will add.

---

## What Stage 0 (Foundation) ships

- httpOnly + secure + sameSite=lax cookies (`cf_at` 15-min access, `cf_rt`
  30-day refresh, both signed JWTs). No JWT touches `localStorage`.
- Refresh-token rotation. Every refresh issues a new pair, marks the old
  token revoked, and steal-detection revokes ALL of the user's sessions if
  a revoked refresh is re-presented.
- CSRF protection via `@fastify/csrf-protection` (double-submit cookie). The
  client reads the non-httpOnly `cf_csrf` cookie and echoes it as
  `X-CSRF-Token` on POST/PUT/PATCH/DELETE.
- Argon2id password hashing (memory cost 19 MiB, time cost 2). Bcrypt
  remains supported for legacy verification with lazy migration on next
  successful login.
- Email verification required before login. Token is single-use, hashed in
  DB, 24-hour TTL.
- Password reset flow with single-use 15-minute token. Resetting the
  password revokes all active sessions.
- Login throttling: exponential backoff starts at 5 consecutive failed
  attempts. Account locks for 1 hour after 10 failed attempts.
- Helmet with strict CSP (`strict-dynamic`, no `unsafe-eval`).
- Global rate-limit: 100 req/min per IP. Auth routes: 10 req/min per IP for
  register/login/verify, stricter caps on password-reset flows.
- Pino structured logging with redaction of `password`, `passwordHash`,
  `authorization`, `cookie`, all token / hash fields.
- Sentry (gated on `SENTRY_DSN`).
- Standardised error envelope `{ error: { code, message, requestId, details? } }`
  with `x-request-id` echoed on every response.
- All request/response bodies validated by Zod via
  `fastify-type-provider-zod`. OpenAPI auto-generated at `/api/docs`.
- All markdown rendered through `<Markdown md={...} />`
  (`packages/ui/src/Markdown.tsx`), which routes through `markdown-it`
  (HTML disabled) and DOMPurify. The single legitimate use of
  `dangerouslySetInnerHTML` in the codebase lives there.
- Audit log table (`AuditLog`) records register, login, password reset,
  steal-detection events. Stage-1 agents extend it with their own actions.
- `UserSession` table stores hashed refresh-token state, IP, UA, and
  expiry so sessions can be revoked.
- gitleaks pre-commit hook + CI step blocks new leaks. See
  `.gitleaks.toml` for the rules; see
  [`RUNBOOKS/credential-rotation.md`](./RUNBOOKS/credential-rotation.md)
  for the manual remediation required for the historical leak.

## What Stage 1+ adds

- TOTP 2FA (schema is in place; UI + verify route are A7's territory).
- Per-language seccomp-bpf allowlists inside `isolate` (A1).
- Plagiarism + proctoring (A6, B3, B4).
- Pen-test pass before launch (Stage 4).
- Dual-key window for `JWT_SECRET` rotation (deferred — single-secret today
  invalidates live sessions on rotation).
- Per-tenant at-rest encryption keys for proctoring video (B4).

## Threat model — Stage 0 highlights

| Surface         | Threat                           | Mitigation                                                                                        |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Browser session | XSS exfil of JWT                 | httpOnly cookies; CSP; markdown sanitisation                                                      |
| Browser session | CSRF                             | Double-submit token via `@fastify/csrf-protection`                                                |
| Auth            | Credential stuffing              | Argon2id + login throttling + lockout                                                             |
| Auth            | Refresh-token theft              | Rotation + steal detection                                                                        |
| Auth            | Email enumeration                | Constant 200 on `/auth/password-reset/request`                                                    |
| API             | Unvalidated input                | Zod at boundary; strict Postgres types via Prisma                                                 |
| API             | Verbose errors                   | Standard envelope; never leak stack traces                                                        |
| Repo            | Secret in git                    | gitleaks pre-commit + CI; `.env.example` placeholders only                                        |
| Judge           | Sandbox escape                   | (A1) — currently delegating to public Piston, a known weak surface; tracked as a critical finding |
| Markdown        | Stored XSS via problem statement | `Markdown` component (md-it + DOMPurify)                                                          |

## Disclosure

Email `security@codeforge.example` with details. We aim to triage within 1
business day and to remediate critical issues within 14 days. We will credit
researchers in release notes unless they request otherwise.

## Cross-references

- [PROCTORING-POLICY.md](./PROCTORING-POLICY.md) — candidate-facing data
  commitments.
- [ANTI-CHEAT.md](./ANTI-CHEAT.md) — operational anti-cheat playbook.
- [MASTER_PLAN.md](../MASTER_PLAN.md) §1, §2.3, §5.
- [`RUNBOOKS/credential-rotation.md`](./RUNBOOKS/credential-rotation.md).
