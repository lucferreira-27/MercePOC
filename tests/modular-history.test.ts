import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  create,
  get,
  revise,
  save,
  seek,
  fork,
  applyRequest,
} from '../lib/store';
import { normalize, cutCSV } from '../lib/studio';
import { PROFILE, preset } from '../lib/composition';
process.env.MERCE_DATA_DIR = mkdtempSync(
  join(tmpdir(), 'merce-modular-history-'),
);
void test('complete composition survives seek, redo, alternative, reload and atomic failure', () => {
  const p = get(create().id);
  revise(
    p,
    normalize({
      schemaVersion: 3,
      profile: PROFILE,
      modules: [preset('niche', 'a')],
      connections: [],
    }),
    'Base',
  );
  assert.ok(
    applyRequest(
      p,
      [
        { kind: 'module.add', id: 'b', preset: 'niche' },
        {
          kind: 'connect',
          parent: 'a',
          child: 'b',
          side: 'right',
          shared: true,
          align: 'back',
          offset: 0,
        },
        { kind: 'front.set', id: 'a:root', type: 'drawers', count: 3 },
      ],
      'Composição',
    ).ok,
  );
  save(p, p.version);
  const expected = structuredClone(p.revisions[p.cursor].params),
    revisionId = p.revisions[p.cursor].id,
    csv = cutCSV(expected);
  seek(p, 0);
  save(p, p.version);
  assert.equal(get(p.id).revisions[0].params.modules.length, 1);
  seek(p, 2);
  save(p, p.version);
  assert.deepEqual(get(p.id).revisions[2].params, expected);
  const alt = fork(p.id, 2, 'Alternativa modular');
  assert.deepEqual(alt.params, expected);
  assert.equal(alt.revisions[2].id, revisionId);
  assert.equal(cutCSV(alt.params), csv);
  const before = JSON.stringify(p);
  assert.equal(
    applyRequest(
      p,
      [
        { kind: 'module.edit', id: 'a', name: 'New' },
        { kind: 'module.edit', id: 'b', height: 3000 },
      ],
      'Falha',
    ).ok,
    false,
  );
  assert.equal(JSON.stringify(p), before);
});
