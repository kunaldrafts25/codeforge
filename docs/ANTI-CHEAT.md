# Anti-Cheat: Engineering &amp; Operations Runbook

**Last updated:** 2026-05-19
**Owner:** CodeForge Trust &amp; Safety Engineering
**Audience:** Engineers building and operating the anti-cheat stack; reviewers running the review queue; on-call incident responders

This document is the internal counterpart of [PROCTORING-POLICY.md](./PROCTORING-POLICY.md). Where the policy is what we tell candidates, this document is what we tell ourselves: the threat model, the layered defence, the weights table, the review SOP, and the operational metrics that tell us whether the whole thing is working.

It is written to be read alongside [MASTER_PLAN.md](../MASTER_PLAN.md) §2.5 (layered defence) and §5 (non-negotiables). Cross-references to "research §N" point to the consolidated research baked into the master plan at §10.

---

## 1. Threat model

We bucket realistic cheating attempts into eleven categories. For each, we list the realistic mitigation we will ship — not the perfect mitigation, because none exists in a web-only environment. Anti-cheat is a layered cost-imposition exercise: each layer makes the cheat harder, slower, or more likely to be detected after the fact.

| #   | Threat                                                                                                             | Who does it                       | Realistic mitigation                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Second tab / second window** — opens ChatGPT, Stack Overflow, a hidden code repo                                 | Casual cheater                    | Page Visibility API + window blur/focus event log (L2). Repeated blurs in close proximity → high suspicion weight. The candidate sees a warning toast each time.                                      |
| 2   | **Second device** — phone or tablet within arm's reach, used for lookup                                            | Casual cheater, paid impersonator | Webcam frame analysis (L3) — server-side YOLOv8 looks for phone, paper, second face. Reviewer confirms.                                                                                               |
| 3   | **Screen-share to a friend** — uses Zoom / Discord / Anydesk to show their screen to a helper who whispers answers | Coordinated cheater               | Mic audio + voice activity detection (L4). Suspicion when a second voice is detected that does not match the candidate's setup-time voiceprint. Multi-monitor signal (Screen.isExtended).             |
| 4   | **Copy-paste from external source** — has answers prepared in a text file or in an LLM                             | Casual cheater (very common)      | Paste event log + paste-burst classifier (L2). A paste of 800+ characters in &lt;1s while the candidate has not been typing for 30 seconds is a high-weight signal.                                   |
| 5   | **AI assistance plugins** — Copilot, Cursor sidekick, Tabnine inside their browser-injected editor                 | Sophisticated cheater             | Keystroke cadence baseline (L4). Auto-generated text has very low intra-word entropy and very rhythmic flight times. We do not deploy GPT-detector classifiers; we use cadence as one signal.         |
| 6   | **Proxy / impersonation** — somebody else takes the test on the candidate's account                                | Paid impersonator                 | ID + selfie verification at start (L3, high-stakes only). Voiceprint sanity check. Device fingerprint match against the candidate's profile history. Webcam face mismatch with reference.             |
| 7   | **MCQ collusion** — group of candidates share answers via WhatsApp, all submit similar patterns                    | Coordinated cheater               | Post-test ω-Index analysis (L5) on the MCQ option permutation — even when option order is shuffled per candidate, ω-Index detects answer-pattern collusion. See §1.5 below.                           |
| 8   | **Screenshots of questions** — to share with friends taking the test later in the day                              | Coordinated cheater               | Per-candidate seeded shuffle (L1) breaks "question 5 is the matrix one". Visible watermark (candidate ID overlay) on screen — does not prevent the screenshot but raises the cost.                    |
| 9   | **VM-hiding** — runs the browser inside a VM where overlays / external agents are invisible to our recording       | Sophisticated cheater             | WebGL vendor/renderer fingerprint (L2) flags SwiftShader, llvmpipe, VirtualBox, VMware. CPU concurrency anomaly check. Inability to enable Screen.isExtended reliably.                                |
| 10  | **Pre-recorded video** — playing a loop of themselves looking at the screen while a helper drives                  | Sophisticated cheater             | Low-frequency challenge prompts ("please touch your right ear within 5 seconds") at random intervals in high-stakes mode. Mic chunked snapshot fingerprint.                                           |
| 11  | **Memorised solutions** — candidate has seen the exact problem and is reproducing a known answer                   | Honest student of past papers     | Live and post-contest plagiarism detection across submissions (Dolos, JPlag) catches copies of well-known solutions; problem-rotation policy on the authoring side reduces the value of memorisation. |

