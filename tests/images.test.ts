import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { imageBytes, saveImage } from '../lib/images';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-images-'));

void test('reference images are validated and normalized to WebP', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const image = await saveImage(png, 'room/reference.png');
  assert.equal(image.name, 'roomreference.png');
  assert.match(image.url, /^\/api\/images\?id=[0-9a-f-]+$/);
  const normalized = await imageBytes(image.id);
  assert.equal(normalized.toString('ascii', 0, 4), 'RIFF');
  await assert.rejects(() => saveImage(Buffer.from('not an image'), 'bad.bin'));
});
