# Verification checkpoint for the agent redesign

This is a proposed verification contract, not an implemented test runner or a claim that the redesign passes. The implementing agent may improve the scenarios and thresholds, but should establish them before comparing results and explain changes.

Use **GPT-6 Luna, high reasoning** (`luna`, effective reasoning effort `high`) as the primary verification model and new application default, as requested by the user. Record the effective setting, including environment overrides. Run both the old workflow baseline and the redesign candidate with Luna/high so model changes do not confound the comparison. Existing DeepSeek timings are contextual evidence only.

## Primary scenario

Use the saved TV-panel project before its creative request as the first end-to-end checkpoint. Copy it into an isolated fixture. Ask the agent to add a creative arrangement of modules while preserving the panel and TV.

Verify the resulting state independently of the assistant's reply:

- Panel and TV dimensions and positions remain unchanged.
- At least one supported, functional addition is made.
- The TV screen remains unobstructed, with the configured clearance respected.
- The additions respect panel boundaries and the implemented attachment rules.
- Geometry is valid and the result fits the recorded room.
- The full scene is visible in real running-browser captures, including front and perspective views.
- The final reply accurately describes the retained design.
- One undo restores the starting state, including the room.

These checks establish correctness for this scene. A person must separately assess whether the composition is coherent and useful. Do not equate collision-free geometry with good design or with verified structural mounting.

## Small regression pack

| Case | Required evidence |
| --- | --- |
| Creative TV composition | Primary scenario above; complete scene and human visual review |
| Unseen TV variation | Different TV/panel proportions or existing objects; same protection and fit checks |
| Material and sheet optimization | Saved audit fixture ends with two 18 mm walnut sheets under the current cut planner; response matches final computed facts; no requirement to preserve historical prices |
| Remove connected furniture | Requested modules are removed, protected modules preserved, no model-managed disconnect repair required |
| Replace the sole module | Valid final replacement without a model-visible empty-project error |
| Precise follow-up edit | Explicit dimension or material change is honored; unrelated parts stay unchanged |
| Timeout after draft changes | Controlled timeout; explicit partial/aborted outcome; invalid draft is not committed as a successful result; reply matches retained state |
| Undo draft, then build another design | Final operation record excludes reverted work; final revision and one-step undo are correct |
| Impossible or unsupported request | Specific limitation and feasible alternatives, without silently changing hard constraints or claiming unsupported functionality |
| Interrupted response | Controlled interruption; saved request ID, step trace, cause category, and commit/rollback outcome support diagnosis |

Add another held-out creative variation before accepting a broad claim of improvement. Freeze its expectations before running the candidate. Exact layouts should remain flexible unless the request explicitly specifies them.

## Evidence and verification state

Each run should identify the code revision and any local changes, scenario and starting-state hash, model/configuration, prompt/tool versions, and final-state hash. Retain deterministic check results, operation lifecycle events, tool trace, final reply, screenshots, timing, calls, retries, tokens, and cost.

Attach each quote, cut plan, fit check, and preview to the state it describes. Any subsequent relevant mutation invalidates that evidence. Finalization must regenerate stale evidence or say that the affected check is unverified.

Use separate fields for request outcome and verification. A correctly handled timeout can pass its timeout regression test while the user's creative request remains incomplete.

| Verification state | Meaning |
| --- | --- |
| Not run | Required evidence has not been collected |
| Failed | At least one required condition was violated |
| Needs review | Automated checks pass, but required visual or human assessment is missing |
| Verified | All required checks for the named scenario and exact retained state passed |
| Stale | State, code, or relevant configuration changed after verification |

Never present `Verified` without scope. “TV composition verified at revision X” is meaningful; “the agent works” is too broad. Report missing automated evidence as `Not run`, not `Needs review`. A later edit must not inherit a previous revision's green status.

## Execution and comparison

Reuse the existing `bench/` infrastructure, which already supports the agent loop, recording, offline replay, repeats, and baseline comparisons. Extend it if needed. Verify that each new case exercises the production path, including completion and failure handling; testing only a planner helper misses the observed lifecycle bugs.

1. Run deterministic tests, including controlled timeout and interruption paths, without paid model calls. Run `npm test`, `npm run lint`, and `npx tsc --noEmit` for implementation work.
2. Capture a baseline and candidate with the same fixture, model, reasoning settings, budgets, and pricing assumptions. Preserve baseline recordings separately. Compare both against the same independent acceptance conditions; do not use the old buggy validator as the oracle.
3. Run each live creative/editing scenario three times initially. Increase repetitions for unstable cases and before strong reliability claims. Offline replay checks harness behavior, not whether the updated model-facing interface elicits better new decisions.
4. Review real browser screenshots for representative outputs and every visual change required by `AGENTS.md`. Use blind before/after comparison where practical. Code validation determines geometry; human review judges coherence and usefulness. A model judge can assist but should not be the sole aesthetic or factual authority.
5. Produce a per-case comparison: semantic completion, hard failures, human review, calls, validation retries, latency, tokens, and cost. Include failure and partial outcomes in denominators. Show external service failures separately while retaining their user-visible completion impact. Count every attempt's latency and cost.

## Proposed initial acceptance gate

- All deterministic lifecycle regressions pass; tests, lint, and typecheck pass.
- Fresh sessions and requests without an explicit model use Luna/high; explicit model selections are respected, and the UI accurately identifies the default.
- No hard-constraint violation, false completion statement, or corrupted history is observed in the acceptance runs. Fix an occurrence before approval; zero observed failures is not a universal guarantee.
- At least 90% of feasible live tasks complete their semantic requirements across the initial repeated sample. Report the actual numerator and denominator and cases that remain unstable. This threshold is a proposed starting point, not a measured current result.
- Representative creative results pass the documented human review for request alignment, visual coherence, and functional plausibility. If the new results are worse, reduced calls do not justify acceptance.
- On the matched creative/edit subset, target at least a 50% reduction in rejected geometry/tool attempts against the baseline, without losing completion or quality. Treat this as a performance target rather than a reason to remove validation. Report calls, median/tail latency, and cost even if they do not improve.
- A reviewer can open the result report and inspect the exact verified state, screenshots, failures, and remaining limitations.

The first milestone is one complete TV scenario with trustworthy state and evidence, followed by the regression pack. Do not build a large dashboard before the evidence pipeline works; the existing benchmark report is an appropriate initial surface.

## Current status

Redesign implemented on branch `codex/model-friendly-design` and measured with GPT-6 Luna `high` on both sides. Results, per-scenario states and evidence are in [the redesign report](redesign-report.md).

- **Verified** (automated, 3/3 each, at `7907cab`): material and sheet optimisation, removal of connected furniture, replacement of the sole module, precise follow-up edits, impossible or unsupported requests, default model. **Verified** (deterministic tests): timeout after draft changes, undo then rebuild, interrupted response.
- **Needs review**: every creative composition (TV walls, kitchens, laundry, wardrobe, shelving, office wall). The automated checks pass 3/3 per case; the human review of the gallery in `docs/plans/evidence/galeria/` has not happened.
- **Stale rule**: any later change to the agent code or prompt makes these states Stale until the composition group is re-run (`npm run bench -- --agent --group composicao --repeat 3`).
