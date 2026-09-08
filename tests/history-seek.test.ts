import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaults } from '../lib/furniture';
import { create, createDemo, get, revise, save, seek, view } from '../lib/store';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-history-'));

void test('history seek changes the active revision without deleting future versions', () => {
  const created = create();
  const project = get(created.id);
  const start = project.revisions.length;
  revise(project, { ...defaults, width: 1000 }, 'Largura');
  save(project, 0);
  const beforeSeek = get(created.id);
  seek(beforeSeek, 0);
  const restored = save(beforeSeek, beforeSeek.version);
  assert.equal(restored.cursor, 0);
  assert.equal(restored.revisions.length, start + 1);
  assert.equal(view(get(created.id)).params.width, defaults.width);
  assert.throws(() => seek(get(created.id), 99));
});
void test('new projects start with a demo walkthrough at the latest revision', () => {
  const raw = get(createDemo().id);
  assert.equal(raw.revisions.length, 6);
  assert.equal(raw.cursor, raw.revisions.length - 1);
  assert.equal(raw.revisions[0].label, 'Estante inicial');
  assert.deepEqual(
    raw.revisions.map((r) => r.number),
    raw.revisions.map((_, i) => i + 1),
  );
});
