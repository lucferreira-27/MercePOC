import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaults, generate } from '../lib/furniture';
import { get, save } from '../lib/store';
import { generateDesign } from '../lib/studio';
const dir = mkdtempSync(join(tmpdir(), 'merce-migrate-modules-'));
process.env.MERCE_DATA_DIR = dir;
void test('v1 migration backs up consistent SQLite, preserves all revisions, messages and resolvable IDs', () => {
  const db = new DatabaseSync(join(dir, 'merce.sqlite'));
  db.exec(
    'CREATE TABLE projects(id TEXT PRIMARY KEY,body TEXT,version INTEGER,updated TEXT)',
  );
  const old = {
    id: 'legacy-fixture',
    name: 'Projeto antigo',
    version: 0,
    cursor: 1,
    revisions: [
      {
        id: 'revision-a',
        number: 1,
        params: defaults,
        label: 'Original',
        at: '2026-09-01',
      },
      {
        id: 'revision-b',
        number: 2,
        params: { ...defaults, width: 950 },
        label: 'Largura',
        at: '2026-09-02',
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'Aumente para 950 mm',
        revisionId: 'revision-a',
      },
      { role: 'assistant', content: 'Feito', revisionId: 'revision-b' },
    ],
  };
  db.prepare('INSERT INTO projects VALUES(?,?,0,?)').run(
    old.id,
    JSON.stringify(old),
    '2026-09-02',
  );
  db.close();
  const first = get(old.id),
    second = get(old.id);
  assert.deepEqual(first, second);
  assert.equal(first.revisions[1].id, 'revision-b');
  assert.deepEqual(
    first.messages.map((m) => m.content),
    old.messages.map((m) => m.content),
  );
  for (let i = 0; i < old.revisions.length; i++) {
    const before = generate(old.revisions[i].params).parts,
      after = generateDesign(first.revisions[i].params).parts;
    assert.equal(before.length, after.length);
    before.forEach((part, index) => {
      part.size.forEach((v, k) =>
        assert.ok(Math.abs(v - after[index].size[k]) < 1e-6),
      );
      part.position.forEach((v, k) =>
        assert.ok(Math.abs(v - after[index].position[k]) < 1e-6),
      );
    });
  }
  const backup = join(dir, 'merce-before-modules.sqlite');
  assert.ok(existsSync(backup));
  const snapshot = new DatabaseSync(backup);
  assert.equal(
    Object.values(snapshot.prepare('PRAGMA integrity_check').get()!)[0],
    'ok',
  );
  assert.equal(
    JSON.parse(
      (snapshot.prepare('SELECT body FROM projects').get() as { body: string })
        .body,
    ).revisions[0].params.schemaVersion,
    undefined,
  );
  snapshot.close();
  save(first, 0);
  const loaded = get(old.id);
  assert.equal(loaded.revisions[0].params.schemaVersion, 3);
  assert.equal(loaded.messages[0].id, first.messages[0].id);
  assert.equal(loaded.revisions[1].params.modules[0].width, 950);
});
