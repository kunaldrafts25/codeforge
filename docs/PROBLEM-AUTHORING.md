# Problem Authoring Guide

**Last updated:** 2026-05-19
**Owner:** CodeForge Arena Editorial Board
**Audience:** Problem setters preparing their first (or fiftieth) problem for the CodeForge Arena

Welcome. This guide will walk you through authoring a problem on CodeForge — from the blank page to the moment a candidate sees your problem on the live site. By the time you reach the bottom of this document you should be able to ship your first problem unaided, and revise it cleanly when a reviewer comes back with notes.

If you have authored problems on Codeforces' Polygon, AtCoder Writers, or Kattis before, you will find the workflow familiar. If you have only ever solved problems, that is fine too — we will walk through every step.

Cross-reference: the authoring tool itself is built per [MASTER_PLAN.md](../MASTER_PLAN.md) §7 Brief A3 (the "Polygon-light" admin tool). Concepts are aligned with the Codeforces Polygon design — the canonical reference for serious competitive-programming problem authoring.

---

## 1. What makes a good problem

Before opening the wizard, sit with these principles. We will reject — politely — problems that violate any of them, even if the implementation is clever.

- **The statement is unambiguous.** A solver should never have to guess what is asked. If "the answer is the smallest", say "the smallest"; if it ties, say which one. State input ranges in precise terms ("1 ≤ n ≤ 10^5"), say what each variable is, and define every term used. The most common review rejection is "the problem statement is ambiguous in case X".
- **The I/O format is precise.** Specify whether numbers on one line are space-separated or newline-separated. Specify whether trailing whitespace matters (it should not — your checker should be lenient on trailing whitespace by default). Specify whether output ends with a newline (it should).
- **Sample tests illustrate the intent.** Two or three samples, covering the typical case and at least one edge case the statement hints at. Each sample should have an explanation when the answer is non-obvious.
- **Hidden tests are adversarial.** Hidden tests should kill solutions that are correct on the samples but wrong in general. They should hit the constraint upper bounds, the corner of the input space, and the easy traps (all-zero input, n=1, n=max, all-same-value, sorted, reverse-sorted, single-character strings, empty strings if allowed).
- **Time and memory limits separate the intended complexity from one notch worse.** If the intended solution is O(n log n) at n = 10^6, your TL should be tight enough that an O(n²) solution times out — but not so tight that a correct O(n log n) solution in a slow language (Python, Java) cannot squeak in. The standard CodeForge multipliers are: Python 3×, Java 2×, JavaScript 2×, Rust/Go/C++/C 1×. You can override per-language if you have a specific reason.
- **The problem has a clean idea at its core.** Implementation grind is fine in moderation, but a problem whose only difficulty is bookkeeping rarely makes a good problem. We prefer problems where the insight, not the typing speed, distinguishes the solver.

If you are unsure whether a problem is worth authoring, write the statement and have a friend solve it. If they can do it in 20 minutes and still find it satisfying, it is worth authoring. If they get bored, set it aside.

---

## 2. The nine-step authoring wizard

Open `apps/admin/problems/new` after logging in with a `PROBLEM_SETTER` role. (If you do not have the role, request it from the moderator team via the Admin → Roles request page; this is a one-time approval.) The wizard has nine steps. You can save progress at any step and return.

### Step 1 — Metadata

The bookkeeping page. Fill in:

