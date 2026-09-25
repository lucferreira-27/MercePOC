import * as THREE from 'three';
import type { Obstacle } from './room';
import type { RoomPalette } from './scene-room';

/**
 * Obstáculos da parede com cara do que são: porta com folha, almofadas,
 * dobradiças e maçaneta; janela com caixilho, vidro, travessas e peitoril;
 * tomada no padrão brasileiro de três furos; TV com moldura e LED; coluna com
 * rodapé. Cada um é um grupo com origem no canto de baixo à esquerda, na face
 * da parede: arrastar é só mudar a posição do grupo.
 */
type Kit = {
  palette: RoomPalette;
  theme: 'light' | 'dark';
  /** Cruza um módulo do móvel: pinta de vermelho a parte principal. */
  bad: boolean;
  /** Materiais e geometrias criados aqui entram na lista para descarte. */
  track: (d: { dispose: () => void }) => void;
};

const LEAF = { light: '#d8ccb6', dark: '#4a4d53' };
const LEAF_PANEL = { light: '#cdbfa6', dark: '#43464b' };
const METAL = { light: '#b8bec4', dark: '#9aa2aa' };

export function buildObstacle(o: Obstacle, kit: Kit) {
  const g = new THREE.Group();
  g.name = `obstáculo ${o.id}`;
  g.userData.obstacleId = o.id;
  const { palette: c, theme, bad, track } = kit;
  const w = o.widthMm,
    h = o.heightMm;
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
    track(m);
    return m;
  };
  const metal = mat(METAL[theme], { roughness: 0.3, metalness: 0.75 });
  /** Caixa pelo canto: x e y a partir do canto de baixo à esquerda, z da parede. */
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material, shadow = false) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    track(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x + sx / 2, y + sy / 2, z + sz / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    g.add(mesh);
    return mesh;
  };
  const disc = (x: number, y: number, z: number, r: number, depth: number, m: THREE.Material) => {
    const geo = new THREE.CylinderGeometry(r, r, depth, 24);
    track(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z + depth / 2);
    g.add(mesh);
    return mesh;
  };
  const trim = mat(c.trim, { roughness: 0.6 });
  if (o.kind === 'door') {
    // Vão escuro, batente em volta e a folha fechada um pouco recuada.
    box(0, 0, 0, w, h, 4, mat(theme === 'dark' ? '#151618' : '#cfc6b8'));
    box(-50, 0, 0, 50, h + 50, 40, trim);
    box(w, 0, 0, 50, h + 50, 40, trim);
    box(-50, h, 0, w + 100, 50, 40, trim);
    const leaf = mat(bad ? c.bad : LEAF[theme], { roughness: 0.7 });
    box(8, 4, 4, w - 16, h - 12, 34, leaf, true);
    // Duas almofadas em relevo: é o que faz a folha parecer porta.
    const panel = mat(bad ? c.bad : LEAF_PANEL[theme], { roughness: 0.7 });
    const px = Math.min(110, w * 0.14);
    const top = h * 0.55;
    box(px, top, 38, w - 2 * px, h - top - 120, 6, panel);
    box(px, 140, 38, w - 2 * px, top - 260, 6, panel);
    // Dobradiças à esquerda e a maçaneta com espelho do outro lado, a 1 m.
    for (const y of [220, h / 2, h - 300]) box(2, y, 30, 10, 90, 14, metal);
    const kx = w - Math.min(80, w * 0.12);
    const ky = Math.min(1000, h * 0.5);
    box(kx - 22, ky - 70, 38, 44, 140, 6, metal);
    disc(kx, ky, 44, 26, 40, metal);
    const knob = new THREE.SphereGeometry(30, 20, 14);
    track(knob);
    const ball = new THREE.Mesh(knob, metal);
    ball.position.set(kx, ky, 96);
    ball.castShadow = true;
    g.add(ball);
  } else if (o.kind === 'window') {
    // Caixilho, vidro recuado, travessa e montante, e o peitoril saliente.
    box(-30, -30, 0, w + 60, h + 60, 14, trim);
    box(0, 0, 12, w, h, 4, mat(bad ? c.bad : c.glass, { roughness: 0.08, metalness: 0.3 }));
    // Pouco saliente: caixilho 3 cm e peitoril 6 cm para fora da parede,
    // como no real; mais que isso cortava o móvel encostado embaixo.
    box(-30, -30, 18, w + 60, 40, 14, trim);
    box(-30, h - 10, 18, w + 60, 40, 14, trim);
    box(-30, -30, 18, 40, h + 60, 14, trim);
    box(w - 10, -30, 18, 40, h + 60, 14, trim);
    box(w / 2 - 12, 0, 18, 24, h, 10, trim);
    box(0, h * 0.62, 18, w, 22, 10, trim);
    box(-60, -54, 0, w + 120, 24, 60, trim, true);
    // Reflexo diagonal no vidro, bem discreto.
    const shine = mat('#ffffff', { transparent: true, opacity: theme === 'dark' ? 0.08 : 0.22, depthWrite: false });
    for (const [sx, sw] of [
      [0.18, 0.08],
      [0.3, 0.04],
    ] as const) {
      const geo = new THREE.PlaneGeometry(w * sw, h * 0.5);
      track(geo);
      const m = new THREE.Mesh(geo, shine);
      m.position.set(w * sx + w * 0.1, h * 0.35, 17);
      m.rotation.z = -0.5;
      g.add(m);
    }
  } else if (o.kind === 'outlet') {
    // Tomada padrão brasileiro: espelho branco, rebaixo redondo e três furos.
    const pw = Math.max(w, 60),
      ph = Math.max(h, 60);
    const ox = (w - pw) / 2,
      oy = (h - ph) / 2;
    box(ox, oy, 0, pw, ph, 10, mat(bad ? c.bad : '#f7f6f2', { roughness: 0.45 }), true);
    const r = Math.min(pw, ph) * 0.3;
    disc(w / 2, h / 2, 9, r, 3, mat('#d9d7d1', { roughness: 0.5 }));
    const hole = mat('#2a2b2d', { roughness: 0.9 });
    const d = r * 0.42;
    disc(w / 2 - d, h / 2 - d * 0.35, 11.5, 3.6, 1, hole);
    disc(w / 2 + d, h / 2 - d * 0.35, 11.5, 3.6, 1, hole);
    disc(w / 2, h / 2 + d * 0.6, 11.5, 3.6, 1, hole);
  } else if (o.kind === 'tv') {
    // Suporte na parede, corpo fino, tela quase espelhada e o LED aceso.
    box(w * 0.3, h * 0.3, 0, w * 0.4, h * 0.4, 18, mat('#2a2c30', { roughness: 0.5, metalness: 0.4 }));
    box(0, 0, 18, w, h, 30, mat(theme === 'dark' ? '#0c0d0f' : '#17191c', { roughness: 0.4, metalness: 0.2 }), true);
    box(10, 14, 48, w - 20, h - 24, 2, mat(theme === 'dark' ? '#1b2129' : '#262c35', { roughness: 0.06, metalness: 0.4 }));
    const glare = mat('#ffffff', { transparent: true, opacity: 0.06, depthWrite: false });
    const geo = new THREE.PlaneGeometry(w * 0.35, h * 0.9);
    track(geo);
    const m = new THREE.Mesh(geo, glare);
    m.position.set(w * 0.3, h * 0.5, 51);
    m.rotation.z = -0.35;
    g.add(m);
    box(w - 60, 5, 48, 10, 4, 2, mat('#ff4a3d', { emissive: '#ff4a3d', emissiveIntensity: 0.8 }));
  } else if (o.kind === 'column') {
    // Coluna saindo da parede, com rodapé em volta e quina marcada.
    // Um tom mais claro que a parede: da cor da lateral, sumia no escuro.
    box(0, 0, 0, w, h, 300, mat(bad ? c.bad : theme === 'dark' ? '#3a3d42' : '#e4ddd1'), true);
    box(-6, 0, 0, w + 12, 80, 306, trim);
    box(-2, 0, 298, 4, h, 4, mat(theme === 'dark' ? '#1c1d20' : '#d7d0c4'));
    box(w - 2, 0, 298, 4, h, 4, mat(theme === 'dark' ? '#1c1d20' : '#d7d0c4'));
  } else {
    // Obstáculo genérico: volume translúcido com contorno, para não fingir
    // ser algo que não é.
    const m = box(0, 0, 0, w, h, 60, mat(bad ? c.bad : c.side, { transparent: true, opacity: 0.75 }));
    const edges = new THREE.EdgesGeometry(m.geometry);
    track(edges);
    const line = new THREE.LineBasicMaterial({ color: theme === 'dark' ? '#8a9098' : '#9b9384' });
    track(line);
    m.add(new THREE.LineSegments(edges, line));
  }
  return g;
}
