# AGENTS.md

## Working preferences

- Replace em dashes with a period to start a new sentence, or a comma to continue the sentence.
- Transform user requests into goals, except when the request is very small or the user says otherwise.

## UI verification is mandatory

Every visual change (layout, CSS, components, slider, viewport, overlays)
MUST be verified with a real screenshot from a running browser tab BEFORE
committing. No exceptions.

Checklist per change:
- Both ends of every slider/stepper, with short AND long labels.
- 1, few, and many revisions (dots, numbers, tooltip, chips).
- Preview active (chips/panel visible) vs idle. Card size must not shift.
- Overlaps: tooltips vs neighboring buttons, labels vs card edges.
- Compare against the mockup or previous screenshot when one exists.

## Branches and production

- `dev` is the development branch. Commit straight to `dev` and push it.
  Don't create feature branches or open PRs unless the user asks for one:
  side branches get forgotten and their work never reaches the app.
- If the session runs in a worktree on its own branch (the desktop app makes
  these under `.claude/worktrees/`), it still lands on `dev`. Before
  finishing, rebase onto `origin/dev`, run the checks, and
  `git push origin HEAD:dev`. Then fast-forward the `G:\MercePOC` checkout
  with `git -C G:/MercePOC pull --ff-only`. Never leave committed work only
  on the side branch.
- `main` is production. It only moves through a `dev` → `main` merge once the
  changes are tested and ready. Never commit or push directly to `main`
  (the private repo has no branch protection, so nothing else enforces this).
- There is no hosted deployment or CI. Production runs locally from a
  separate worktree at `G:\MercePOC-prod` that always stays on `main`, with
  its own `node_modules`, `dist/` and a copy of `.env`.
- To release: merge `dev` into `main`, then in `G:\MercePOC-prod` run
  `git pull`, `npm install` (if dependencies changed) and `npm run build`,
  and restart the server there with `Start-Merce.ps1`.
- Both folders serve on port 4310, so stop one server before starting the
  other. `Start-Merce.ps1` reuses whatever server already answers on 4310.

## Pull requests

Only when the user asks for one (see above). Then:

- Every PR includes at least one screenshot relevant to the feature, taken
  from the running app (the same captures used for UI verification). For a
  visual change show the new state, and before/after when it replaces
  something. For a behavior fix, show the screen where the fix is visible.
- Commit the images to `docs/pr/<PR number>/` on the PR branch, cropped to
  what matters and with descriptive names (`janela-escuro.png`).
- Embed them in the PR body with a link pinned to the commit, so they render
  on the private repo:
  `![descrição](https://github.com/lucferreira-27/MercePOC/blob/<sha>/docs/pr/<n>/arquivo.png?raw=true)`

## Commands

- `npm test`. node:test suite via tsx (must stay green)
- `npm run lint`. oxlint over app/lib/components/hooks/tests
- `npx tsc --noEmit`. typecheck (includes `work/` scratch files)
- `npm run dev`. dev server on :4310 for visual checks
- Depois de `npm run build`, reinicie o servidor antes de verificar: o `vinext start` continua servindo o pacote antigo e a página trava em "Montando o estúdio" (o cliente não hidrata)