- **Title.** Keep it short and descriptive ("Painting Wall", "Two Sum", "Tree Diameter"). Avoid clever titles that hint at the solution.
- **Slug.** Auto-generated from the title; you can override. Stays in the URL forever — choose carefully.
- **Difficulty band.** `easy`, `medium`, or `hard`. This is your honest guess; the real rating gets refined post-publish (see §9).
- **Rating estimate.** A number between 800 and 3500. As a calibration: 800 is a typical easy problem solvable by a beginner in 15 minutes; 1500 is mid-tier and the platform's default; 2400+ is a problem you would see at ICPC regionals.
- **Tags.** Pick from the controlled vocabulary (see §10). Don't invent new tags — request them via the moderator channel.
- **Judge mode.** `STDIO` (Codeforces-style — read from stdin, write to stdout) or `FUNCTIONAL` (LeetCode-style — implement a function with a typed signature). The difference is whether the solver writes a `main` function or just a method body. Pick based on the problem; STDIO is more flexible for contest-style problems, FUNCTIONAL is more accessible for interview-prep problems.
- **Scoring mode.** `BINARY` (full marks or zero), `ICPC_PENALTY` (binary + penalty for wrong attempts in contests), `ATCODER_POINTS` (configurable points, no penalty), `IOI_SUBTASK` (additive points across subtasks). Default `BINARY` unless you have a reason.
- **Time limit (ms).** Per language is configurable, but set a base time limit. 1000 ms for most problems; 2000 ms for problems with heavy I/O or constant factors.
- **Memory limit (KB).** Default 262144 (256 MB). Increase only with reason.
- **Allowed languages.** Leave empty for "all". Restrict only if the problem requires (rare).

### Step 2 — Statement

A markdown editor with live preview, KaTeX support for math, and image upload. Sections:

- **Statement.** The problem itself. Plain English, short paragraphs.
- **Input format.** Exactly what stdin will contain. Use `$n$` for variables, list each line.
- **Output format.** Exactly what stdout should contain.
- **Constraints.** Tight bounds on every input variable. Use inequalities with $\leq$ for clarity.
- **Notes.** Optional — anything that doesn't fit the above (clarifications, history, credits).

**Sample tests.** Add 2–3 samples here. For each:

- Input (raw, as it would appear on stdin).
- Expected output.
- Explanation (markdown) — why this output is correct.

Samples are stored separately from hidden tests; they appear in the candidate's view as runnable examples.

### Step 3 — Function signature (FUNCTIONAL mode only)

If you chose `FUNCTIONAL` in Step 1, you will see a visual builder for the signature DSL. Reference: `packages/shared/function-sig/` types.

Define:

- **Function name.** What the candidate's method will be called. Convention: `camelCase`. Example: `twoSum`.
- **Parameters.** List of `{name, type}`. Types are: `int`, `long`, `double`, `bool`, `string`, `char`, `list<T>`, `list<list<T>>` for nested, `ListNode` for singly linked list, `TreeNode` for binary tree, `GraphNode` for a graph node (adjacency list with cycles).
- **Return type.** Same type vocabulary.

The system will auto-generate starter code in every supported language. You can edit the auto-generated starter code in Step 7.

### Step 4 — Tests

This is where most of the work lives. Two options:

**Option A: Bulk upload.** Upload a `.zip` in Kattis problem package format. The tool extracts `data/sample/*.in/.ans` and `data/secret/*.in/.ans`, validates each against your validator (see Step 4b), and creates `ProblemTest` rows. The system handles content-addressed storage in S3, deduplication, and versioning.

**Option B: Manual entry.** For each test:

- **Input blob.** The raw stdin (or, for FUNCTIONAL mode, a JSON object matching the signature params).
- **Expected output blob.** The raw expected stdout (or canonical JSON of the return type for FUNCTIONAL mode).
- **Is sample?** If true, the test appears in the candidate's view; if false, it is hidden.
- **Subtask.** If you are using `IOI_SUBTASK` scoring, assign each test to a subtask.

**Step 4b — Validator.** A validator is a small program (in C++ using testlib, or Python using equivalent) that reads stdin and asserts the input is well-formed within constraints. Example pseudo-code:

```cpp
// validator.cpp
#include "testlib.h"
int main(int argc, char* argv[]) {
    registerValidation(argc, argv);
    int n = inf.readInt(1, 100000, "n");
    inf.readSpace();
    int q = inf.readInt(1, 100000, "q");
    inf.readEoln();
    for (int i = 0; i < n; i++) {
        inf.readInt(1, 1000000000, "a_i");
        if (i + 1 < n) inf.readSpace();
    }
    inf.readEoln();
    inf.readEof();
    return 0;
}
```

The validator must accept every test you upload. If it rejects, the wizard tells you which test and which line. This prevents the embarrassing class of bugs where a test fails to match the statement's constraints.

### Step 5 — Checker

The checker compares the solver's output against the expected output. Most problems use one of the built-in checkers:

