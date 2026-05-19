# CodeForge Proctoring Policy

**Last updated:** 2026-05-19
**Owner:** CodeForge Trust &amp; Safety
**Audience:** Candidates taking proctored assessments on CodeForge

> **⚠️ Counsel review required before launch:** the placeholders for the Data Protection Officer email (`dpo@codeforge.example`), the integrity team email (`integrity@codeforge.example`), the legal entity name, the registered address, and the data-fiduciary registration number must be replaced with real values, and the whole text must be reviewed by qualified counsel in India (for DPDP) and the EU (for GDPR) before any user is asked to consent to it.

---

## What this is

This page explains, in plain English, what happens when you take a proctored test on CodeForge. A proctored test is one where we use your webcam, microphone, screen recording, or browser activity to confirm you are taking the test fairly and on your own. We wrote this so that you can decide, with the full picture, whether you want to take a proctored test. If anything here is unclear, write to us before you start.

You will see a shorter version of this notice on the screen right before any proctored test, with a "I have read the full policy" link that points here. You can also revisit this page any time from your account settings.

---

## What we record, when, and for how long

We do not record anything until you have ticked the consent box and the test has actually started. We stop recording when you submit the test or when the test window closes — whichever happens first. Nothing is captured outside that window.

The table below is the complete list of what we capture. We do not capture anything that is not on this list. If we add a new signal in the future, we will update this page and notify you 30 days before the change takes effect.

| What                                                                                                                                                                                   | When capture starts                                               | When capture stops                         | Where it is stored                                                   | How long we keep it                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Webcam video (continuous, low bitrate)                                                                                                                                                 | When the test session begins, after you click "Start"             | When you submit, or the timer reaches zero | Encrypted object storage in India (region: ap-south-1 or equivalent) | 90 days for a clean attempt; 365 days if your attempt is flagged for human review |
| Webcam still photos (one frame every ~30 seconds)                                                                                                                                      | Same as video                                                     | Same as video                              | Same                                                                 | Same                                                                              |
| Microphone audio                                                                                                                                                                       | Same as video, if the test requires it                            | Same                                       | Same                                                                 | Same                                                                              |
| Screen recording (your full screen, at low frame rate)                                                                                                                                 | Same as video, if the test requires it                            | Same                                       | Same                                                                 | Same                                                                              |
| Browser activity events — tab focus, fullscreen exit, paste, keyboard shortcuts like Ctrl+C / Ctrl+Tab / F12, copy attempts                                                            | When the test runner loads                                        | When the test ends                         | Event log database in India                                          | 90 days; 365 days if flagged                                                      |
| Device fingerprint — a hash derived from your browser, OS, time zone, screen size, GPU vendor                                                                                          | Once at the start, and refreshed every 60 seconds during the test | Test end                                   | Same                                                                 | Same                                                                              |
| System-check artifacts — speed test result, browser version, monitor count, webcam preview frame for setup                                                                             | Two minutes before test start, during the system check            | Once the check passes                      | Same                                                                 | 7 days, then deleted regardless of test outcome                                   |
| ID photo and live selfie (only for high-stakes tests where you have explicitly agreed)                                                                                                 | During pre-test identity verification                             | After the verification step                | Same, with a stricter access control list                            | 365 days, then deleted                                                            |
| Keystroke timing — the gap between key presses, used to spot copy-paste behaviour. We do **not** log the actual keys you press for the prose / descriptive answers (only the timings). | Test start                                                        | Test end                                   | Same                                                                 | 90 days; 365 days if flagged                                                      |

After the retention period expires, the data is cryptographically deleted — meaning the encryption keys are destroyed first, then the underlying objects are purged from primary storage, replicas, and backups, with the deletion verified by an automated job. We hold an internal audit log of these deletions for our own compliance records.

---

## Why we record it

We record this data for one reason only: to confirm that the score on your test reflects your work, and not someone else's. That single purpose is what lawyers call "purpose limitation" — we do not use the data for anything else.

Concretely:

- We use webcam, mic and screen recordings to give a trained reviewer enough evidence to decide whether your attempt was fair, in cases where automated signals raised a concern.
- We use browser activity events to spot patterns that very strongly correlate with cheating (for example, a 800-character paste appearing in an answer box one second after a tab switch).
- We use device fingerprint to detect when a single person attempts the same test from multiple machines, or when one machine is being used by multiple identities — both being patterns associated with paid impersonation.

### Legal basis

We rely on two legal grounds, depending on where you live:

- **India (Digital Personal Data Protection Act 2023):** your explicit consent, captured at the start of the test, as required for processing personal data under Section 6. Biometric processing (face, voice) requires the heightened consent we obtain via the proctoring consent screen.
- **EU / EEA / UK (GDPR):** Article 6(1)(a) consent for general personal data, and Article 9(2)(a) explicit consent for special-category data (biometric data identifying a natural person). The recordings are not used for automated decisions producing legal effects (we do not auto-fail — see below), so Article 22 is not engaged.

