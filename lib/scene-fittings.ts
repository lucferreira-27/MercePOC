import * as THREE from 'three';
import type { Fitting } from './fittings';
import { categoryOf } from './furniture';

/**
 * Ferragens e estrutura na cena: pés de cada tipo, rodízios, base trenó,
 * estrutura e contorno de aço e fita de LED. Cada peça é um grupo centrado na
 * caixa dela, girado com o módulo, e anda junto quando o móvel é arrastado
 * (`userData.home` + o deslocamento do arrasto). Puxadores ficam com as
 * frentes, na animação de abrir (`FurnitureMotion`).
 */
type Disposable = { dispose: () => void };

/** Material de cada ferragem: metal brilha, madeira é fosca, LED acende. */
function materialFor(f: Fitting, cache: Map<string, THREE.Material>, disposables: Disposable[]) {
  const metal = !!f.materialId && categoryOf(f.materialId) === 'metal';
  const key = `${f.kind}:${f.color}:${metal}`;
  let m = cache.get(key);
  if (!m) {
    m =
      f.kind === 'led'
        ? new THREE.MeshStandardMaterial({ color: f.color, emissive: '#ffd08a', emissiveIntensity: 1.4, roughness: 0.4 })
        : new THREE.MeshStandardMaterial({
            color: f.color,
            metalness: metal ? (f.materialId === 'steel-black' ? 0.55 : 0.85) : 0,
            roughness: metal ? (f.materialId === 'steel-black' ? 0.45 : 0.3) : 0.55,
          });
    cache.set(key, m);
    disposables.push(m);
  }
  return m;
}

/** Cilindro de `a` até `b` (mm, no referencial do grupo), raio de cima e de baixo. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, mat: THREE.Material, disposables: Disposable[]) {
  const dir = b.clone().sub(a);
  const geo = new THREE.CylinderGeometry(r0, r1, dir.length(), 18);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  // O cilindro nasce em pé (y): gira até apontar de `a` para `b`, de cima para baixo.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  return mesh;
}
function block(size: [number, number, number], at: [number, number, number], mat: THREE.Material, disposables: Disposable[]) {
  const geo = new THREE.BoxGeometry(...size);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...at);
  return mesh;
}

const BRASS = '#c7a14b';
/** Altura do travessão do cavalete, em fração da altura, a partir do centro: a longarina fica a 1/3 do piso. */
const TRESTLE_RAIL_Y = 1 / 3 - 1 / 2;