- **`exact`** — byte-exact match. Use when the answer is a single line and there is no ambiguity.
- **`token`** — whitespace-insensitive token comparison. The default. Use unless you have a specific reason not to.
- **`line`** — line-by-line comparison, ignoring trailing whitespace per line.
- **`float_eps`** — float comparison with an epsilon you set (absolute or relative). Use for problems with non-integer answers. Set epsilon &lt;= 10^-6 by default.
- **`case_insensitive`** — token comparison ignoring case. Use for problems whose answer is "YES/NO" or similar.
- **`array_set`** (FUNCTIONAL mode only) — array comparison ignoring order. Use when the problem says "return any valid permutation" or "return the elements in any order".

**Custom checker (special judge / SPJ).** If none of the built-ins fit, write a custom checker in testlib style. The skeleton:

```cpp
// checker.cpp
#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    int n = inf.readInt(); // input
    int expected = ans.readInt(); // jury answer
    int got = ouf.readInt(); // user answer
    if (got == expected) quitf(_ok, "correct");
    if (got > expected) quitf(_wa, "user output %d > expected %d", got, expected);
    quitf(_wa, "user output %d < expected %d", got, expected);
}
```

testlib's verdicts:

- `quitf(_ok, "...")` — ACCEPTED.
- `quitf(_wa, "...")` — WRONG_ANSWER.
- `quitf(_pe, "...")` — PRESENTATION_ERROR (rarely used; we recommend folding into WA).
- `quitf(_fail, "...")` — JUDGE_FAILURE (your checker thinks it found a bug in itself; do not use as a verdict).
- `quitf(_points, score, "...")` — for partial scoring.

The pattern for "any valid answer" problems: read the user's answer, verify it is **a** valid answer (not necessarily the same as the jury's), and quit OK if so.

### Step 6 — Reference solutions

You must upload at least one **jury** solution: a correct, efficient implementation in any supported language. Mark it `isJury = true`. The system runs this against every test and confirms it produces the expected output for every one. If your jury disagrees with the expected output anywhere, you have a bug in either the jury or the tests; the wizard tells you which one.

Optionally, upload a **brute** solution: a correct but slow implementation (typically O(n³) or worse) that you trust to be right on small inputs but cannot handle full constraints. The brute is used for stress testing (Step 6b).

You can upload multiple solutions per role (e.g., a C++ jury and a Python jury); the wizard verifies they agree on every test.

**Step 6b — Stress testing.** Upload a generator (testlib-style) and click "Stress test". The system:

1. Runs the generator N times (default 1000) with seeds 1..N, producing random inputs of bounded size.
2. Runs the jury on each.
3. Runs the brute on each.
4. Diffs the outputs.
5. Reports any disagreement, with the input that caused it.

If the jury and the brute disagree, one of them has a bug. Almost always it is the brute (because they are easy to write quickly and easy to get wrong); occasionally it is the jury, which is the real point of stress testing. Catch this before you publish, never after.

### Step 7 — Starter code

For STDIO problems, this is optional — the system provides a no-op starter for each language. Edit if you want to provide scaffolding (e.g., a function the candidate fills in).

For FUNCTIONAL problems, the starter is auto-generated from the function signature in Step 3. You can edit it — for instance, to add a helpful comment about the input format or to provide a partial implementation.

### Step 8 — Editorial and hints

- **Editorial.** A markdown write-up of the intended solution. Include the idea, a sketch of the proof of correctness, a complexity analysis, and (optionally) an alternative approach. The editorial is locked until a candidate solves the problem (or clicks "I give up" on the candidate side, which is logged as a non-AC attempt).
- **Hints.** Five progressive hints. The candidate sees them one at a time, in order, with a soft warning before each ("are you sure you want hint 2?"). Design each hint to be useful on its own:
  - Hint 1: a gentle push toward the kind of problem this is. ("Think about the structure of the input.")
  - Hint 2: a stronger nudge. ("What invariant is preserved as you iterate?")
  - Hint 3: the central idea, without the implementation. ("This is a sliding-window problem.")
  - Hint 4: the implementation outline.
  - Hint 5: pseudocode for the solution.

