# Making creative furniture design easier for small models

## Assignment and freedom to change the approach

Investigate how Merce can make creative furniture requests more reliable for small models, then develop and implement a practical improvement.

This document is a starting hypothesis, not a prescribed architecture. Validate the diagnosis against the current code. You are free to revise, replace, simplify, or expand the proposed solution if another approach better serves the goal. Explain important tradeoffs and support your choice with working examples and evaluation. Do not implement this proposal mechanically just because it is written here.

The desired outcome is an assistant that can produce useful, coherent, varied furniture compositions without spending most of its effort repairing geometry or managing internal operations. Preserve the user's ability to make precise edits and undo changes.

## Required default model

The user has selected **GPT-6 Luna with high reasoning** as the new default because DeepSeek V4.1 has been too slow in their use. This is a product requirement, not an optional architectural suggestion.

Use Merce's existing `luna` model key and effective reasoning effort `high`. `lib/models.ts` already declares Luna with high reasoning, but other defaults, saved settings, model-picker descriptions, environment overrides, and benchmark defaults must be checked during implementation. Make the default consistent across new sessions and omitted-model requests. Preserve an explicit user model selection; distinguish it from a persisted old default. Update descriptions that currently call DeepSeek the default and Luna only its backup.

Use Luna/high for the primary baseline and candidate verification runs. A historical DeepSeek run is supporting evidence, not a controlled performance baseline for the redesigned Luna workflow. DeepSeek may remain an explicitly selectable option. The architecture remains open to revision; the selected default should not be changed without new user direction.

This brief records the requested configuration change. It does not itself change the running application's default.

## The problem

Merce currently asks the model to handle creative choices and low-level construction at the same time. A request such as “add custom modules around this TV panel, be creative” requires the model to reason about coordinates, dimensions, panel thickness, clearances, internal IDs, connections, operation order, available primitives, and visual composition.

Validation catches some invalid constructions, but the model must repair them through repeated calls. Passing those checks does not establish that the result is visually coherent or meets the user's intent.

We suspect this interface consumes capacity that a small model could otherwise spend on design decisions. This is a hypothesis to measure, not proof that model size alone explains the failures.

## Confirmed example

The local saved project `9e01176e-b17c-42e7-b24e-04573e8798e1`, named “Painel com rack suspenso”, contains the observed case in revision 3. Inspect it read-only and use a copied fixture for experiments. Its presence and contents may change after this brief was written.

The user first removed everything except the panel and TV, then requested: “Vamos adicionar os nossos modelos custum no painel seja creativo”. The resulting turn took 16 model calls and approximately 160 seconds, with six failed attempts:

- Two openings below the 100 mm minimum: 78 mm and 22 mm.
- Two collisions between a proposed niche and the panel, including a repeated failure.
- Two dimension-limit violations involving depth and height.

The accepted result placed a tall niche in front of part of the TV and created a vertical decorative board named “Prateleira escultural”. That board is 900 × 220 × 25 mm; it is not a horizontal shelf.

Code inspection identified these gaps:

- `lib/room.ts`, `fitReport`: TVs are explicitly skipped. Allowing a backing panel behind a TV also exempts furniture that obstructs the screen. Rechecking this saved result returned `fits: true` with no issues.
- `lib/agent/tools.ts`, `render_look`: the visual check renders furniture parts without the room or TV. The assistant reviews a different scene from the one the user sees.
- `lib/agent/tools.ts`, `checkWork` and the finish checks: these cover selected fit, opening, and action-completion conditions, not overall composition quality or complete fulfillment of spatial intent.
- `lib/agent/tools.ts`: the main loop exposes 30 tools spanning geometry, viewing, pricing, export, history, and project management.

These observations establish concrete defects. The larger architectural explanation and proposed remedy below still need investigation.

## Additional evidence from recent requests

Read the companion [recent-request audit](recent-request-audit.md) and its [evidence snapshot](recent-request-audit-evidence.json) before deciding implementation scope. The audit examined 22 requests across seven recently updated projects, including two interrupted requests. Eight of the 20 requests with saved reports contained failed steps. This is an observational sample, not a controlled comparison of models.

The evidence expands the problem beyond creative placement:

- The latest material-optimization request reduced the computed sheet count from three to two, but the final reply described an outdated intermediate state.
- A timed-out request saved four added modules and a room-fit violation while reporting that the furniture had not changed. In-memory reproduction identified a completion-message bug: the changed-state flag is checked after commit resets it.
- A discarded draft's operations remained in the final `appliedOperations` record.
- Simple removal and replacement requests exposed connection and minimum-module bookkeeping to the model.
- Interrupted responses omitted the step trace needed to diagnose them.

These findings suggest a trustworthy finalization and evidence layer alongside any new creative interface. Every exit path should validate and describe the actual retained state. Separate attempted, reverted, and committed operations. Recompute objective-specific facts after the last mutation. Preserve diagnostics when a request fails.

The audit also records counterevidence and limitations. In particular, the kitchen's 3 m wall was introduced after the earlier 4.86 m furniture arrangement, so the earlier turn should not be blamed for ignoring that later measurement. Some library and row-building requests completed without rejected steps. Do not attribute application bugs or missing scene facts to model intelligence.

## Proposed direction to investigate

Let the model describe design intent and relationships; let the application resolve construction details. A possible workflow is:

`Request → composition proposal → placement and construction → full-scene preview → selection or refinement → one committed revision`

### 1. A compact design interface

Consider operations that express relationships such as “left of the TV”, “aligned with this niche”, “stacked”, or “attached to this panel”. The model could choose component types, proportions, materials, density, and balance without calculating every coordinate.

