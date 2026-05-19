# Security

**Last updated:** 2026-05-19
**Owner:** CodeForge Security Engineering
**Status:** Stub — full content to be authored as Stage 0 (Brief A0) and the sandbox / auth hardening work land.

This document is the engineering security reference for the platform: threat model, authentication and session design, secret management, sandbox hardening, vulnerability-disclosure policy, and incident-response procedures.

The canonical commitments are in [MASTER_PLAN.md](../MASTER_PLAN.md) §1 (critical findings being fixed) and §5 (non-negotiables). When Stage 0 lands, this document will be expanded to cover:

- **Threat model.** STRIDE-style enumeration per surface (auth, judging, proctoring, admin tools, problem authoring), with documented mitigations.
- **Authentication and session.** httpOnly cookie design, refresh-token rotation, CSRF protection, password hashing (argon2id), email verification, password reset, 2FA (TOTP), login throttling, account lockout, session-fingerprint pinning.
- **Sandbox security.** `isolate` configuration, seccomp-bpf allowlists per language, network namespace setup, cgroup limits, host hardening (kernel pin, SMT off, governor=performance), provenance of toolchains.
- **Secret management.** No secrets in repo (gitleaks pre-commit); 1Password / Doppler / Vault for runtime; rotation cadences and procedures (see [RUNBOOKS/credential-rotation.md](./RUNBOOKS/credential-rotation.md)).
- **Transport and at-rest encryption.** TLS 1.3 everywhere; AES-256 at rest with per-tenant key separation; key management.
- **Input validation.** Zod schemas at the API boundary; markdown sanitisation via markdown-it + DOMPurify; output encoding.
- **CORS, helmet, CSP, rate limiting.** Per-route and global settings.
- **Audit logging.** Every admin/moderator action; tamper-evident chain; retention.
- **Vulnerability disclosure policy.** `security@codeforge.example`; response SLAs; safe-harbour language.
- **Penetration test schedule.** Cadence and scope.

Cross-references:

- [PROCTORING-POLICY.md](./PROCTORING-POLICY.md) for candidate-facing data-security commitments.
- [ANTI-CHEAT.md](./ANTI-CHEAT.md) for the anti-cheat / proctoring operations side.
- [MASTER_PLAN.md](../MASTER_PLAN.md) §1, §2.3, §5.