A candidate who needs hint 5 has effectively read the editorial; that's fine.

### Step 9 — Review and submit

The wizard renders the full candidate view. You see exactly what the candidate will see. Check it. Click "Submit for review". The problem moves from `DRAFT` to `IN_REVIEW`. A reviewer will pick it up from the queue.

You cannot review your own problem; you cannot publish a problem you authored. This is enforced by RBAC.

---

## 3. Test-case design (the part that matters most)

A problem is its tests. A clever statement with weak tests is a worse problem than a boring statement with strong tests.

### 3.1 Sample tests

Two or three. The first one is the "obvious" case. The second illustrates an edge of behaviour (a tie, a degenerate case, a non-trivial transformation). The third (optional) covers another less-obvious case. Every sample needs an explanation.

### 3.2 Hidden tests

Aim for 20–40 hidden tests per problem. Distribute them across:

- **Tiny tests** (5–8): n = 1, n = 2, n = small. Catches off-by-one and base-case bugs.
- **Edge structure** (5–8): all-zero, all-same, sorted-ascending, sorted-descending, strictly-increasing, all-distinct, all-duplicate. Catches solutions that assume some property of the input.
- **Random middle** (10–15): generated by your generator at random sizes from medium to large. Catches algorithmic bugs.
- **Maximum** (3–5): n at the upper constraint, with adversarial structure for the intended algorithm. Catches TL violations and overflow.
- **Tricky** (2–4): bespoke tests designed to kill specific wrong approaches. Examples: a test that breaks a greedy that looks right; a test where two ties produce different answers depending on the tie-breaking rule.

If you are unsure whether your tests are strong, ask: "What is the simplest wrong solution that solves the samples? Do my tests kill it?"

### 3.3 Subtasks (IOI-style)

If you set `scoringMode = IOI_SUBTASK`, you can group tests into subtasks. Each subtask:

- Has a point value (e.g., 20, 30, 50).
- Has a constraint sub-range (e.g., "n ≤ 100 for subtask 1, n ≤ 10000 for subtask 2, full constraints for subtask 3").
- May depend on previous subtasks (so a solution that fails subtask 1 cannot score subtask 2).

Subtasks let you reward partial solutions, which is the right structure for educational problems and for olympiad-style contests. The default aggregation per subtask is `min` (worst-case across tests in the subtask); `sum` is available for additive scoring.

### 3.4 Relationship to the validator

Every test must pass the validator. The wizard enforces this. If a test fails the validator, either the test is malformed (most common) or your validator is too strict (less common; fix the validator). Never disable the validator to ship a problem.

---

## 4. Reference solutions: jury vs brute

The **jury** is the canonical correct, efficient solution. It is what the problem expects of solvers at full constraints. Write it clearly; the editorial will reference it.

The **brute** is a deliberately slow, obviously correct solution, often a direct translation of the problem statement into code. It is used:

- **For stress testing** against the jury.
- **As a sanity check** that the problem statement is implementable at all.
- **As an alternative explanation** in the editorial (sometimes "the dumb solution" is the most instructive).

Write at least one of each for any non-trivial problem. Stress testing is the single best tool you have for catching jury bugs before publish; we have rejected problems where the jury was wrong and the bug only surfaced after a candidate noticed.

---

## 5. Stress testing

The "Stress test" button on Step 6 of the wizard runs the following pipeline:

1. Reads your generator. The generator takes a seed (and optionally other parameters) and prints a valid input to stdout.
2. For seed = 1, 2, ..., N:
   - Run generator → input.
   - Run validator on input. Reject and report if invalid.
   - Run jury(input) → out_jury.
   - Run brute(input) → out_brute.
   - Run checker(input, out_jury, out_brute). If the checker says WA on the brute (or vice versa, depending on which you pass as "expected"), report the seed.
3. Report any divergence with the seed and the input.

**What this catches:** jury bugs you would not have noticed otherwise; weak tests that miss a class of inputs; generator bugs.

**What this does not catch:** edge cases your generator doesn't produce. If your generator only produces sorted inputs, stress testing will never tell you the problem behaves wrongly on reverse-sorted inputs. Diverse generators are your friend.