Two threats explicitly out of scope, by design:

- **Side-channel attacks against the sandbox.** Owned by the sandbox layer ([SECURITY.md](./SECURITY.md), not this document).
- **Account takeover.** Owned by the auth layer (httpOnly cookies, refresh-token rotation, 2FA — see [MASTER_PLAN.md](../MASTER_PLAN.md) §5).

---

## 2. Layered defence — implementation map

Following MASTER_PLAN §2.5, our defence is structured in seven layers. Each layer is independently shippable and degrades gracefully if the layer above or below is disabled (for example, in a "light" proctoring level).

| Layer                                                | What it does                                                                                                                                                          | Where it lives in our code (planned paths)                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L0** Lockdown browser (optional, high-stakes only) | Forces Safe Exam Browser configuration for tier-3 customers; OS-level lockdown of clipboard, screenshots, secondary monitors                                          | `infra/seb-configs/` (config files); no app code required                                                                                                                   |
| **L1** Server-authoritative session                  | Per-candidate seeded shuffle (question order + MCQ option order); server timer; server-side option-permutation log                                                    | `apps/api/src/routes/quiz/start.ts`, `apps/api/src/routes/quiz/timer.ts`, `apps/api/src/services/seeded-shuffle.ts`                                                         |
| **L2** Browser hardening                             | Page Visibility, blur/focus, Fullscreen API, paste-event hash logging, DevTools-chord logging, `Screen.isExtended`, FingerprintJS, WebGL vendor inspection            | `packages/proctor-sdk/` (client library); embedded into `apps/web/aptitude/` and `apps/web/arena/contests/`                                                                 |
| **L3** Live media                                    | LiveKit WebRTC for webcam + screen + mic; chunked recording to S3 via LiveKit Egress; identity verification (ID + selfie)                                             | `packages/proctor-sdk/src/media/`, `apps/async-worker/forensics/recording-ingest.ts`, `apps/admin/review/identity.ts`                                                       |
| **L4** Behavioural signals                           | Keystroke cadence (dwell + flight), paste ratio, gaze drift (MediaPipe Face Landmarker), Voice Activity Detection (Silero VAD)                                        | `packages/proctor-sdk/src/behavioural/`, `apps/async-worker/forensics/cadence-scorer.ts`, `apps/async-worker/forensics/gaze-aggregator.ts`                                  |
| **L5** Post-hoc analysis                             | Plagiarism: Dolos (live mid-contest), JPlag (post-contest batch), AST-hash index for code; ω-Index for MCQ collusion; sentence-transformer similarity for descriptive | `apps/async-worker/plagiarism/dolos.ts`, `apps/async-worker/plagiarism/jplag.ts`, `apps/async-worker/plagiarism/omega-index.ts`, `apps/async-worker/plagiarism/ast-hash.ts` |
| **L6** Human review                                  | Reviewer dashboard with synchronised timeline, video clips, similarity matches; decision form; appeal pipeline                                                        | `apps/admin/review/`, `apps/api/src/routes/admin/review/`                                                                                                                   |

The hard rule: **L6 always has the final say**. The first five layers produce evidence and a suspicion score; they cannot, on their own, change the status of a candidate's attempt. This is enforced in code: the suspicion-score writer has no permission to update `QuizAttempt.reviewStatus` away from `pending`; only the reviewer-decision endpoint can do that, and only an authenticated reviewer can call it.

### 2.1 Why these layers, and not others

