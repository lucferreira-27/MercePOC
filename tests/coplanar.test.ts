import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { assetById, assets, buildAsset } from '../lib/assets';
import { generateComposition } from '../lib/composition';
import { coplanarFaces, partBoxes, type SceneBox } from '../lib/coplanar';
import { fittingsOf } from '../lib/fittings';
import { STYLE_IDS } from '../lib/look';
import { buildFittings } from '../lib/scene-fittings';

/**
 * Z-fighting: nenhuma face da cena pode ficar no mesmo plano, para o mesmo
 * lado, de uma face de outra cor. O contorno de aço do industrial ficava rente
 * às laterais e ao tampo, e a cena piscava em dente de serra ao girar.
 */
type V3 = [number, number, number];

/** As caixas de ferragem como a cena desenha (com a pele de `buildFittings`). */
function fittingBoxes(group: THREE.Group): SceneBox[] {
  group.updateMatrixWorld(true);
  const out: SceneBox[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BoxGeometry)) return;
    const b = new THREE.Box3().setFromObject(mesh);
    out.push({ id: `ferragem ${out.length}`, color: (mesh.material as THREE.MeshStandardMaterial).color.getHexString(), min: b.min.toArray() as V3, max: b.max.toArray() as V3 });
  });
  return out;
}

function sceneFaces(asset: string, want: Parameters<typeof buildAsset>[1]) {
  const d = buildAsset(assetById(asset)!, want);
  const parts = generateComposition(d, false).parts;
  const built = buildFittings(fittingsOf(d, parts));
  try {
    return coplanarFaces([...partBoxes(parts), ...fittingBoxes(built.group)]);
  } finally {
    built.dispose();
  }
}

void test('nenhum móvel, em nenhum estilo, tem faces de cores diferentes no mesmo plano', () => {
  for (const a of assets)
    for (const style of [undefined, ...STYLE_IDS])
      for (const size of [a.size.default, a.size.max]) {
        const found = sceneFaces(a.id, { ...size, ...(style ? { style } : {}) });
        assert.deepEqual(
          found.slice(0, 3).map((c) => `${c.a} × ${c.b} (${'xyz'[c.axis]}, ${Math.round(c.area)} mm²)`),
          [],
          `${a.id} ${style ?? 'sem estilo'} ${size.width}×${size.height}×${size.depth}: ${found.length} faces empatadas`,
        );
      }
});

void test('a conferência acha o contorno de aço rente à lateral quando a cena não tem a pele', () => {
  // O mesmo móvel com os tubos na medida do dado, sem a pele: o defeito do vídeo.
  const d = buildAsset(assetById('estante')!, { style: 'industrial' });
  const parts = generateComposition(d, false).parts;
  const tubes = fittingsOf(d, parts).filter((f) => f.kind === 'frame');
  assert.ok(tubes.length >= 8, 'o industrial tem contorno de aço');
  const raw: SceneBox[] = tubes.map((f) => {
    const c = Math.abs(Math.cos(f.rotation)),
      s = Math.abs(Math.sin(f.rotation));
    const half: V3 = [(f.size[0] * c + f.size[2] * s) / 2, f.size[1] / 2, (f.size[0] * s + f.size[2] * c) / 2];
    return { id: f.id, color: f.color.replace('#', '').toLowerCase(), min: f.position.map((p, k) => p - half[k]!) as V3, max: f.position.map((p, k) => p + half[k]!) as V3 };
  });
  const found = coplanarFaces([...partBoxes(parts), ...raw]);
  assert.ok(found.length > 0, 'tubo rente à lateral, de outra cor, tem de aparecer');
  assert.ok(found.every((c) => [c.a, c.b].some((id) => id.includes(':frame-'))));
  // E a cena, com a pele, não tem nenhum.
  assert.deepEqual(sceneFaces('estante', { style: 'industrial' }), []);
});

void test('faces encostadas de costas, ou da mesma cor, não contam', () => {
  const box = (id: string, color: string, min: V3, max: V3): SceneBox => ({ id, color, min, max });
  // Pé embaixo da caixa: o topo do pé e o fundo da caixa se encostam virados um para o outro.
  assert.deepEqual(coplanarFaces([box('caixa', 'aaaaaa', [0, 100, 0], [500, 600, 400]), box('pé', '222222', [10, 0, 10], [40, 100, 40])]), []);
  // Duas chapas iguais lado a lado no mesmo plano: mesma cor, nada pisca.
  assert.deepEqual(coplanarFaces([box('a', 'aaaaaa', [0, 0, 0], [18, 700, 400]), box('b', 'aaaaaa', [0, 0, 0], [18, 700, 400])]), []);
  // Tubo preto rente à lateral de madeira: pisca.
  assert.equal(coplanarFaces([box('lateral', 'c8a27a', [0, 0, 0], [18, 700, 400]), box('tubo', '1e1e1e', [0, 0, 0], [20, 700, 20])]).length > 0, true);
});