A useful idiom: write a generator that takes a "mode" parameter and produces different shapes (random, sorted, all-same, single-element, etc.) depending on the mode. Stress test against each mode.

---

## 6. Function-mode (LeetCode-style) authoring

Function mode is the right choice for interview-prep style problems where the focus is on the algorithm and the I/O parsing is uninteresting. The candidate writes only the function body; we provide the harness, the parsing, and the serialisation.

### 6.1 Signature DSL

The signature is a JSON-serialisable object:

```json
{
  "name": "twoSum",
  "params": [
    { "name": "nums", "type": "list<int>" },
    { "name": "target", "type": "int" }
  ],
  "returns": "list<int>"
}
```

Type vocabulary lives in `packages/shared/function-sig/`. The full list:

- Primitives: `int`, `long`, `double`, `bool`, `string`, `char`.
- Collections: `list<T>`, `list<list<T>>`, etc., for arbitrary nesting.
- Linked list: `ListNode` — canonical JSON form `[1,2,3,null,4]` (the LeetCode convention; `null` terminates).
- Binary tree: `TreeNode` — canonical JSON form is level-order with `null` for missing children: `[3,9,20,null,null,15,7]`.
- Graph: `GraphNode` — adjacency list with cycle support: `[[2,4],[1,3],[2,4],[1,3]]`.

### 6.2 Starter code generation

When you save the signature in Step 3, the system generates starter code per language. For the example above, the C++ starter is:

```cpp
class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // your code here
    }
};
```

The Python starter:

```python
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # your code here
        pass
```

The candidate sees only the starter; the driver code that reads JSON test cases, deserialises into language-native types, calls `Solution::twoSum`, serialises the return, and writes to stdout is invisible to them. It is generated and compiled per language by the judge worker.

### 6.3 Tests for function-mode problems

Each test's input is a JSON object whose keys match the parameter names:

```json
{ "nums": [2, 7, 11, 15], "target": 9 }
```

The expected output is the canonical JSON form of the return type:

```json
[0, 1]
```

For problems where multiple answers are valid (e.g., "any pair of indices"), use the `array_set` checker (order-insensitive) or write a custom checker.

---

## 7. Difficulty calibration

Your `difficulty band` and `rating estimate` are your best guesses at authoring time. The real numbers come from production:

- Once the problem has been solved by ~50 distinct candidates, we recompute its rating from the success rate and the ratings of the candidates who attempted it (using the Glicko-style item-difficulty formula).
- The new rating overwrites the estimate. Your initial estimate is preserved in `Problem.ratingInitial` for the historical record.
- The difficulty band is recomputed from the rating: 800–1300 = easy, 1300–1900 = medium, 1900+ = hard.

This means: do not stress about getting the rating exactly right at author time. Aim within ±300. The system will correct you.

---

## 8. Tagging conventions

Tags drive discovery, study plans, and the topic-mix engine for the Aptitude pillar. We maintain a controlled vocabulary (research §1 tag taxonomy) to keep tags useful — see the canonical list in the admin UI under Settings → Tags. Examples:

- Algorithmic: `dp`, `greedy`, `two_pointers`, `binary_search`, `divide_and_conquer`, `dfs`, `bfs`, `topological_sort`, `dijkstra`, `floyd_warshall`, `union_find`, `segment_tree`, `fenwick_tree`, `sparse_table`, `kmp`, `z_function`, `suffix_array`, `trie`, `combinatorics`, `number_theory`, `geometry`, `bitmask_dp`, `digit_dp`, `interval_dp`.
- Concept-level: `prefix_sum`, `monotonic_stack`, `monotonic_queue`, `sliding_window`, `tree_diameter`, `lowest_common_ancestor`, `articulation_points`, `bridges`, `strongly_connected_components`.
- Difficulty hints: `implementation`, `math`, `constructive`, `interactive`, `ad_hoc`.

**Do not invent new tags.** If you think a tag is missing, post in the `#problem-setting` channel. New tags are added by moderators on a quarterly review cadence to keep the vocabulary clean.

---

## 9. Editorial and hints (the writing side)