- **No GPT-detector classifier.** The published false-positive rates on AI-text classifiers are too high to ship without producing a generation of unjustly accused candidates. OpenAI itself retired its own classifier for this reason. We rely on cadence and post-hoc plagiarism, both of which have human review built in.
- **No "abnormal facial expression" or "stress detection".** These pseudoscientific signals are not in our stack. See research §6 (EFF on online proctoring) and the policy in PROCTORING-POLICY.md.
- **No covert recording.** All recording requires explicit consent. There is no setting to record before the consent modal is acknowledged. (Enforced by the LiveKit room not being created until the consent endpoint returns 200.)
- **No automatic disqualification at any threshold.** This is a hard policy rule, not a tunable.

### 2.2 What each layer can be turned off, and what stays on

| Proctor level | L0     | L1  | L2  | L3 webcam | L3 mic | L3 screen | L4 cadence | L4 gaze | L5  | L6  |
| ------------- | ------ | --- | --- | --------- | ------ | --------- | ---------- | ------- | --- | --- |
| `off`         | –      | on  | –   | –         | –      | –         | –          | –       | on  | on  |
| `light`       | –      | on  | on  | –         | –      | –         | on         | –       | on  | on  |
| `strict`      | –      | on  | on  | on        | –      | –         | on         | on      | on  | on  |
| `high_stakes` | opt-in | on  | on  | on        | on     | on        | on         | on      | on  | on  |

L1, L5, and L6 are always on. Plagiarism analysis runs on every submission regardless of proctor level — it produces signals about the submission itself, not about the candidate's identity or environment.

---

## 3. Suspicion-score weights table

These weights are reproduced from research §7.1. They are **starting values** to ship the system; they will be tuned with real data per the workflow in §6 below.

| Event type                                                                             | Severity bucket | Weight |
| -------------------------------------------------------------------------------------- | --------------- | ------ |
| `tab_blur` (single, &lt; 2s)                                                           | info            | 1      |
| `tab_blur` (single, 2–10s)                                                             | warn            | 3      |
| `tab_blur` (&gt; 10s, or 3+ in 5min)                                                   | flag            | 8      |
| `fullscreen_exit` (&lt; 5s, returns automatically)                                     | info            | 1      |
| `fullscreen_exit` (sustained or repeated)                                              | flag            | 6      |
| `paste` (&lt; 50 chars)                                                                | info            | 1      |
| `paste` (50–500 chars)                                                                 | warn            | 4      |
| `paste` (&gt; 500 chars in &lt; 1s)                                                    | flag            | 10     |
| `paste_ratio` &gt; 0.7 for descriptive answer                                          | warn            | 5      |
| `paste_ratio` &gt; 0.9 for descriptive answer                                          | flag            | 9      |
| `devtools_chord` (F12 etc.)                                                            | warn            | 4      |
| `copy` (any)                                                                           | info            | 1      |
| `keystroke_z_score` &gt; 3 (cadence very unlike baseline)                              | warn            | 5      |
| `keystroke_z_score` &gt; 5                                                             | flag            | 8      |
| `multi_face` (&gt; 1 face detected in webcam frame for &gt; 5s)                        | flag            | 12     |
| `no_face` (no face detected for &gt; 10s)                                              | warn            | 3      |
| `no_face` (no face detected for &gt; 30s)                                              | flag            | 7      |
| `gaze_off` (eyes off-screen &gt; 5s continuous)                                        | info            | 1      |
| `gaze_off` (eyes off-screen pattern for 30+s aggregated)                               | warn            | 3      |
| `voice_detected` (single brief utterance)                                              | info            | 1      |
| `voice_detected` (sustained or second-voice classifier triggers)                       | flag            | 9      |
| `multi_monitor` (Screen.isExtended = true at start)                                    | warn            | 4      |
| `phone_detected` (server-side YOLOv8 confidence &gt; 0.8)                              | flag            | 12     |
| `paper_detected` (YOLOv8)                                                              | warn            | 4      |
| `vm_signature` (WebGL renderer = SwiftShader/llvmpipe/VBox/VMware)                     | warn            | 5      |
| `fp_change` (FingerprintJS hash changed mid-session)                                   | flag            | 7      |
| `large_paste_burst` (3+ flag-level pastes within 60s)                                  | flag            | 12     |
| `network_anomaly` (IP change mid-session)                                              | warn            | 3      |
| `plagiarism_match` (Dolos similarity &gt; 0.8 with another submission in this contest) | flag            | 15     |
| `plagiarism_match` (Dolos similarity 0.6–0.8)                                          | warn            | 6      |
| `omega_index` (MCQ collusion p &lt; 0.001)                                             | flag            | 14     |
| `omega_index` (MCQ collusion p in [0.001, 0.01])                                       | warn            | 5      |

