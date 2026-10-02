import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { PROFILE, applyModularOp, generateComposition, preset, type Composition } from '../lib/composition';
import { planPng, planSvg } from '../lib/plan-render';

/**
 * Na Cloudflare a vista que a IA recebe é rasterizada pelo resvg (WASM), não
 * pelo sharp. O mesmo SVG tem de sair no mesmo tamanho e com as mesmas cores,
 * senão a IA compara a foto com um desenho diferente do que o Node mandava.
 */
const require = createRequire(import.meta.url);

function parts() {
  let d: Composition = { schemaVersion: 4, profile: PROFILE, modules: [preset('niche', 'a')], connections: [] };
  for (const op of [
    { kind: 'module.edit', id: 'a', width: 1200, height: 2000, depth: 450 },
    { kind: 'cell.split', id: 'a:root', axis: 'y', gapMm: 700 },
    { kind: 'front.set', id: 'a:root:low', type: 'drawers', count: 2 },
  ] as const)
    d = applyModularOp(d, op);
  return generateComposition(d).parts;
}

function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

void test('o resvg do Worker desenha a vista no mesmo tamanho que o sharp', async () => {
  await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const svg = planSvg(parts());
  const wasm = new Resvg(svg).render().asPng();
  const node = await planPng(parts());
  assert.equal(Buffer.from(wasm).toString('latin1', 1, 4), 'PNG');
  assert.deepEqual(pngSize(wasm), pngSize(node));
  // Um desenho vazio (SVG sem formas reconhecidas) comprime em poucos bytes.
  assert.ok(wasm.length > 2000, `PNG pequeno demais: ${wasm.length} bytes`);
});
