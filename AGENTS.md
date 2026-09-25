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

## Commands

- `npm test`. node:test suite via tsx (must stay green)
- `npm run lint`. oxlint over app/lib/components/hooks/tests
- `npx tsc --noEmit`. typecheck (includes `work/` scratch files)
- `npm run dev`. dev server on :4310 for visual checks
- Depois de `npm run build`, reinicie o servidor antes de verificar: o `vinext start` continua servindo o pacote antigo e a página trava em "Montando o estúdio" (o cliente não hidrata)