If we ever change our lawful basis — for instance, if a future enterprise feature relies on contract instead of consent — we will tell you before you start that test, and you will have the option to decline.

---

## Who can see your footage

Access to your recordings is locked down to named roles. The full list:

- **You.** You can request a copy of your own recordings at any time within the retention window. We will return them to you within 30 days of the request.
- **Trained academic-integrity reviewers.** These are CodeForge employees who have completed our reviewer-training programme. They see footage only when an attempt is queued for review. Every time they open your footage, the access is logged with their user ID, the timestamp, and the reason.
- **Legal and security incident response.** If we are required by a court order, a regulatory authority, or a verified security incident (for example, you tell us your account was compromised), our legal team and incident response engineers may access the relevant data. These accesses are also logged.

The list ends here. The following people **do not** have access:

- Engineers building features. Production data is not visible from development environments.
- Marketing, growth, or sales teams.
- Any third-party advertising or analytics service. We do not export proctoring data to Google Analytics, Mixpanel, Segment, or similar tools.
- Any AI model trainer, internal or external. We never use proctoring data to train classifiers or large models.

If you are taking a test sponsored or commissioned by a third party (a company running a hiring test, a college running a placement test), they receive your **score** and, if their plan allows it, your **proctoring report** (a summary of the suspicion signals, not the raw footage). They do not receive the raw video, audio, or screen recording unless you separately consent or there is a specific legal request. Even then, raw footage is shared only via a signed link valid for 14 days.

---

## What we do NOT do

- We do not auto-fail you. A flag from our system is never the final word. Every flagged attempt is reviewed by a human reviewer, and you are notified before any score is invalidated. This is a hard policy rule. There is no setting any customer or sponsor can switch on to make our system auto-fail candidates.
- We do not sell, share, license, or rent your recordings.
- We do not train AI models — ours or anyone else's — on your footage.
- We do not record outside the test session window. We do not have a "background" mode that listens in.
- We do not analyse your facial expression, mood, emotion, or "stress level". We measure gaze direction and head pose for the specific narrow purpose of detecting whether you are looking off-screen during a test. We are not building a profile of you.
- We do not perform IQ inference, personality profiling, or any psychometric analysis from your biometrics.
- We do not detect "abnormal" behaviour against neurotypical baselines. See the Accommodations section.
- We do not de-anonymise you for marketing.

---

## Your rights

Under the Indian DPDP Act (Section 12 right to access, Section 13 right to correction and erasure, Section 14 right of grievance redressal) and under GDPR (Articles 15–22), you have the right to:

- **Access** — get a copy of everything we have recorded about you in a portable format.
- **Correct** — fix any inaccurate information (for example, the name on your account).
- **Port** — receive your data in a structured, machine-readable form, and ask us to transmit it directly to another service (where feasible).
- **Erase** — ask us to delete your data, including footage that is still in the retention window.
- **Withdraw consent** — withdraw the consent you gave when you started a test. Withdrawal does not undo the recording that has already happened, but it stops any further processing and triggers deletion within 30 days.
- **Object** — object to processing for purposes other than the one we collected the data for.
- **Lodge a complaint** — with the Data Protection Board of India (DPDP), the relevant EU supervisory authority, or the UK ICO.

To exercise any of these, email our Data Protection Officer at `dpo@codeforge.example` (placeholder — the real address will be posted here before launch). We will acknowledge your request within 72 hours and complete it within 30 days. If we need longer, we will tell you why and give you a revised date. Deletion is verified end-to-end: primary database, replicas, object storage, and backups. We retain a record of the fact of the deletion (not the deleted content) for our own compliance audit.

---

## What happens if you don't consent

You can decline the proctoring consent. If you do, the proctored test will not start, and you can:

- Take a non-proctored practice version of the same content, which is not used for any official score or report.
- Request a **centre-based alternative** — a supervised in-person test at one of our examination centres, with no webcam/screen recording. This option is available where centres exist; we will tell you the nearest location. If a centre alternative is required by an employer or institution and we cannot offer one in your region, we will tell you up-front so you can decide whether to continue with the application by other means.
- Request a **proctor-light** alternative, if the sponsor allows it — this disables webcam and microphone but keeps browser activity logging.

We will not penalise you in our own systems for declining. A third-party sponsor (a college, an employer) may have their own policy about whether a non-proctored result is acceptable; that is their decision, not ours.

---

## Accessibility and accommodations

We know that one-size-fits-all proctoring is unfair to people whose normal behaviour does not match the assumptions baked into anti-cheat systems. If you need an accommodation, you can request it before the test starts. We grant the following without medical documentation:

- **Look-away accommodation.** Some neurodivergent candidates (and many others) think better when looking away from the screen. We will disable the gaze-direction flag for your attempt; the human reviewer will be told to ignore gaze data in your case.
- **Screen reader compatibility.** Our test runner supports NVDA, JAWS, and VoiceOver. Proctoring does not block or interfere with screen-reader operation. If we need to disable any specific signal that interferes with your assistive technology, ask.
- **Extended time.** If you have an existing extended-time accommodation from your school, college, or employer, you can submit it once to your CodeForge profile and we will apply it to every test you take.
- **Quiet environment difficulties.** If you cannot guarantee a quiet room (you live in a shared space, you have a baby, you live with caregivers), we can disable the "background voice detected" signal. The webcam and screen capture continue.
- **Mobility aids and assistive devices.** Visible assistive devices (Braille displays, sip-and-puff controllers, alternative keyboards) will not be flagged.
- **Religious or cultural attire.** Headscarves, head coverings, or other religious clothing are not in themselves grounds for any flag. If our identity-verification step rejects your photo (which can happen), retry once or contact support — we will not lock you out for this.

To request an accommodation, email `dpo@codeforge.example` at least 48 hours before your test. For recurring accommodations, tick the relevant boxes in your account settings under "Accessibility".

---

## Known bias and limitations

We are committed to being honest about what our system gets wrong.

- **Face detection.** Open-source face-detection models — including the ones we use (Google MediaPipe Face Landmarker) — have measured accuracy differences by skin tone, ambient lighting, and facial features. Studies (including the NIST Face Recognition Vendor Test) consistently show higher false-non-detection rates for darker skin tones in low light. We mitigate this by (a) requiring a well-lit setup at the system-check stage, (b) **never** auto-flagging or auto-failing on "no face detected" alone, and (c) sending every such case to a human reviewer with cross-demographic training.
- **Gaze tracking** is approximate. It cannot distinguish "thinking with eyes closed" from "looking at notes". We use it only as one signal among many, never as the sole basis for a decision.
- **Voice / talking detection** cannot tell a person reading a question aloud (a common comprehension technique) from a person reading a question to an outside helper. Reviewers are trained to listen to the audio rather than rely on the binary "voice detected" flag.
- **Multiple-monitor detection** can have false positives on machines with HDMI displays that the OS reports as extended even when nothing is connected. We treat this as a low-severity signal.
- **Browser-fingerprinting** can change for legitimate reasons (browser update, switching networks). We do not auto-flag fingerprint drift; we use it as context.

If you are in a group disproportionately affected by any of these limitations, please know that we have deliberately built our review process so that automated signals alone cannot harm you. Every consequential decision passes through a trained human, with the option for you to appeal.

---

## Appeals

If your attempt is flagged or invalidated, you can appeal within 30 days. The process:

1. You receive an email at the address on your account with the reason for the action and a link to an evidence pack.
2. The evidence pack shows you the timeline of flagged events, the reviewer's notes, and the recording clips that were used to make the decision. You can download these.
3. You reply to the email with your rebuttal — in writing, in audio, or in a video, at your option.
4. A second reviewer, independent of the first, looks at the evidence pack and your rebuttal, and either upholds, modifies, or reverses the decision.
5. The outcome is sent to you within 14 days of your appeal submission.

You can also escalate to a third stage where two senior reviewers and a compliance officer adjudicate as a panel. That outcome is final from CodeForge's side; you retain the right to complain to the Data Protection Board of India or your local data protection authority regardless.

---

## Data security

- Recordings and event logs are encrypted **in transit** using TLS 1.3.
- Recordings are encrypted **at rest** using AES-256, with per-tenant key separation. We do not have a single master key for all customer data.
- Every access to your footage is logged in a tamper-evident audit log. You can request a copy of the access log for your data.
- Our infrastructure is hosted in India (ap-south-1 region) for Indian candidates by default. EU candidates' data stays in the EU region. We do not transfer data across regions without your separate consent and an appropriate legal mechanism (Standard Contractual Clauses for GDPR).
- We run regular third-party security tests on our platform and publish the executive summary of those reports at `https://codeforge.example/security` (link will go live at launch).
- We maintain a security disclosure programme; if you find a vulnerability that affects your data or any other candidate's data, please report it to `security@codeforge.example` and we will respond within 72 hours.

---

## Changes to this policy

We may update this policy from time to time. Any material change — for example, adding a new signal, changing retention periods, extending who can access your data — will be communicated to you by email at least **30 days** in advance, and a banner will appear in your account. You will have the option to withdraw consent before the change takes effect.

Minor edits (typo fixes, clarifying language) are listed in the change log at the bottom of this page without a 30-day notice.

---

## Contact and Data Protection Officer

> **⚠️ Counsel review required before launch:** the addresses and registered company details below are placeholders.

- **Data Protection Officer:** `dpo@codeforge.example`
- **Trust &amp; Safety / Integrity team:** `integrity@codeforge.example`
- **Security disclosure:** `security@codeforge.example`
- **General support:** `support@codeforge.example`
- **Postal address:** \[Registered office address, India\]
- **Data Fiduciary registration number:** \[To be populated post-DPDP registration\]
- **Grievance Officer (India):** \[Name, contact\]
- **EU Representative (if appointed):** \[Name, contact\]

---

## Change log

- 2026-05-19 — Initial draft of policy. Placeholder contacts. Pending counsel review.
