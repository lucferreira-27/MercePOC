# Redesign report: construction by the app, decisions by the model

Companion to [the brief](model-friendly-design-brief.md), [the recent-request audit](recent-request-audit.md) and [the verification checkpoint](redesign-verification.md). Branch `codex/model-friendly-design`. Everything below was measured with **GPT-6 Luna, reasoning `high`** on both sides (`luna`, effective effort `high`, no `MERCE_REASONING_EFFORT` override, Command Code provider, Jev router and gate on).

**In short.** The model now decides *what* to build and *relative to what*; the app computes where it goes, how it is built, whether it breaks a rule, and what the reply may claim. On 18 scenarios across TV walls, kitchens, laundry, wardrobes, shelving, an office wall, layout changes, exact edits and an impossible request (3 runs each), the delivered code passed **54/54** against **27/54** for the previous code, with **6** rejected attempts instead of **44**, **4.6** model calls per request instead of **7.8**, median **32 s** instead of **54 s**, and **41%** lower cost per request. The 60 pre-existing benchmark cases stayed green (**59/60** vs 58/60 before). Human review of the rendered results is still pending, so no creative scenario is marked Verified.

## 1. What the diagnosis turned out to be

The TV case was one symptom. Reading the baseline traces across kitchens, laundry, wardrobes, shelving, layout changes and precise edits, the failures share five causes:

1. **The model did the construction arithmetic.** Absolute centre coordinates, panel thickness, which surface a piece hangs on, split gaps that must leave 100 mm, connection bookkeeping before a removal, operation order when replacing the only module. Baseline TV compositions floated 28 to 128 mm in front of the panel, moved the panel itself, and split niches into 22 mm gaps. Kitchen and laundry requests left upper cabinets off the wall.
2. **The app did not tell the model where things fit.** A rejection said "Módulos sobrepostos: Painel e Nicho" and nothing about the free space, so the model guessed again (tv-02: 6 rejections in one run).
3. **Validation and preview did not cover the scene the person sees.** `fitReport` skipped the TV; `render_look` drew furniture only; the 3D scene hung the TV on the frontmost panel of any kind (a decorative board pushed it 15 cm out). Without an anchor, a module added to the left of the panel dragged the wall, and the TV, with it (baseline tv-01#3, tv-02#2, tv-03#2).
4. **Doing the action was treated as proof of the objective.** "Reduce sheets" became "same material" (3 sheets before and after, 0/3 baseline); a request with an impossible item replaced the TV panel (imp-01, 0/3); a reply said "a TV ficou livre" with a shelf across it.
5. **The end of a turn was not owned by the app.** Timeout messages were computed after commit; discarded drafts stayed in `appliedOperations`; interrupted turns kept only the cost; a plain-text reply skipped every check.

Two engine gaps were real capability limits rather than model mistakes: a door could not cover a divided compartment (no "shelves behind a door", which every kitchen and wardrobe needs), and there was no horizontal wall shelf.

## 2. Architecture chosen

The model keeps the design decisions (what, how many, proportions, materials, relationships); the app owns geometry, bookkeeping, verification and the facts in the reply. It is a thin layer over the existing operation contract, not a rewrite: `design_apply` stays for exact edits, and everything the new tools do is compiled to the same validated operations, so history, undo, highlights and replay are unchanged.

| Layer | What it does | Where |
| --- | --- | --- |
| Scene model | The wall as the app sees it: fixed objects with their rule (TV: nothing in front of the screen or within 30 mm, backing panel allowed; door, window, column: do not cover; outlet: may sit behind), occupied volumes in wall coordinates (x from the corner, y from the floor, depth from the wall), free spans per height band and in front of each wall panel. Sent in the state the model reads. | `lib/agent/scene.ts` |
| `place` | New pieces by relationship: beside / above / below a module, an obstacle (`tv`, `janela`, `porta`) or an earlier piece of the same batch, or at wall x/y. The app finds the surface (a piece in front of a wall panel hangs on it), depth, finish (from the neighbour), interior, and connects the piece to the module it touches. Dictated sizes are exact: a conflict returns what blocked and the free width or height on that side plus the free spans. Omitted sizes come from the type and the reference and shrink to the free space. A piece wider than 1200 mm becomes a shared-panel row; `vao` reserves an appliance space as a protected area; `prateleira` is the new wall shelf. | `lib/agent/place.ts` |
| `modify` | Complete edits of existing modules: remove (connections go with it, neighbours stay), move by relationship (layout changes), sizes that apply to the whole shared-panel row (`altura_total` counts the feet), replace the interior. | `lib/agent/modify.ts` |
| Interior layouts | Rows bottom to top with optional heights, columns and fronts; the app does the gap arithmetic and normalises heights that do not close; `porta_inteira` puts one door over shelves. | `lib/agent/interior.ts` |
| Engine extensions | Door over a divided compartment; `ledge` module (wall shelf, 15 to 60 mm thick, 150 to 600 deep, up to 2700 long, cut as a shelf with four banded edges); `module.remove` detaches connections keeping neighbours in place; replacing the only module in one batch no longer passes through an empty project. | `lib/composition.ts`, `lib/studio.ts` |
| Consistent scene | `fitReport` gains `tv-blocked` with per-cause keys; the wall is pinned when a turn changes the furniture and something from the start stays; the 3D scene and the `render_look` drawing use the same TV mount rule (screen turns red when blocked; the drawing now includes wall, TV, windows and doors). | `lib/room.ts`, `lib/scene-room.ts`, `lib/scene-parts.ts` |
| Trustworthy end of turn | App-owned finalisation on every exit path (finish, text-only reply, step or time limit): valid draft kept as `partial`, invalid draft rolled back; operations split into committed, reverted and rejected; reply numbers checked against the final state (sheets, thickness, total); measurable objectives (fewer sheets, lower cost) compared before and after with the levers; removals must be disclosed; "I changed it" with nothing changed is refused; "conferi o desenho" requires a fresh preview; per-turn evidence status; failures keep request id, step trace, cause and commit outcome. | `lib/agent/turn.ts`, `lib/agent/tools.ts`, `lib/agent/facts.ts`, `app/api/chat/route.ts` |
| Default model | GPT-6 Luna `high` for new sessions and omitted-model requests (`DEFAULT_MODEL`); explicit choice stored in `merce-model-choice`; the old `merce-model=deepseek` is treated as the persisted old default. | `lib/models.ts`, `app/page.tsx` |

### What I kept from the brief, and what I changed

- **Kept:** relationships instead of coordinates; task-relevant scene context; application-owned placement with hard requirements (protected objects, explicit sizes, obstruction, supported geometry) separated from preferences; complete previews; atomic batches through the existing validator; specific conflicts with feasible alternatives; bounded retries; honest capabilities (a real horizontal shelf instead of calling a vertical panel a shelf).
- **Changed: general, not TV-shaped.** The first design was a composition tool around the TV. After the clarification, the same mechanism became a general relational placement over any reference (modules, obstacles, earlier pieces), which is what kitchens, laundries, wardrobes and layout changes needed.
- **Changed: no constraint solver.** Placement is a deterministic relation plus "free reach" shrinking (distance from the anchored edge to the first blocker, wall, floor, ceiling or panel edge). It was enough for every case measured and keeps the result explainable in one sentence.
- **Changed: single proposal, not multiple candidates.** For open requests the model composes once, looks at the full-scene preview once and adjusts. `options_make` stays for explicit option requests. Multiple candidates by default were not implemented or measured; the single-proposal path already met the quality and latency targets here, and generating three would roughly triple cost.
- **Not done: tool subsetting.** The loop still exposes all tools (32). Calls and latency dropped without it, and a stable tool list keeps the provider's prompt cache warm. It remains a candidate next step if a smaller model struggles with tool choice.
- **No structural claims.** "Preso no painel" names the mounting surface; the existing "fixar na parede com parafuso, bucha e suporte" warnings stay. Nothing claims load capacity or verified mounting; a 25 mm shelf over 1.2 m can sag.

## 3. Evaluation

### Setup

- **Baseline:** worktree at `a55d021` (the agent code before this work, with only the bench and fixtures added). Recordings in `bench/fixtures/agent-baseline` (composition) and `agent-baseline-corpus`.
- **Candidate:** this branch, three full runs of the composition group as the work converged (A `04e8db6`, B `dc77353`, C `7907cab`, the delivered agent code) and the corpus at `04e8db6` and `7907cab`. Recordings in `bench/fixtures/agent-final-A`, `-B`, `-C` and `agent-final-corpus-C`.
- **Cases:** group `composicao` (18 cases, `bench/composition-cases.mjs`), 3 repetitions each, scenes copied read-only from the audited projects (`bench/scenes`) or generated with the operation contract. **Held-out:** `tv-03` (wall with no panel, TV over a library rack) and `esc-01` (office wall with a window), expectations written before any candidate run and not changed afterwards. I did see the baseline's tv-03 failure summary early; no code was written against that scene.
- **Judge:** `bench/oracle.mjs`, independent of the app's validator. The oracle changed twice after the first baseline run (TV clearance 50 → 30 mm to match the app; a crash on scenes without a room), so the baseline was **re-judged offline** by replaying its recorded model replies on the baseline code with the final oracle (`base-composicao-rejulgada.json` in `docs/plans/evidence/runs/`); the replay reproduced the live results exactly. Timing, calls and cost come from the live runs.
- **One prompt fix:** `coz-02` said "os aéreos na altura de antes", which the model cannot know; it now says "a 1,5 m do piso" and its baseline was re-run with the new wording.
- **Existing corpus:** the 60 pre-existing agent cases (photo cases excluded: the baseline worktree does not have the untracked photos), once each, both sides.

### Results

**Composition group, all runs** (18 cases × 3, Luna `high` on both sides; rejected = tool calls refused by validation or by the placement engine; latency and cost count every attempt):

| Run | Commit | Pass | Rejected | Calls/request | Median | p90 | Cost/request |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | `a55d021` | 27/54 (50%) | 44 | 7.8 | 54 s | 151 s | US$ 0.0174 |
| Candidate A | `04e8db6` | 53/54 (98%) | 34 | 5.5 | 33 s | 99 s | US$ 0.0135 |
| Candidate B | `dc77353` | 53/54 (98%) | 14 | 5.0 | 42 s | 109 s | US$ 0.0118 |
| **Candidate C (delivered)** | `7907cab` | **54/54 (100%)** | **6** | **4.6** | **32 s** | **75 s** | **US$ 0.0102** |

- **Held-out cases** (`tv-03`, `esc-01`): baseline 2/6; A 5/6; B 5/6; C 6/6. The miss in A and B was the same in `esc-01`: bookshelves resting on the new base cabinets, supported but neither connected nor marked as wall-fixed, which the frozen oracle counts as floating. The fix in `7907cab` (a piece off the floor is always marked for wall fixing) came **after** seeing that failure, so `esc-01` is no longer strictly held-out in run C. `tv-03` passed 9/9 across A to C with no code written against it.
- **Between runs A and B**, one systematic cause of rejections was removed: Luna fills every optional field, and zero-filled `x`/`y` sent "below the TV" to the floor corner, while a filled `porta_inteira` put doors over drawers and open niches. Between B and C: moving one module of a connected row now moves the whole set (as dragging does), an empty edit is "no effect" rather than a rejection, and the hint for the legacy `move` op points to `modify`.
- **Rejected-attempt target (≥ 50% fewer):** not met by A (−23%), met by B (−68%) and C (−86%).

**Per case, delivered run C vs baseline** (pass, rejected attempts, calls per request, median latency):

| Case | Baseline | Candidate | Rejected | Calls | Median |
| --- | ---: | ---: | ---: | ---: | ---: |
| tv-01 | 1/3 | 3/3 | 8 → 0 | 15.0 → 4.0 | 166 s → 47 s |
| tv-02 | 0/3 | 3/3 | 13 → 3 | 17.0 → 7.0 | 187 s → 89 s |
| tv-03 (held-out) | 2/3 | 3/3 | 5 → 0 | 10.7 → 5.0 | 139 s → 49 s |
| coz-01 | 2/3 | 3/3 | 0 → 0 | 3.7 → 5.0 | 34 s → 42 s |
| coz-02 | 1/3 | 3/3 | 1 → 0 | 8.3 → 4.3 | 107 s → 47 s |
| coz-03 | 3/3 | 3/3 | 1 → 1 | 5.7 → 7.3 | 59 s → 75 s |
| coz-04 | 3/3 | 3/3 | 0 → 0 | 3.0 → 2.7 | 12 s → 16 s |
| lav-01 | 3/3 | 3/3 | 2 → 0 | 11.0 → 6.3 | 40 s → 39 s |
| lav-02 | 0/3 | 3/3 | 1 → 0 | 9.7 → 5.3 | 79 s → 40 s |
| gr-01 | 0/3 | 3/3 | 0 → 0 | 8.3 → 4.0 | 44 s → 25 s |
| gr-02 | 3/3 | 3/3 | 5 → 1 | 9.3 → 2.3 | 85 s → 19 s |
| est-10 | 3/3 | 3/3 | 1 → 0 | 7.7 → 8.0 | 34 s → 34 s |
| esc-01 (held-out) | 0/3 | 3/3 | 3 → 1 | 8.3 → 8.7 | 83 s → 94 s |
| mat-01 | 0/3 | 3/3 | 0 → 0 | 3.3 → 4.7 | 15 s → 24 s |
| rem-01 | 0/3 | 3/3 | 3 → 0 | 4.3 → 2.7 | 13 s → 7 s |
| rep-01 | 3/3 | 3/3 | 0 → 0 | 4.7 → 3.0 | 13 s → 11 s |
| edit-01 | 3/3 | 3/3 | 0 → 0 | 2.3 → 2.3 | 6 s → 10 s |
| imp-01 | 0/3 | 3/3 | 1 → 0 | 7.3 → 1.0 | 62 s → 6 s |

The biggest wins are exactly the audit's failure modes: `tv-01`/`tv-02` (15 to 17 calls with 8 to 13 rejections, down to 4 to 7 calls), `rem-01` (no manual disconnects), `imp-01` (the baseline replaced the TV panel in 3/3 runs; the candidate explains the limits in one call), `mat-01` (the baseline never reduced sheets; the candidate ends with fewer sheets and a reply that matches the cut plan), `lav-02` (a real, protected washer void with an upper cabinet above it) and `gr-01` (a wardrobe extension that matches height and depth and stays attached). `coz-01`, `coz-03` and `mat-01` take a few more calls than before; `edit-01` and `coz-04` are a few seconds slower.

**Pre-existing corpus** (60 agent cases, once each; photo cases excluded):

| Run | Pass | Median | p90 | Cost/request | Calls/request |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline `a55d021` | 58/60 | 9.7 s | 39 s | US$ 0.0045 | 4 |
| Candidate `04e8db6` | 60/60 | 10.4 s | 35 s | US$ 0.0051 | 3 |
| Candidate `7907cab` (delivered) | 59/60 | 12.2 s | 44 s | US$ 0.0063 | 4 |

The corpus shows no regression in pass rate but a cost: requests at the product limit (`lim-01`, `lim-02`, `lim-04`) are now built at the limit, as those cases expect, where the baseline answered without building; that adds calls. The single miss in the delivered run is `op-01` (two option variants ended at the same price, 27 calls); it passed in the `04e8db6` run and 3/3 in a targeted recheck, so I treat it as unstable rather than fixed.

Raw results, with each row's step trace, start and final state hashes and the final design, are in `docs/plans/evidence/runs/`; per-run comparisons in `docs/plans/evidence/comparacao-{A,B,C}.md`; model recordings for offline replay in `bench/fixtures/agent-baseline*` and `bench/fixtures/agent-final-*`. Rebuild a table with `npx tsx bench/compare-redesign.mjs --base … --judge … --cand …`.

### Deterministic regression coverage

`npm test` (283 tests), `npm run lint` and `npx tsc --noEmit` pass. New tests cover: timeout with a valid draft (kept as partial, reply lists what was saved) and with an invalid one (rolled back, reply says so); a draft discarded mid-turn not appearing in `appliedOperations`; an interruption through the real `/api/chat` route (request id, step trace, cause `cancelled`, `committed: none`, nothing saved); a text-only reply still checked; wrong sheet thickness and count in a reply; TV backing vs blocking; wall pinning and undo restoring the room; placement around the TV, conflicts with free space, appliance void, door conflict, auto-connection chains; `modify` removal and row height; interior layouts including a door over shelves; the wall shelf limits; stale preview and "shown to you" claims.

### Verification state (per the checkpoint's vocabulary)

Scope is always "this scenario, at `7907cab`, on the retained states recorded in `candidato-C-composicao.json`".

| Scenario | State | Evidence |
| --- | --- | --- |
| Creative TV composition (`tv-01`) | **Needs review** | Automated checks pass 3/3 (panel and TV unchanged in the world, screen clear with 30 mm, additions on the panel, fit, undo). Human visual review pending. |
| Unseen TV variation (`tv-02`), held-out TV on a plain wall (`tv-03`) | **Needs review** | Same checks, 3/3 each. |
| Material and sheet optimisation (`mat-01`) | **Verified** | 3/3: one material, fewer sheets than the start, reply consistent with the final cut plan. |
| Remove connected furniture (`rem-01`) | **Verified** | 3/3, no model-managed disconnects. |
| Replace the sole module (`rep-01`) | **Verified** | 3/3, no empty-project error. |
| Precise follow-up edits (`edit-01`, `coz-04`) | **Verified** | 3/3 each; unrelated modules unchanged; the counter height applies to the whole shared row. |
| Timeout after draft changes | **Verified** (deterministic) | `tests/agent-lifecycle.test.ts`: valid draft kept as partial with an accurate reply; invalid draft rolled back with an accurate reply. |
| Undo draft, then build another design | **Verified** (deterministic) | Reverted operations excluded from `appliedOperations`; one undo returns to the start. |
| Impossible or unsupported request (`imp-01`, `gr-02`) | **Verified** | 3/3 each: limits explained, nothing protected changed, no false claims. |
| Interrupted response | **Verified** (deterministic, real route) | Request id, step trace, cause `cancelled`, `committed: none`, nothing saved. |
| Kitchen addition, layout and fit (`coz-01` to `coz-03`), laundry (`lav-01`, `lav-02`), wardrobe (`gr-01`), shelving (`est-10`), office wall (`esc-01`) | **Needs review** | Automated checks pass 3/3 each; composition quality needs a person. |
| Default model Luna `high` | **Verified** | `/api/health` reports `luna`/`high`; picker screenshot; `tests/models.test.ts`. |

Nothing here is "the agent works": these are named scenarios on recorded states. Any later change to the agent code or prompt makes them **Stale** until re-run.

## 4. Screenshots

All from the running app (an isolated dev server on port 4312 with its own data directory, so the real projects were not touched), in `docs/plans/evidence/`:

- `tv-tapada-veredito-escuro.png`, `tv-tapada-veredito-claro.png`: the saved TV result that the old validator passed; now "Não cabe: o módulo Nicho de destaque fica na frente da TV 55"" and the screen turns red.
- `preview-antes-so-movel.png` → `preview-agora-com-cena.png`: what `render_look` sent the model for the same failing baseline result, before and after.
- `resposta-chapas-3-para-2.png`, `resposta-parcial-claro.png`, `resposta-interrompida.png`: app-owned facts, a partial turn, and the diagnostics kept for an interrupted one.
- `prateleiras-de-parede.png`, `prateleira-propriedades.png`: the new wall shelf in the scene and in the side panel.
- `modelo-luna-padrao.png`: the picker with GPT-6 Luna marked as the default.
- `galeria/`: the actual retained result of run 1 for eight cases, baseline and candidate side by side, front view in the running app (`base-tv-02.png` shows the red, blocked TV; `candidato-tv-02.png` the same request with the screen clear). This is the input for the pending human review.

## 5. Limitations and risks

- **Sample size.** Three runs per case and one run per corpus case. Differences of one run per case are within the variance seen between repeated runs (for example `est-10`, `uni-02`). Increase repetitions before strong reliability claims, as the checkpoint says.
- **The oracle is mine.** It is independent of the app's validator, but it was written by the same person who wrote the candidate. Its rules are explicit in `bench/oracle.mjs`; a reviewer should read them. It checks hard rules and factual contradictions, not beauty or usefulness.
- **No human review yet.** Composition quality ("coerente e útil") needs a person. The gallery (section 4) is the input for that review; my own look at it is not a substitute.
- **Clearance and rules are product choices.** The TV clearance is 30 mm (50 mm would reject a 55" TV between the "rack com torres" towers, which were already overlapping it by 15 mm on each side; that template's example TV now scales to the gap). Doors, windows and columns may not be covered at all; outlets may. These are defensible defaults, not measured user preferences.
- **Old persisted "deepseek".** The previous app only saved the model on an explicit pick, so a stored `deepseek` cannot be proven to be the old default. Treating it as the old default follows the product decision to move to Luna; anyone who explicitly picks DeepSeek again keeps it (new key).
- **Wall pinning.** When a turn changes the furniture and at least one module from the start stays in place, the wall is anchored where it was. This fixes the TV "moving" with the furniture; a turn that replaces everything still lets the wall follow, as before.
- **Wall shelf.** Geometry only: no bracket hardware in the quote beyond the existing per-module kit, no sag check, no load claims. It is not offered as a table or work surface.
- **Door over shelves.** Supported for doors; drawers still need their own compartment. Old projects with legacy shelves (`sh-N`) cannot get a door over them (the old shelves reach the front edge).
- **Tool surface.** Still 32 tools. Not measured with a smaller model than Luna; the brief's premise (small models) is only partly tested here, because the product decision fixed Luna as the model to measure.
- **Photo path.** Photo requests still use the legacy single-call path; not part of this work, and its two bench cases were not compared (the baseline worktree had no photos).
- **After run C** only `bec1b75` changed agent code (`room_set` tolerates a room without `schemaVersion`, which only a bench fixture had); it is covered by the unit suite, not by a live run.

## 6. Next steps supported by the evidence

1. **Human review of the gallery**, blind where possible (shuffle baseline and candidate), scoring request alignment, coherence and plausibility. Accept or reject the creative claim on that, not on the oracle.
2. **More held-out cases before a broad claim**, especially bathrooms, home office and L-shaped corners (rotated modules are not covered by `place` yet: it only builds unrotated boxes).
3. **Tool subsetting by intent** (the router already classifies intent): measure calls and quality with a smaller model, now that construction no longer depends on the model doing arithmetic.
4. **Appliance concepts beyond a reserved void**: fridge, stove and washer dimensions and clearances as first-class objects, validated like the TV.
5. **Photo requests through the new tools**, so copying a layout from a photo also stops depending on hand-computed coordinates.
6. **Carry the facts line into exports** (PDF) so the printed quote and the chat always cite the same state.