/** A forma da ferragem, centrada na caixa dela e no referencial do módulo. */
export function fittingShape(f: Fitting, mat: THREE.Material, disposables: Disposable[], cache: Map<string, THREE.Material>) {
  const g = new THREE.Group();
  const [w, h, d] = f.size;
  const top = h / 2,
    bottom = -h / 2;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (f.type) {
    case 'palito':
      g.add(rod(v(0, top, 0), v(0, bottom, 0), 17, 11, mat, disposables));
      break;
    case 'tapered':
      g.add(rod(v(0, top, 0), v(0, bottom, 0), 20, 12, mat, disposables));
      break;
    case 'splayed': {
      // Encaixe junto da caixa e ponta aberta para fora, com ponteira de latão.
      const [ax, az] = f.splay ?? [0, 0];
      const ox = Math.tan(ax) * h,
        oz = Math.tan(az) * h;
      const a = v(-ox / 2, top, -oz / 2),
        b = v(ox / 2, bottom, oz / 2);
      const tip = a.clone().lerp(b, 0.88);
      g.add(rod(a, tip, 19, 11, mat, disposables));
      const cap = materialFor({ ...f, kind: 'leg', color: BRASS, materialId: 'brass' }, cache, disposables);
      g.add(rod(tip, b, 11, 10, cap, disposables));
      break;
    }
    case 'block':
    case 'tube':
      g.add(block([w, h, d], [0, 0, 0], mat, disposables));
      break;
    case 'bun': {
      const geo = new THREE.SphereGeometry(w / 2, 24, 16);
      disposables.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.y = h / w;
      g.add(mesh);
      break;
    }
    case 'pipe':
      g.add(rod(v(0, top - 6, 0), v(0, bottom + 6, 0), 17, 17, mat, disposables));
      for (const y of [top - 3, bottom + 3]) g.add(rod(v(0, y + 3, 0), v(0, y - 3, 0), 36, 36, mat, disposables));
      break;
    case 'hairpin': {
      // Duas varetas de 10 mm que saem da chapa de cima e se encontram no piso.
      const spread = d - 12;
      g.add(block([40, 5, spread + 30], [0, top - 2.5, 0], mat, disposables));
      for (const z of [-spread / 2, spread / 2]) g.add(rod(v(0, top - 5, z), v(0, bottom, 0), 5, 5, mat, disposables));
      break;
    }
    case 'casters': {
      const r = Math.min(h * 0.38, 32);
      g.add(block([w, 5, d], [0, top - 2.5, 0], mat, disposables));
      g.add(block([10, h - 2 * r, 30], [0, top - 5 - (h - 2 * r) / 2 + 2, 0], mat, disposables));
      const tire = materialFor({ ...f, kind: 'leg', color: '#2b2b2b', materialId: null }, cache, disposables);
      const wheel = rod(v(-12, bottom + r, 0), v(12, bottom + r, 0), r, r, tire, disposables);
      g.add(wheel);
      break;
    }
    case 'sled':
      // U de tubo 40 × 20: duas colunas e a barra no piso, ao longo da profundidade.
      for (const z of [-d / 2 + 10, d / 2 - 10]) g.add(block([w, h, 20], [0, 0, z], mat, disposables));
      g.add(block([w, 20, d], [0, bottom + 10, 0], mat, disposables));
      break;
    case 'frame': {
      // Estrutura de aço: quatro colunas, o quadro que segura a caixa e outro perto do piso.
      const t = 20;
      // Colunas nas pontas e, numa fileira longa, as do meio.
      const columns = [-w / 2 + t / 2, ...(f.posts ?? []), w / 2 - t / 2];
      for (const x of columns) for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) g.add(block([t, h, t], [x, 0, z], mat, disposables));
      // Mesa e estrutura aberta: um quadro embaixo de cada nível.
      const rails = [top - t / 2, ...(f.levels ?? (h >= 200 ? [bottom + 60] : []))];
      for (const y of rails) {
        for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) g.add(block([w - 2 * t, t, t], [0, y, z], mat, disposables));
        for (const x of columns) g.add(block([t, t, d - 2 * t], [x, y, 0], mat, disposables));
      }
      break;
    }
    case 'turned': {
      // Pé torneado: anéis e bulbo ao longo do eixo, afinando para o piso.
      const profile: [number, number, number][] = [
        [0, 0.12, 30],
        [0.12, 0.16, 22],
        [0.16, 0.2, 32],
        [0.2, 0.55, 24],
        [0.55, 0.62, 34],
        [0.62, 0.92, 20],
        [0.92, 1, 26],
      ];
      for (const [a0, a1, r] of profile) g.add(rod(v(0, top - a0 * h, 0), v(0, top - a1 * h, 0), r, r * 0.92, mat, disposables));
      break;
    }
    case 'hook': {
      // Gancho: haste que sai da parede e sobe na ponta, com bolinha.
      g.add(rod(v(0, 6, -d / 2), v(0, 6, d / 2 - 12), 5, 5, mat, disposables));
      g.add(rod(v(0, 0, d / 2 - 12), v(0, h / 2 - 6, d / 2 - 8), 5, 5, mat, disposables));
      const ball = new THREE.SphereGeometry(8, 16, 12);
      disposables.push(ball);
      const tip = new THREE.Mesh(ball, mat);
      tip.position.set(0, h / 2 - 6, d / 2 - 8);
      g.add(tip);
      break;
    }
    case 'trestle':
      // Cavalete em H: duas colunas, a sapata no piso, a travessa embaixo do
      // tampo e o travessão entre as colunas, onde a longarina entra.
      for (const z of [-d / 2 + 60, d / 2 - 60]) g.add(block([60, h, 60], [0, 0, z], mat, disposables));
      g.add(block([w, 60, d], [0, bottom + 30, 0], mat, disposables));
      g.add(block([w, 60, d - 40], [0, top - 30, 0], mat, disposables));
      g.add(block([60, 70, d - 120], [0, f.levels?.[0] ?? TRESTLE_RAIL_Y * h, 0], mat, disposables));
      break;
    case 'wall':
      // Suporte de parede em L: chapa na parede e braço embaixo do tampo.
      g.add(block([w, h, 8], [0, 0, -d / 2 + 4], mat, disposables));
      g.add(block([w, 8, d], [0, top - 4, 0], mat, disposables));
      break;
    default:
      // Tubo do contorno, fita de LED, travessa do cavalete: a caixa da peça.
      g.add(block([w, h, d], [0, 0, 0], mat, disposables));
  }
  return g;
}