Most problem-setters spend more time on tests than on editorials. We push back on that — a good editorial is half the value of a problem to the platform.

A good editorial:

- **States the idea first.** "This is a sliding-window problem because…" — the central insight in one sentence. Then the details.
- **Justifies correctness.** Why does the algorithm produce the right answer? A short, rigorous argument is better than a long, hand-wavy one.
- **States the complexity.** Time and space. If you have a tight constant factor, mention it.
- **Includes code.** A clean reference implementation in C++ or Python (or both). Comments explain the non-obvious lines.
- **Mentions alternative solutions.** "You could also solve this with..."

Hints (5 total) are progressive. The mildest is a category-level nudge; the strongest is a near-complete spoiler. The principle: a candidate who reads all 5 hints in sequence and pauses to think after each should be able to solve the problem with the 5th hint alone. The 5th hint can include pseudocode if needed.

---

## 10. Common pitfalls

The mistakes new problem-setters make most often. Read this list before submitting for review; you will save a review cycle.

- **Off-by-one in samples.** Run your jury solution on every sample before saving. The wizard does this automatically, but sometimes authors write samples by hand and they don't match the jury's output.
- **Ambiguous output format.** "Print the answer." But is it on its own line? Followed by a newline? "Print YES if possible, NO otherwise." Is case-sensitive? Use case-insensitive checker if you don't want to argue.
- **Weak tests.** O(n²) accidentally passes when the intended is O(n log n). Always test with n at the constraint upper bound and a confirmed O(n²) submission — does it TLE? If not, raise the constraint or add a stress generator that hits the n² worst case.
- **Missing input validation.** Tests contain inputs the statement forbids. The validator catches this; never skip it.
- **Locale-dependent formatting.** Floats printed with `,` instead of `.` because of locale. Use `printf("%.6f", x)` or equivalent C-locale formatters. Tests should not contain locale-dependent strings.
- **Inconsistent jury solutions.** Two reference solutions in different languages, both marked jury, producing different outputs on the same input. The wizard catches this.
- **Checker that accepts too much.** A custom checker that accepts any non-negative integer when the answer is supposed to be uniquely determined. Test your checker with deliberately wrong outputs and confirm it rejects them.
- **Forgetting `inf.readEof()` in the validator.** Without it, the validator accepts inputs with extra trailing garbage.
- **Using the contest problem as a beginner problem.** A 1500-rated problem is not "easy". Calibrate honestly.
- **Forgetting Java memory limits.** Java's overhead is significant; if your problem has a strict 256 MB limit, Java may not fit even with a correct solution. Either raise the memory limit per-language, or accept that Java won't be a viable language for this problem and remove it from `allowedLanguages`.

---

## 11. The review process

Once you submit, a reviewer (REVIEWER role) picks up the problem from the queue. The reviewer checks:

- Statement clarity. Do they understand the problem?
- Tests strength. Are the hidden tests likely to catch common wrong approaches?
- Jury correctness. The wizard already verifies jury vs tests; the reviewer eyeballs the algorithm.
- Editorial quality. Is the editorial actually helpful?
- Tag accuracy. Do the tags match the problem?
- Constraint sanity. Are the time and memory limits reasonable?

Possible outcomes:

- **Approved.** The problem moves to `APPROVED`. An admin (`ADMIN` role) can then publish it. Authors do not need to do anything further.
- **Revision requested.** The reviewer leaves comments on specific fields (statement, tests, editorial). You see them in the wizard at the corresponding step. Address each comment, optionally reply, then re-submit.
- **Rejected.** Rare; happens when the problem fundamentally does not fit the platform (duplicate of an existing problem, statement is hopelessly unclear, intellectual property concern). The reviewer's notes will be in the rejection message.

The author should not take revision requests personally — every reviewer requests revisions on most problems, including ones they themselves authored. Iterate quickly.

---

## 12. Worked example A — easy problem ("Sum Pair")

We will walk an easy problem through the wizard end-to-end.

### A.1 Problem idea

"Given n integers and a target T, count the number of pairs (i, j), i &lt; j, such that a[i] + a[j] = T."

A classic. Intended solution: hash the values, count pairs in O(n). Easy/1100.

