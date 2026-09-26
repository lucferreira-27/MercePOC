# Recent request audit

Analyzed on 2026-09-26. Companion to [the redesign brief](model-friendly-design-brief.md). This is an investigation, not an implementation of the fixes.

## Scope and evidence limits

Read `data/merce.sqlite` using SQLite read-only mode. Selected projects updated since `2026-09-25T21:00:00Z` (18:00 in São Paulo), then examined their assistant responses associated with user requests, including saved error responses. This selects recent projects, not an exact timestamp window for every individual message.

The sample contains 22 requests across seven projects: 20 with saved step reports and two interrupted requests without step reports. Eight of the 20 reported turns contain at least one failed step, totaling 13 failed steps. Some are clarification-gate rejections, not geometry failures. Median reported duration is 35.9 seconds; the longest is 258.6 seconds. The two interrupted requests lack duration reports and are excluded from those timings.

Recorded model keys: `luna` on 13 requests, `deepseek` on seven, `qwen-fast` on one, and no recorded model on one direct export. This is a small, unequal observational sample. It does not support ranking the models or attributing all problems to small-model capability.

Evidence includes saved user requests, assistant replies, tool-step labels and failure details, applied-operation records, and revision snapshots. These are not complete provider transcripts: rejected tool arguments, all successful tool arguments/results, intermediate room edits, and model decision rationale are not retained here. Current-code replay establishes current behavior; it is not proof that every historical run used the exact same code or prices.

The [evidence snapshot](recent-request-audit-evidence.json) retains identifiers, reported steps, replayed fit results, and the material-change reconstruction. Live projects were not edited and no paid model requests were made.

## Findings

### 1. The latest reply contradicts the final state

**Confirmed model/reporting failure.** In “Painel com rack suspenso”, request `832c6650-c416-4092-bcd8-fc42b480596f`, the user asked to reduce required sheets and use the same material.

The assistant changed the oak components to walnut, checked the quote, then changed the main panel and decorative strip from 25 mm to 18 mm. It finished without another recorded quote or cut-plan read. Its reply nevertheless said the project still used 25 mm and 18 mm sheets.

Replaying the saved operations with the current engine produces:

| Stage | Materials and thicknesses | Sheets | Estimate using current default prices |
| --- | --- | ---: | ---: |
| Before the request | Oak 18/25 mm and walnut 25 mm | 3 | R$ 2,976.21 |
| After changing the material | Walnut 18/25 mm | 3 | R$ 3,138.21 |
| After the final thickness edit | Walnut 18 mm only | 2 | R$ 2,437.56 |

The first two estimates match the saved quote-step labels. The last is a replayed estimate, not a saved historical quote. The final state did reduce the sheet count. The response appears to describe the earlier intermediate state instead.

**Implication:** derive completion facts from the final candidate. Invalidate quote, cut-plan, fit, and preview evidence after relevant mutations. For an optimization request, explicitly evaluate the requested objective before and after; doing the proposed action is not sufficient evidence that the objective improved. Surface thickness changes as construction changes, not merely a color change.

### 2. A timeout committed changes while saying nothing changed

**Confirmed application bug, not simply a model mistake.** In “Armário de lavanderia 2”, request `127747f6-5688-467f-b9a2-73ab4d6b0bba`, the response says the request ran out of time and “O móvel não mudou.” The saved result is `applied`, with the module count increasing from two to six and the original furniture repositioned.

The final composition spans 4.20 m on a 3.20 m wall. Current replay finds that fit violation. No successful `finish` step appears in the saved trace.

In `lib/agent/turn.ts`, the fallback message checks `ctx.designChanged` after `ctx.commit()`. Commit calls `rebase()`, making `designChanged` false. An in-memory reproduction using the saved revisions confirmed the flag changes from true before commit to false afterward. The final checker would have detected the one-metre overflow if invoked on that candidate.

**Implication:** all exit paths need an application-owned finalization step. Normal completion, timeout, cancellation, and partial success need explicit semantics. Decide whether to retain a valid partial result or preserve the starting state, and describe what actually happened. A model failing to call `finish` must not bypass final checks.

### 3. Low-level construction rules repeatedly consume model effort

**Confirmed tool-use failures.** Examples include:

- Removing the rack initially failed because connections had not been separated. Request `88ac40a1-1118-4256-be92-e8be8e51f1c2`.
- Creating a drawer cabinet initially failed because an operation would leave zero modules. Request `d2131356-cb61-4b36-952e-571dcfeae959`.
- Rearranging kitchen furniture hit “Selecione uma prateleira horizontal”, indicating a target/operation mismatch. Request `3f3ecda7-ee69-4675-b809-84fd9088c64a`. The rejected arguments are unavailable, so the exact attempted operation cannot be reconstructed.
- The creative TV request made six invalid attempts, including two identical panel-collision messages. Request `a545ad32-fc26-49ac-8062-8c9564c741e0`. Identical messages do not prove identical arguments, but the repair did not resolve the same conflict on its next attempt.

**Implication:** remove, replace, resize, and place should be complete domain operations with application-owned bookkeeping. Return structured conflicts and feasible adjustments. Higher-level composition tools alone will not fix simple editing if the same brittle low-level contracts remain exposed everywhere.

### 4. Visual review and final validation give incomplete assurance

**Confirmed implementation gaps.** The TV composition received successful `render_look` and `finish` steps despite obstructing the screen. `render_look` uses furniture-only geometry, and `fitReport` skips TVs. The existing brief documents this case in detail.

Several replies also describe the drawing as displayed for the user after `render_look`. That tool sends an image to the model. In `turn.ts`, a separate result image is attached through the reference-photo review path. These non-photo requests do not establish that a separate review image was shown to the user, although the ordinary live 3D scene does update.

