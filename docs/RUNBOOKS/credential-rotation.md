# Runbook — Credential Rotation

**Owner:** CodeForge Security Engineering
**Status:** ACTIVE — execute the **Immediate remediation** section below as soon
as this branch lands.

---

## Why this exists

`apps/api/.env.example` (formerly `backend/.env.example`) shipped a real
Supabase pooler URL with the URL-encoded password `Gfgmitadt@#$25` in commit
history. The Stage-0 PR replaces that file with placeholders, but the **secret
is still in git history**. Any rotation must be done by a human with access to
the Supabase dashboard and the production secret store; an automated agent
must NOT perform the rotation.

---

## ⚠ Immediate remediation (one-time, do this NOW)

Perform the following steps **in order**. Estimated time: 30 minutes.

### Step 1 — Rotate the Supabase database password

1. Sign in to the Supabase dashboard for project `stcsbpsuttenaaxmxzce`.
2. Settings → Database → "Reset database password" → generate a fresh password
   (32+ chars; mixed case, digits, symbols).
3. Copy the new password to your password manager IMMEDIATELY. It is shown only
   once.
4. The pooler URL host (`aws-1-ap-south-1.pooler.supabase.com`) does not
   change; only the password component changes.

### Step 2 — Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET`

Both must be different from any value that previously existed in repo / env.
Generate two 64-byte values:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# run TWICE — once for JWT_SECRET, once for JWT_REFRESH_SECRET
```

Also rotate `CSRF_SECRET` (32 bytes is sufficient):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3 — Update production secret store

Whichever store you use (1Password / Doppler / Vault / Kubernetes secrets):

- `DATABASE_URL` → use the new Supabase password (URL-encode special chars).
- `JWT_SECRET` → the first value from Step 2.
- `JWT_REFRESH_SECRET` → the second value from Step 2.
- `CSRF_SECRET` → the third value from Step 2.

After updating, perform a rolling restart of:

- `apps/api` (so it picks up the new JWT/CSRF secrets — all existing user
  sessions will be invalidated as a side effect, which is the goal),
- any judge-worker / async-worker that uses `DATABASE_URL`.

### Step 4 — Verify

1. From a fresh shell, `pnpm install` and `pnpm --filter @codeforge/api exec
prisma db pull` should succeed.
2. Run `pnpm gitleaks` from the repo root — should report 0 leaks against the
   working tree (it still finds the historical leak; that's Step 5).
3. Smoke-test login on production: register a fresh user → verify email →
   login → call `/api/auth/me`.

### Step 5 — Purge the leaked secret from git history

> **This is destructive.** Coordinate with every collaborator before running
> it. After the force-push, everyone must re-clone or run `git fetch && git
reset --hard origin/main` on every active branch.

```bash
# Install: pip install git-filter-repo  (or use the BFG instead)
pip install git-filter-repo

# Backup the repo before anything else
cd /tmp && git clone --mirror git@github.com:<org>/codeforge.git codeforge-backup.git

# Replace the leaked password (and any other tokens) with a redaction marker
cd /path/to/working-clone
cat > /tmp/expressions.txt <<'EOF'
literal:Gfgmitadt@#$25==>REDACTED
regex:Gfgmitadt%40%23%2425==>REDACTED
EOF

git filter-repo --replace-text /tmp/expressions.txt

# Re-add the remote (filter-repo wipes it for safety) and force-push
git remote add origin git@github.com:<org>/codeforge.git
git push --force origin main
git push --force --tags
```

Notify the team in #codeforge-dev:

> Force-pushed `main` after `git filter-repo`. Stop everything, re-clone (or
> `git fetch && git reset --hard origin/main`), and report any open PRs so we
> can re-base them.

### Step 6 — GitHub / GitLab side cleanup

- GitHub: Settings → Security → Secret scanning → mark the alert as
  "Revoked". Confirm the legacy URL no longer appears anywhere.
- Re-trigger any cached deployments (CI artifacts, Docker layers) that might
  still hold the old credential. Invalidate cache where applicable.

### Step 7 — Verify with gitleaks against history

```bash
gitleaks detect --redact --source . --report-format sarif --report-path /tmp/gitleaks.sarif
```

Expect **zero** findings.

---

## Routine rotations (calendar-driven, not incident-driven)

| Secret                  | Rotation cadence   | Process                                   |
| ----------------------- | ------------------ | ----------------------------------------- |
| `DATABASE_URL` password | 365 days           | Steps 1, 3, 4 above                       |
| `JWT_SECRET` (signing)  | 180 days, dual-key | Run dual-key window (see below)           |
| `JWT_REFRESH_SECRET`    | 180 days, dual-key | Same as JWT_SECRET                        |
| `CSRF_SECRET`           | 365 days           | Single-shot rotation; users re-issue CSRF |
| S3 access keys          | 90 days            | Create v2, deploy, deprecate v1           |
| LiveKit keys (post-B4)  | 90 days            | Per LiveKit docs                          |
| Sentry DSN              | On-revoke only     | Per Sentry docs                           |

### JWT dual-key window

For routine `JWT_SECRET` rotation **without** invalidating live sessions:

1. Add `JWT_SECRET_NEXT` to env; deploy. (`apps/api` currently only reads
   `JWT_SECRET`; this requires a small code change to verify against both —
   tracked in the A0 follow-up backlog.)
2. After 1 day, promote `JWT_SECRET_NEXT` → `JWT_SECRET`. New tokens sign with
   the new key. Old tokens verify under the previous slot.
3. After token TTL (15 min for access, 30 days for refresh) elapses, delete
   the previous slot.

---

## Disclosure

If you find a credential in the repo:

1. Do NOT push the fix as a normal commit. Report to security@codeforge in
   private; coordinate the rotation.
2. Treat the credential as compromised from the moment it was committed,
   regardless of repo visibility.
3. Audit logs for unauthorised use of the credential during the exposure
   window. Capture the audit before rotating (rotation destroys the trail).

---

## Related

- [SECURITY.md](../SECURITY.md) — overall threat model & disclosure policy.
- [MASTER_PLAN.md](../../MASTER_PLAN.md) §1 #1 — the original critical finding.
- `.gitleaks.toml` — patterns that gate future commits.