**Sum** the weights for all events on the attempt, capped per category (a candidate who blurs 50 times should not score higher than one who phones a friend — we cap each category at 30). The result is `suspicionScore`. The cap formula and per-category limits live in `apps/async-worker/forensics/scorer.ts`.

> **⚠️ Counsel review required before launch:** the weight assignment must be reviewed at launch and quarterly thereafter for demographic parity. If a single category disproportionately flags candidates from any protected group, the weight is reduced or the signal is dropped.

---

## 4. Bucketing and routing

Once a suspicion score is computed for an attempt:

| Bucket     | Range | Action                                                                                      | Where it goes                                       |
| ---------- | ----- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Green**  | 0–20  | No action. The attempt is marked `reviewStatus = clean` automatically.                      | Candidate sees their score. No reviewer touches it. |
| **Yellow** | 21–50 | Queued for review with standard SLA (5 business days).                                      | Reviewer queue, sorted by submission time, FIFO.    |
| **Red**    | 51+   | Queued for priority review (24h SLA). Candidate's score is **not** released until reviewed. | Priority reviewer queue, sorted by suspicion DESC.  |

**No bucket auto-fails.** Even Red attempts wait for human adjudication. This is enforced both by policy and by the fact that the suspicion-score writer has no permission to mutate `reviewStatus` away from `pending` except into the auto-clean state for Green.

The candidate is told the score is being verified, with an ETA, the moment the attempt is submitted. They are not told "your attempt is flagged for cheating" — only "your attempt is undergoing integrity verification". The distinction matters; the former is an accusation, the latter is a process.

### 4.1 What if scores are urgently needed (TCS NQT-style)

For high-volume hiring assessments where the sponsor needs scores within hours, we have a `fast-track` mode: Yellow attempts get released with a "subject to verification" tag, and verification proceeds in the background. If verification later invalidates the score, the sponsor is notified within 48 hours and the candidate goes through the appeal flow. This mode is opt-in by the sponsor and requires their countersignature on the policy.

---

## 5. Reviewer workflow (SOP)

The reviewer dashboard (`apps/admin/review/`) — call it the **Adjudication Console** — is the primary tool. The standard operating procedure for every flagged attempt:

1. **Open the attempt.** The console shows: candidate ID (not name unless escalated), test name, suspicion score, breakdown by event type, and the synchronised timeline.
2. **Read the breakdown.** The top of the page lists the events that contributed most to the score. Reviewer hovers over each to see the timestamp, the raw payload, and a "jump to evidence" button.
3. **Watch the flagged clips.** For each high-weight event with a media component (multi-face, phone, voice, large paste during a tab switch), the system has pre-extracted a 20-second clip centred on the event timestamp. Watch each clip. Take notes in the structured notes field.
4. **Check similarity matches.** If the attempt has plagiarism matches (code or MCQ), the side-by-side view shows the matching submissions. The reviewer compares the matched fragments and decides whether the match is real or a coincidence (common patterns, identical correct solution to a trivial problem, etc.).
5. **Cross-check identity.** For high-stakes attempts, the reviewer compares the live webcam frames to the ID + selfie taken during identity verification. Note any visible discrepancy (different person, different room, suspicious staging).
6. **Decide.** The decision form presents four options:
   - **No concern.** All flags are reviewer-explainable; reviewer documents why.
   - **Minor concern, score stands.** Some signals are concerning but not enough to invalidate; reviewer documents and flags the candidate's profile for closer review on future attempts.
   - **Requires re-assessment.** Candidate is offered (free) re-take in a stricter environment; no penalty.
   - **Disqualify with appeal.** The attempt is invalidated; the candidate is emailed the appeal package automatically (see §7).
7. **Document the reasoning.** Free-text notes are mandatory. Boilerplate ("looks suspicious") is rejected by a regex on the form. The notes are quoted verbatim in the appeal package.
8. **Submit.** The decision is written to `AuditLog` with the reviewer's ID, timestamp, and notes. The candidate is notified by email.