### A.2 Wizard walkthrough

**Step 1 — Metadata.**

- Title: "Sum Pair"
- Slug: `sum-pair`
- Difficulty band: easy
- Rating estimate: 1100
- Tags: `hash`, `two_pointers`, `implementation`
- Judge mode: STDIO
- Scoring: BINARY
- Time limit: 1000 ms; per-language override: Python 3000 ms, Java 2000 ms.
- Memory: 262144 KB.
- Allowed languages: all.

**Step 2 — Statement.**

> You are given an array $a$ of $n$ integers and an integer $T$. Count the number of pairs of indices $(i, j)$, $1 \leq i &lt; j \leq n$, such that $a_i + a_j = T$.
>
> **Input.** The first line contains two integers $n$ and $T$ ($1 \leq n \leq 10^5$, $-10^9 \leq T \leq 10^9$). The second line contains $n$ space-separated integers $a_1, ..., a_n$ ($-10^9 \leq a_i \leq 10^9$).
>
> **Output.** A single integer — the number of pairs.

Sample 1:

```text
Input
5 5
1 2 3 4 3

Output
2
```

Explanation: pairs are (2,3) and (1,4). Sums 2+3=5 and 1+4=5.

Sample 2:

```text
Input
1 0
5

Output
0
```

Explanation: only one element, no pairs.

**Step 3 — Function signature.** N/A (STDIO mode).

**Step 4 — Tests.** Validator (testlib) enforces the constraints in the statement. Hidden tests:

- 3 tiny tests (n = 1, 2, 3) with hand-picked answers.
- 4 edge structure tests: all-same value, all-distinct, all-pairs match, no-pairs match.
- 8 random tests at varying sizes (10, 100, 1000, 10000, 100000) generated by a small generator.
- 3 maximum-size tests (n = 100000) with adversarial structure.
- 2 tricky tests: one with overflow potential (a_i = 10^9, T = 2·10^9 — fits in int64 but not int32); one with negative values and T = 0.

**Step 5 — Checker.** Built-in `token` (single integer output, default).

**Step 6 — Reference solutions.**

- Jury (C++, hash map, O(n)).
- Jury (Python, Counter, O(n)).
- Brute (Python, double loop, O(n²)).

Stress test 1000 seeds, n ≤ 50 → jury and brute agree on all seeds.

**Step 7 — Starter code.** No-op (STDIO mode).

**Step 8 — Editorial.**

> The brute force solution is to iterate over all pairs in O(n²), which TLEs at n = 10^5.
>
> A faster approach uses a hash map. For each $a_i$, count how many previous elements equal $T - a_i$. Sum these counts.
>
> ```cpp
> long long count = 0;
> unordered_map<int, int> seen;
> for (int x : a) {
>     count += seen[T - x];
>     seen[x]++;
> }
> ```
>
> Complexity: O(n) expected time, O(n) space.

Hints:

1. The brute force is O(n²). Can you do better?
2. For each element, how many elements before it would make a valid pair?
3. Use a hash map to count occurrences of each value as you go.
4. For each `a_i`, increment count by `seen[T - a_i]`; then add `a_i` to `seen`.
5. ```cpp
   for (int x : a) { count += seen[T - x]; seen[x]++; }
   ```

**Step 9 — Review.** Looks clean. Submit.

The reviewer approves with one note: "Suggest also a Java reference solution to confirm time limit is fair." We add it. Re-submit. Approved. An admin publishes. Done.

---

## 13. Worked example B — medium problem ("Painting Intervals")

A more involved problem to show subtasks and a non-trivial checker.

### B.1 Problem idea

"You have a wall divided into n unit segments. You paint k intervals, each defined by [l_i, r_i] (1-indexed, inclusive). After all paintings, output the number of unit segments that are painted at least once."

Intended solution: events / sweep line in O(k log k). Medium/1500.

### B.2 Wizard walkthrough

**Step 1 — Metadata.**

- Title: "Painting Intervals"
- Slug: `painting-intervals`
- Difficulty band: medium
- Rating estimate: 1500
- Tags: `sweep_line`, `events`, `intervals`, `sorting`
- Judge mode: STDIO
- Scoring: IOI_SUBTASK (we want to give partial credit for the easier subtask)
- Time limit: 2000 ms; Python override 6000 ms.
- Memory: 262144 KB.