/** Grupo com todas as ferragens visíveis, menos os puxadores (que abrem com as frentes). */
export function buildFittings(fittings: readonly Fitting[]) {
  const group = new THREE.Group();
  group.name = 'ferragens';
  const disposables: Disposable[] = [];
  const cache = new Map<string, THREE.Material>();
  for (const f of fittings) {
    if (f.hidden || f.kind === 'handle') continue;
    const obj = fittingShape(f, materialFor(f, cache, disposables), disposables, cache);
    obj.position.set(...f.position);
    obj.rotation.y = f.rotation;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = f.kind !== 'led';
        o.receiveShadow = true;
      }
    });
    // O arrasto de um móvel leva as ferragens dele junto, a partir daqui.
    obj.userData = { moduleId: f.moduleId, home: obj.position.clone() };
    group.add(obj);
  }
  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Puxador na frente: um grupo com a origem no ponto de pegar (na face da
 * frente), desenhado na medida real. A cena prende o grupo na peça da frente,
 * então ele abre junto com a porta, a gaveta ou a folha de correr.
 */
export function handleShape(type: string, spec: { vertical: boolean; len: number; x: number }, materialId: string, color: string) {
  const disposables: Disposable[] = [];
  const machined = type === 'groove' || type === 'cutout';
  const metal = !machined && type !== 'strap';
  const material = new THREE.MeshStandardMaterial({
    color: type === 'strap' ? '#6b4a32' : machined ? '#1c1a18' : color,
    metalness: metal ? (materialId === 'steel-black' ? 0.55 : 0.85) : 0,
    roughness: metal ? (materialId === 'steel-black' ? 0.45 : 0.3) : machined ? 0.95 : 0.6,
  });
  disposables.push(material);
  const g = new THREE.Group();
  // Desenha deitado (ao longo de x) e gira para a porta, em pé.
  const body = new THREE.Group();
  const len = spec.len;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (type) {
    case 'knob': {
      body.add(rod(v(0, 0, 0), v(0, 0, 14), 5, 5, material, disposables));
      const head = new THREE.SphereGeometry(15, 20, 14);
      disposables.push(head);
      const mesh = new THREE.Mesh(head, material);
      mesh.scale.z = 0.62;
      mesh.position.z = 20;
      body.add(mesh);
      break;
    }
    case 'cup': {
      // Concha: meia cana aberta para baixo, presa numa chapinha.
      body.add(block([104, 36, 2], [0, 0, 1], material, disposables));
      const shell = new THREE.CylinderGeometry(15, 15, 96, 24, 1, true, 0, Math.PI);
      disposables.push(shell);
      const mesh = new THREE.Mesh(shell, material);
      mesh.material.side = THREE.DoubleSide;
      mesh.rotation.z = Math.PI / 2;
      mesh.rotation.y = -Math.PI / 2;
      mesh.position.set(0, 4, 3);
      body.add(mesh);
      break;
    }
    case 'edge':
      // Perfil na borda: aba na frente e capa por cima da borda da chapa.
      body.add(block([len, 26, 2], [0, -6, 1], material, disposables));
      body.add(block([len, 2, 20], [0, 8, -9], material, disposables));
      break;
    case 'groove':
      body.add(block([len, 18, 2], [0, 0, 1], material, disposables));
      break;
    case 'cutout':
      body.add(block([110, 32, 2], [0, 0, 1], material, disposables));
      break;
    case 'strap': {
      // Alça de couro: tira solta da frente, presa nas pontas com rebites.
      body.add(block([90, 26, 3], [0, 0, 12], material, disposables));
      for (const x of [-42, 42]) body.add(block([8, 26, 12], [x, 0, 6], material, disposables));
      const rivet = new THREE.MeshStandardMaterial({ color: '#c7a14b', metalness: 0.85, roughness: 0.3 });
      disposables.push(rivet);
      for (const x of [-42, 42]) body.add(rod(v(x, 0, 12), v(x, 0, 14.5), 3.5, 3.5, rivet, disposables));
      break;
    }
    default:
      // Barra com dois pés, como sempre foi.
      body.add(block([len, 12, 12], [0, 0, 26], material, disposables));
      for (const end of [-1, 1]) body.add(block([10, 10, 20], [end * (len / 2 - 10), 0, 10], material, disposables));
  }
  // Em pé, a borda do perfil aponta para o lado de fora da porta.
  if (spec.vertical) body.rotation.z = type === 'edge' && spec.x < 0 ? -Math.PI / 2 : Math.PI / 2;
  g.add(body);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = !machined;
  });
  return {
    group: g,
    material,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