The reviewer assignment policy is designed to spread bias risk: reviewers are assigned from a demographically diverse pool, and no reviewer adjudicates more than 30 attempts from the same institution per week. The roster is rotated quarterly.

### 5.1 Calibration sessions

Every reviewer participates in monthly calibration sessions: a set of 10 anonymised "golden-set" attempts with known ground truth (some confirmed-cheating, some confirmed-clean) is shown, and reviewer decisions are compared against the ground truth and against each other. Inter-rater reliability is tracked using Cohen's kappa. A kappa below 0.6 on the golden set triggers retraining.

---

## 6. False-positive handling and weight tuning

When a reviewer marks **No concern** on a high-suspicion attempt, the system records it. We then look quarterly at which event types are over-represented in the "high suspicion but no concern after review" bucket — those are our false-positive generators.

The process, in pseudocode:

```text
For each event_type:
  reviewed_attempts = all flagged attempts containing event_type
  fp_rate = (no-concern decisions) / (total decisions)
  if fp_rate > 0.4:
    propose weight reduction in next quarter's review
  if fp_rate > 0.6:
    propose dropping the event_type entirely
```

The proposal goes to a working group (Trust &amp; Safety engineering + reviewer team lead + DPO). Changes are documented in `docs/RUNBOOKS/anti-cheat-weight-changes.md` (file will be created on the first change) and shipped via a config bump, not a code change.

We also track **demographic parity of flag rates**: the rate of "any flag" by self-declared candidate country, gender, and age group. Any disparity greater than 1.5× the baseline triggers a deep-dive. This is a hard metric, owned by the Trust &amp; Safety lead, reported to leadership quarterly.

---

## 7. Plagiarism stack

Three tools running at three cadences:

### 7.1 Dolos — live mid-contest

- Runs continuously during a contest, comparing every accepted/rejected submission against every other submission for the same problem.
- Outputs similarity scores; the top N matches per submission land in `PlagiarismMatch` rows.
- Used by reviewers during the contest to spot mass collusion early.
- Path: `apps/async-worker/plagiarism/dolos.ts`. Self-hosted Dolos service on a dedicated host because it loads ASTs for the whole contest in memory.
- We do not show live similarity to the candidate, contest authors, or sponsors during the contest.

### 7.2 JPlag — post-contest batch

- Runs once at contest finalisation. Pairwise across all submissions for each problem.
- More thorough than Dolos: token-string matching, AST overlap, with the obfuscation-resilient extensions per JPlag's 2024 paper (research §1 link).
- Outputs ranked match lists; high-similarity pairs are queued for reviewer attention.
- Path: `apps/async-worker/plagiarism/jplag.ts`. Triggered by the contest state machine on `ENDED → FINALIZED` transition.

### 7.3 AST-hash index — global, continuous

- For every submission, we compute a normalised AST hash (Tree-sitter → identifier scrubbing → sha256 of the canonical form), store in Postgres.
- New submissions are matched against the historical hash index — catches submissions copied verbatim from past contests or public solution archives.
- Path: `apps/async-worker/plagiarism/ast-hash.ts`. Index lives in the `Submission` table with a Postgres `pg_trgm` GIN index for fuzzy search.

### 7.4 ω-Index (Wollack) — MCQ collusion

- Statistical test for MCQ answer-pattern collusion. Tests whether two candidates' wrong-answer patterns are too similar to be explained by chance.
- Computed post-test, in batch, across all attempts of the same test.
- Outputs p-values; pairs with p &lt; 0.01 enter the review queue, p &lt; 0.001 enters as a flag-level signal.
- Path: `apps/async-worker/plagiarism/omega-index.ts`. Reference: Wollack 2003 (research §6).

### 7.5 Sentence-transformer similarity — descriptive answers

- For descriptive (free-text) answers, we embed answers using `all-MiniLM-L6-v2` (open-source).
- Pairwise cosine similarity computed in batch; pairs &gt; 0.95 surfaced for review.
- Path: `apps/async-worker/plagiarism/descriptive.ts`.
- Note: we do **not** use this against external corpora (the internet, LLM output databases) — only against other candidates' submissions in our system.