**Step 2 — Statement.**

> You have a wall of $n$ unit segments. You apply $k$ paint operations; the $i$-th operation paints all unit segments in the range $[l_i, r_i]$. After all operations, how many unit segments are painted at least once?
>
> **Input.** The first line contains $n$ and $k$ ($1 \leq n \leq 10^9$, $1 \leq k \leq 2 \cdot 10^5$). Each of the next $k$ lines contains two integers $l_i$ and $r_i$ ($1 \leq l_i \leq r_i \leq n$).
>
> **Output.** A single integer — the number of painted unit segments.

Sample 1:

```text
Input
10 3
1 5
3 7
8 10

Output
10
```

Explanation: intervals [1,5] ∪ [3,7] ∪ [8,10] cover [1,10], all 10 segments.

Sample 2:

```text
Input
10 2
2 4
7 8

Output
5
```

Explanation: [2,4] covers 3 segments; [7,8] covers 2 segments; no overlap; total 5.

**Step 3 — Function signature.** N/A.

**Step 4 — Tests.** Subtasks:

- **Subtask 1 (30 pts):** $n \leq 1000$, $k \leq 1000$. Intended brute: array marking, O(nk). Tests focus on small n.
- **Subtask 2 (70 pts):** full constraints. Tests stress n up to 10^9 and k up to 2·10^5.

Aggregation = min per subtask, sum across subtasks.

**Step 5 — Checker.** `token`.

**Step 6 — Reference solutions.**

- Jury (C++, events, O(k log k)).
- Brute (Python, mark each segment for n ≤ 1000, O(nk)).
- Stress test 500 seeds, n ≤ 200, k ≤ 200 → jury and brute agree.

**Step 7 — Starter code.** No-op.

**Step 8 — Editorial.**

> Create 2k events: at $l_i$ a `+1`, at $r_i + 1$ a `-1`. Sort by position. Sweep, tracking the current "coverage count" and the position of the last event. Whenever the coverage count is positive between two events, add the distance to the answer.
>
> Complexity: O(k log k).

Hints:

1. The brute is O(nk). With n up to 10^9, that's hopeless.
2. The answer depends only on the structure of the intervals, not the length of the wall.
3. Convert intervals to events: $+1$ at $l_i$, $-1$ at $r_i + 1$.
4. Sort events. Sweep left to right, tracking how many intervals are currently active and how far you've moved while active.
5. ```cpp
   sort(events.begin(), events.end());
   long long covered = 0, lastPos = 0;
   int active = 0;
   for (auto [p, d] : events) {
     if (active > 0) covered += p - lastPos;
     active += d;
     lastPos = p;
   }
   ```

**Step 9 — Review.**

Reviewer comments: "Add a test with intervals that touch exactly at endpoints ([1,5] and [6,10]) to verify the `r_i + 1` event placement is correct." We add it. Re-submit. Approved.

---

## 14. Where to find more

- [MASTER_PLAN.md](../MASTER_PLAN.md) §7 Brief A3 (the planned authoring tool features).
- [ARCHITECTURE.md](./ARCHITECTURE.md) for the system context.
- [ANTI-CHEAT.md](./ANTI-CHEAT.md) for what happens to submissions on your problem post-AC (plagiarism check, etc.).
- Codeforces Polygon — the canonical reference for problem authoring. We borrowed heavily from it. [https://polygon.codeforces.com](https://polygon.codeforces.com).
- testlib — the C++ library for validators, generators, and checkers. [https://github.com/MikeMirzayanov/testlib](https://github.com/MikeMirzayanov/testlib).
- Kattis problem package format — what our bulk upload accepts. [https://github.com/Kattis/problem-package-format](https://github.com/Kattis/problem-package-format).

If you get stuck, ping the `#problem-setting` channel; an experienced setter will pair with you.

---

## Change log

- 2026-05-19 — Initial draft. Two worked examples (Sum Pair, Painting Intervals). Pending the actual admin UI being built per Brief A3.