For example: preserve the TV and panel; add a tall oak niche on the left and two smaller staggered niches on the right; keep the screen clear and leave generous empty space.

This should remain composable. Avoid reducing all creative work to selecting from a few fixed finished templates. Exact dimensions and explicit placement requests must remain expressible.

### 2. Task-relevant scene context

Consider giving the model an application-computed summary of fixed objects, available regions, supported components, relevant limits, and existing problems. Expose tools appropriate to the current task, with access to further capabilities when needed.

Investigate whether this context and a few higher-level tools are sufficient before introducing a large new abstraction layer.

### 3. Application-owned placement and construction

Separate hard requirements from preferences. Hard requirements include preserving specified objects, respecting explicit measurements, avoiding obstruction, and using supported geometry. Preferences include balance, spacing, repetition, proportions, and material contrast.

A placement engine could resolve dimensions and relationships inside available regions. Options include extending existing macros, bounded search over placements, a constraint solver, or a combination. Choose based on actual complexity and measured results.

Distinguish a panel behind the TV from an object blocking its screen. Also distinguish collision-free placement from verified physical mounting: do not claim structural guarantees beyond the implemented checks.

### 4. Complete previews and bounded refinement

Use consistent scene data for validation, the user's view, and the assistant's preview. Include relevant room objects, particularly the TV.

For open-ended creative requests, consider generating a small number of distinct valid candidates, then selecting or refining based on complete previews. Compare this with a cheaper single-proposal workflow; multiple candidates are optional, not a requirement for every edit.

Visual judgment should complement deterministic checks. It should not be the only defense against geometric violations.

### 5. Safer transactions and useful failures

Hide ID generation, connection bookkeeping, and intermediate construction order behind the application interface. Build and validate a complete candidate before committing it, while preserving existing validation invariants and history behavior.

Do not simply disable intermediate validation without understanding its purpose. Investigate a dedicated candidate builder or another safe construction path.

When a proposal cannot fit, return a specific conflict and feasible alternatives. Preserve explicit user requirements; do not silently resize, remove, or relocate protected objects to manufacture success. Bound retries and report unresolved limitations honestly.

Represent real capabilities accurately. A true horizontal shelf may require a geometry extension. Calling a vertical panel a shelf must not stand in for that implementation.

## Suggested investigation and implementation sequence

1. Reproduce the saved failure in an isolated fixture and establish a baseline. Inspect existing contracts, tests, benchmarks, and related handoff documents before choosing a design.
2. Address or account for the immediate TV-validation and incomplete-preview gaps.
3. Choose one representative end-to-end workflow, such as composing around a TV panel. Prototype the smallest architectural change that materially reduces model burden.
4. Compare it with the current workflow on this failure and additional unseen cases. Include creative additions, exact edits, crowded scenes, impossible requests, and preservation of existing work.
5. Refine the approach based on evidence. Expand to other furniture tasks only when the abstraction has demonstrated value.

This sequence may change if investigation reveals a better dependency order or a simpler solution. A complete rewrite is not an assumed requirement.

## Evaluation and acceptance criteria

Use the companion [verification checkpoint](redesign-verification.md) as a concrete starting contract. It defines the first end-to-end TV scenario, a regression pack, evidence freshness, proposed acceptance thresholds, and verification states. These gates are proposals to implement and evaluate, not claims of current success.

Assess both reliability and creative usefulness:

- Protected objects and explicit measurements are preserved.
- The TV stays visible; legitimate backing panels remain possible.
- Geometry and supported construction rules pass deterministic checks.
- The result matches the requested relationships and function.
- Unsupported features and unsatisfied constraints are communicated accurately.
- Alternatives differ meaningfully when alternatives are generated.
- Precise follow-up edits, revision history, and undo continue to work.
- Model calls, retries, latency, tokens, and cost improve against the baseline where measured. Do not assume a particular reduction in advance.
- Human comparison of rendered results evaluates usefulness and visual coherence. Tool success alone is insufficient.
- Final replies accurately describe the retained revision, including partial or timed-out work, and objective-specific before/after results such as sheet count.
- Undoing an intermediate draft does not contaminate committed-operation records; interrupted runs retain actionable diagnostic evidence.

Use repeated trials where model variability matters and separate development cases from held-out evaluation cases. Record the model and relevant configuration so comparisons are interpretable.

## Useful starting points in the repository

- `lib/agent/macros.ts`: `row_build` already moves placement and construction calculations into code.
- `lib/assets.ts`: parametric furniture recipes and construction helpers.
- `lib/agent/prompt.ts`, `snapshot.ts`, `tools.ts`, `loop.ts`, and `turn.ts`: model context, tool interface, execution, and final checks.
- `lib/composition.ts`, `studio.ts`, and `room.ts`: geometry, operations, and room validation.
- `lib/plan-render.ts` and `lib/plan-geometry.ts`: current assistant-facing drawings.
- `bench/` and `tests/`: existing evaluation and regression infrastructure.

Follow the current `AGENTS.md`. Visual changes require real screenshots from the running app before committing. Run the required tests, lint, and typecheck for implementation work. PRs require relevant running-app screenshots under the documented convention. Preserve unrelated local changes.

## Expected handoff from the implementing agent

Explain the architecture you chose, which parts of this proposal you kept or changed, and why. Deliver a working implementation of the selected scope, regression coverage, representative screenshots, and an honest comparison with the baseline. Identify remaining limitations and the next expansion supported by the evidence.

The measure of success is that a small model can make useful creative decisions with substantially less construction bookkeeping, while Merce maintains trustworthy results.