---

## 8. What we DON'T do, with reasoning

- **No GPT / AI-text detector classifiers.** They produce high false-positive rates, especially for non-native English speakers — see published evaluations of GPTZero, Turnitin AI Detector, and OpenAI's own retired classifier. We do not ship them. Cadence analysis is our partial substitute and is always paired with human review.
- **No auto-fail at any suspicion score.** Hard policy. No tunable threshold. (Code path is enforced in `apps/api/src/routes/admin/review/decision.ts` — the suspicion-score writer cannot mutate `reviewStatus` to `invalidated`.)
- **No covert recording.** The LiveKit room is not created until the consent endpoint returns 200. No "warm-up" capture before the candidate hits Start. This is checked in CI by a unit test on the room-creation guard.
- **No "abnormal behaviour" scoring of neurodivergent candidates.** The "look-away accommodation" turns off the gaze flag entirely; multi-monitor signals are reduced for candidates with declared mobility-aid setups; voice-detected weight is zeroed for candidates who have declared a shared environment. See PROCTORING-POLICY.md §Accessibility.
- **No emotion / stress / mood detection.** Not in the stack. Not on the roadmap.
- **No data export to AI training corpora.** Every recording carries metadata `do_not_train: true`. The data-handling code path refuses to export to any sink not on the allowlist (`apps/async-worker/forensics/exports.ts`).
- **No detection of the candidate's race, religion, or ethnicity.** We do not classify, infer, or store any of these.
- **No silent recording extension beyond the test window.** Recording stops on test submit. Verified by an automated end-of-session log assertion in the recording pipeline.

---

## 9. Incident response

When something goes wrong — and at scale, things go wrong — we need a documented response.

### 9.1 Compromised contest (problem leak)

If a problem statement, test data, or reference solution leaks before or during a contest:

1. Incident commander (Trust &amp; Safety on-call) is paged.
2. Triage within 30 minutes: confirm leak, estimate scope (how many candidates exposed?), identify source if possible.
3. Decision tree:
   - Leak before contest start, with time to react: **swap the problem** (use a backup from the problem-setter's draft pool). Notify contest participants.
   - Leak during contest, contained: **continue**, flag the leak in post-contest analysis, expect to invalidate suspicious submissions only.
   - Leak during contest, widespread: **stop the contest**, mark `status=CANCELLED`, communicate to all participants, schedule a make-up.
4. Post-mortem within 5 business days; published internally; published externally if the leak was visible to the public.

Communication template (to candidates) lives in [docs/RUNBOOKS/contest-day.md](./RUNBOOKS/contest-day.md).

### 9.2 Mass collusion detected post-contest

If JPlag or ω-Index detects a collusion cluster &gt; 20 candidates:

1. Pause rating calculation for the affected contest (flip `Contest.status` back to `ENDED`, not `FINALIZED`).
2. Re-judge or re-rate? Decision based on cluster size and confidence:
   - Cluster &lt; 5% of participants and high confidence: invalidate the cluster, finalise rating without them.
   - Cluster 5–15% of participants: invalidate cluster, recompute rating with reduced participant base.
   - Cluster &gt; 15% of participants: declare the contest unrated; communicate to all participants.
3. Every invalidated candidate enters the standard appeal flow.

### 9.3 Reviewer integrity incident

If a reviewer is suspected of bias, abuse of access, or external collusion:

1. Their access is suspended immediately (one-click revoke in admin panel).
2. All their adjudications in the last 90 days are re-reviewed by a separate set of reviewers.
3. Any decisions they overturn from "no concern" → "invalidate" or vice versa are appeal-restored.
4. The candidate(s) affected by reversal are notified personally.

This pathway is documented because it is the worst-case failure mode of human-in-the-loop systems.

---

## 10. Metrics and KPIs

Owned by the Trust &amp; Safety lead, reported weekly in the operations review:

| Metric                                                                                                                   | Target                                            | Alerting                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------- |
| **Per-event-type false-positive rate** (no-concern decisions / total decisions, per event type)                          | &lt; 30% per type                                 | Alert if any type exceeds 50% for two consecutive weeks |
| **Time-to-review** (submission to first reviewer touch) — Yellow / Red                                                   | Yellow p95 &lt; 5 business days; Red p95 &lt; 24h | Page if Red p95 &gt; 36h                                |
| **Time-to-decision** (first touch to final decision)                                                                     | p95 &lt; 4 hours                                  | Alert if &gt; 8h                                        |
| **Appeal-overturn rate**                                                                                                 | &lt; 10% (high overturn = bad initial decisions)  | Alert if &gt; 20% for a month                           |
| **Demographic parity of flag rates** (max group flag rate / median group flag rate, by self-declared country/age/gender) | &lt; 1.5                                          | Alert if &gt; 2 for a month                             |
| **Reviewer inter-rater reliability** (Cohen's kappa on the golden set)                                                   | &gt; 0.7                                          | Alert if any reviewer &lt; 0.6                          |
| **Suspicion-score distribution drift** (population shift in scores month-over-month)                                     | &lt; 20% shift                                    | Investigate cause if &gt; 30%                           |
| **Candidate-reported complaints** (per 1000 attempts)                                                                    | &lt; 5                                            | Investigate root cause if &gt; 10                       |
| **Mean time to clean (Green)**                                                                                           | &lt; 60s (automatic)                              | Alert if &gt; 5min — indicates async-worker lag         |
| **Auto-fail attempts blocked at code-path**                                                                              | Exactly 0 (the path doesn't exist)                | Alert: the code path should not exist; CI checks for it |

Dashboards live in Grafana; alert rules in Alertmanager; the on-call rotation is in PagerDuty (or equivalent) per the C1 buildout.

---

## 11. Open questions / TODO

- Tune weights with first 10,000 production attempts. Initial values in §3 are research-derived, not data-derived.
- Decide cap formula for per-category contribution to suspicion score. Initial cap = 30 per category, total &lt;= 100.
- Decide Sympson-Hetter exposure cap for adaptive aptitude tests' interaction with proctoring (high-exposure items + paste = highly suspicious; rare items + paste = less so).
- Add Sentry tagging to every reviewer action so we can correlate decision errors with platform errors.
- Build a "review-the-reviewers" pipeline: random 5% sampling of clean and disqualify decisions, re-adjudicated by a senior reviewer, comparing.

---

## 12. References

- [MASTER_PLAN.md](../MASTER_PLAN.md) §2.5 (layered defence), §5 (non-negotiables), §7 Brief A5, A6 (anti-cheat SDK and backend), §10 (research consolidated).
- [PROCTORING-POLICY.md](./PROCTORING-POLICY.md) — what we tell candidates.
- Research §6: HackerRank Proctor Mode FAQ; Mercer Mettl proctoring; EFF on online proctoring.
- Research §7.1: suspicion-score weights table source.
- Wollack 2003: ω-Index for MCQ collusion. See [https://onlinelibrary.wiley.com/doi/10.1111/j.1745-3984.2003.tb01104.x](https://onlinelibrary.wiley.com/doi/10.1111/j.1745-3984.2003.tb01104.x).
- JPlag obfuscation-resilient extensions (Saglam et al. 2024): [https://sebastianhahner.de/publications/2024/Saglam2024_ObfuscationResilientSoftwarePlagiarismDetectionWithJPlag.pdf](https://sebastianhahner.de/publications/2024/Saglam2024_ObfuscationResilientSoftwarePlagiarismDetectionWithJPlag.pdf).
- Dolos: [https://github.com/dodona-edu/dolos](https://github.com/dodona-edu/dolos).
- India DPDP Act 2023 summary (data fiduciary obligations): [https://www.biometricupdate.com/202511/india-notifies-its-sweeping-digital-personal-data-protection-rules](https://www.biometricupdate.com/202511/india-notifies-its-sweeping-digital-personal-data-protection-rules).
- NIST FRVT (face recognition demographic effects): see public NIST FRVT reports for documented accuracy differentials.

---

## Change log

- 2026-05-19 — Initial draft. Weights from research §7.1 verbatim. Pending production data for tuning.