**Implication:** distinguish “the assistant inspected a preview”, “the user saw the updated scene”, and “a result image was attached”. Use the same relevant scene content for model inspection and user rendering, and avoid presenting a successful tool call as proof of overall quality.

### 5. The operation audit can retain discarded work

**Confirmed application bookkeeping defect.** During the kitchen-addition request `03b9b1c1-7075-40f2-bd58-fc3a389ae004`, the assistant first created a support cabinet, discarded the draft with `history_undo`, and then added a library sideboard.

The saved `appliedOperations` still includes creation of `apoio-cozinha`, which is absent from the result. The final added modules are `apoio-cozinha-a1` and `apoio-cozinha-a2`.

`AgentContext.rebase()` clears `ops` but retains `allOps`; the final report writes `allOps` as applied operations. Thus this record contains successfully executed but subsequently discarded work, not only the operations represented by the final revision.

**Implication:** distinguish attempted, draft-applied, reverted, and committed operations. Final highlights, evidence, and replay must use the correct category. The revision diff is a stronger source of final-state truth than the current operation list.

### 6. Room assumptions and clarification need more precise semantics

**Confirmed behavior; product-policy concern.** In “Armário de lavanderia 4”, request `9300ccb3-70fc-4ebe-a732-782f405b57fb`, the user explicitly authorized enlarging the wall, without giving a size. A clarification was rejected, the assistant tried 5 m, some obstacles did not fit, and it enlarged the wall to 6.5 m. The final response disclosed the assumption. This is not evidence of an unauthorized wall change.

In “Armário de lavanderia”, the request “Expanda o ambiente” received a clarification rejection claiming the request already supplied the measure, although it did not contain a number.

The clarification gate categorically rejects several question types on the basis that a reasonable default exists. Its generic repair text can misdescribe what the user specified. When a scene has real measured dimensions, this distinction matters.

**Implication:** track which dimensions are measured, user-specified, inherited defaults, or design assumptions, and whether they may change. Preserve the user's preference for autonomous work through explicit, reversible assumptions where appropriate. Do not solve this by asking confirmation for every creative choice.

### 7. Function is not guaranteed by a component name

**Confirmed representation; functional adequacy unproven.** In “Armário de lavanderia 3”, request `940119cd-1e9d-462a-b4a7-a157fa7404ef`, the assistant created two 509 mm wide box modules named “Vão máquina de lavar”. Naming these boxes does not establish an actual usable washing-machine opening. No appliance dimensions or appliance-fit check appear in the retained evidence.

Likewise, the TV request's “Prateleira escultural” is a vertical panel. Its final reply calls it a decorative strip, which is more accurate than the component name.

**Implication:** attach functional requirements to concepts such as appliance voids and shelves. Validate against actual supported structure and any relevant equipment dimensions. Do not infer functionality from generated names.

### 8. Interrupted runs lose the evidence needed for diagnosis

**Confirmed observability gap.** The wooden-door request in “Minha estante 58” and the furniture-addition request in “Armário de lavanderia” ended with a generic interrupted-response error after four and seven recorded model calls respectively. Their saved failure messages contain usage and retry information but no step report or request context.

`persistFailure` in `app/api/chat/route.ts` saves that reduced record. The error may come from cancellation, disconnect, or another abort path; the retained evidence does not establish which. Do not describe these two incidents as proven provider failures or proven timeouts.

**Implication:** persist request IDs, completed steps, state/revision identifiers, structured failure categories, and relevant tool arguments/results across every exit path. Record whether operations were committed or discarded. Redact credentials and avoid collecting private model reasoning.

## Counterevidence and important qualifications

- The 4.86 m kitchen arrangement was created before a 3 m room measurement was saved in that project's revision history. Do not claim the agent ignored a known 3 m wall during the earlier arrangement. When explicitly asked to fit the newly recorded room, the subsequent result passes the current fit checker.
- Library-based wardrobe and kitchen creation completed without rejected steps in this sample. That supports investigating higher-level construction interfaces, but does not prove their visual quality.
- A laundry expansion using `row_build` added four modules without a rejected step, and the saved result passes current room-fit checks. Another row-build request recovered after receiving a concrete free-span suggestion. Useful tool feedback can help.
- The glass-door response accurately disclosed unsupported functionality and preserved the furniture. The table/chairs response also disclosed that those items were not modeled.
- A direct PDF-export route completed in about 0.36 seconds. This is evidence for routing simple actions directly, not a fair speed comparison with creative generation.
- `checkWork` also ignores room-only changes and compares previous fit problems by broad issue code. These are code-review concerns worth regression tests, but this audit has not established an additional observed incident caused by either condition.

## How this should change the redesign plan

Keep the implementing agent free to choose the architecture, but expand the scope of evaluation beyond creative geometry:

1. Establish a trustworthy final-state summary and a mandatory completion check for all exit paths.
2. Correct the distinction between committed, reverted, and merely attempted work, and retain failure diagnostics.
3. Reduce construction bookkeeping with better domain operations and task-relevant capabilities.
4. Add consistent full-scene previews, protected-object rules, and functional constraints.
5. Evaluate creative quality, objective improvement, and factual final responses separately.

Regression scenarios should include material/thickness optimization with an accurate final sheet count; timeout after useful but invalid partial work; undo of a draft followed by another design; removal of connected furniture; replacement of the sole module; TV backing versus obstruction; new room measurements after furniture creation; and interruption with a preserved diagnostic trace.

The logs support a combined diagnosis: models make planning and tool-use mistakes, while application lifecycle, validation, and reporting gaps let those mistakes become confusing results. Improving only the prompt or switching to a larger model will leave the confirmed application defects in place.
