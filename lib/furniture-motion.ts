import * as THREE from 'three';
import { materials, type Part } from './furniture';
import { DIFF_GLOW, finishTexture, panelUV, SELECTION_GLOW } from './scene-materials';

/**
 * Diff na cena: peças que entraram brilham em verde, as que mudaram em âmbar
 * e o resto esmaece para a mudança saltar aos olhos. `focus` é a linha da
 * conversa sob o cursor: só as peças dela ficam acesas. `dim: false` só
 * acende, sem esmaecer o resto: o móvel sendo montado ao vivo fica sólido.
 */
export type SceneDiff = {
  added: ReadonlySet<string>;
  changed: ReadonlySet<string>;
  focus?: ReadonlySet<string> | null;
  dim?: boolean;
};
/**
 * Arestas: discretas em repouso, na cor de destaque quando o cursor passa ou a
 * peça está selecionada. Antes a aresta escura a 25% desenhava cada painel como
 * um desenho técnico e achatava o volume.
 */
export const EDGE = {
  rest: '#2a2520',
  restOpacity: 0.14,
  hot: '#3f8f5a',
  hotOpacity: 0.9,
} as const;
export const TRANSITION_MS = 750;
export const SCRUB_MS = 140;
export const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
type Pose = {
  rotation: number;
  position: THREE.Vector3;
  size: THREE.Vector3;
  color: THREE.Color;
  opacity: number;
};
/**
 * Puxador de porta ou gaveta. O grupo é filho da frente (gira e abre junto)
 * e desfaz a escala da caixa unitária a cada quadro, então a barra fica com a
 * medida real em mm em qualquer tamanho de frente.
 */
type Handle = { group: THREE.Group; local: THREE.Vector3; material: THREE.MeshStandardMaterial; key: string };

/** Onde vai o puxador, no espaço da própria frente (mm a partir do centro). */
export function handleSpec(part: Part & { motion?: { type: string; pivot: [number, number, number] }; rotation?: number }) {
  const m = part.motion;
  if (!m) return null;
  const [w, h, t] = part.size;
  if (m.type === 'drawer') {
    // A gaveta inteira abre junto (laterais, fundo, traseira): só a frente
    // leva puxador.
    if (!part.id.endsWith(':front')) return null;
    const len = THREE.MathUtils.clamp(w * 0.35, 96, 224);
    return { vertical: false, len, x: 0, y: h > 260 ? h / 2 - 90 : 0, z: t / 2 };
  }
  // Porta: do lado oposto à dobradiça, que é o pivô da abertura.
  const rot = part.rotation ?? 0;
  const dx = m.pivot[0] - part.position[0],
    dz = m.pivot[2] - part.position[2];
  const localX = dx * Math.cos(rot) - dz * Math.sin(rot);
  const side = localX > 0 ? -1 : 1;
  const len = THREE.MathUtils.clamp(h * 0.22, 96, 192);
  const bottom = part.position[1] - h / 2;
  // Porta alta: puxador a ~1 m do piso; baixa ou aérea, no meio.
  const y = h > 900 ? THREE.MathUtils.clamp(1000 - bottom - h / 2, -h / 2 + len, h / 2 - len) : 0;
  return { vertical: true, len, x: side * (w / 2 - 45), y, z: t / 2 };
}

type AnimatedPart = {
  handle?: Handle;
  pivot?: THREE.Vector3;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edge: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  from: Pose;
  to: Pose;
  started: number;
  duration: number;
  exiting: boolean;
  finish?: string;
  sizeKey?: string;
  selected?: boolean;
};
/**
 * Centro geométrico de cada módulo. Explodir em torno do centro do próprio
 * módulo é o que separa as peças umas das outras: em torno da origem do
 * projeto, módulos distantes só deslizavam para o lado sem se abrir.
 */
export function moduleCentres(parts: readonly Part[]) {
  const boxes = new Map<string, { min: number[]; max: number[] }>();
  for (const part of parts) {
    const key = (part as { owners?: string[] }).owners?.[0] ?? 'módulo';
    const half = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2];
    const box = boxes.get(key);
    if (box)
      for (const axis of [0, 1, 2]) {
        box.min[axis] = Math.min(box.min[axis], part.position[axis] - half[axis]);
        box.max[axis] = Math.max(box.max[axis], part.position[axis] + half[axis]);
      }
    else
      boxes.set(key, {
        min: [0, 1, 2].map((axis) => part.position[axis] - half[axis]),
        max: [0, 1, 2].map((axis) => part.position[axis] + half[axis]),
      });
  }
  return new Map(
    [...boxes].map(([key, box]) => [
      key,
      new THREE.Vector3(
        ...([0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2) as [
          number,
          number,
          number,
        ]),
      ),
    ]),
  );
}
/**
 * Cada peça se afasta do centro do seu módulo na própria direção: laterais
 * para os lados, tampo para cima, fundo para trás e prateleiras para cima e
 * para baixo. Nenhuma peça fica presa dentro das outras.
 */
export function visualPosition(
  part: Part,
  centre: THREE.Vector3,
  exploded: boolean,
) {
  const p = new THREE.Vector3(...part.position);
  if (!exploded) return p;
  const direction = p.clone().sub(centre);
  if (direction.lengthSq() < 1) direction.set(0, 1, 0);
  return p.add(direction.normalize().multiplyScalar(SPREAD_MM));
}
/** Afastamento no explodido: suficiente para ver os vãos, sem sair do quadro. */
export const SPREAD_MM = 190;
export class FurnitureMotion {
  private hovered: string | null = null;
  setHover(id: string | null) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.dirty = true;
  }
  private diff: SceneDiff | null = null;
  setDiff(diff: SceneDiff | null) {
    this.diff = diff;
    this.dirty = true;
  }
  /**
   * Parado, o quadro não muda: a cena só redesenha quando algo pede. `dirty`
   * é estado novo para aplicar nas peças; `active`, uma transição ou arrasto
   * em curso; `changed`, peças mexidas desde o último desenho.
   */
  private dirty = true;
  private active = false;
  private changed = false;
  /** As peças mudaram desde a última chamada: a cena precisa redesenhar. */
  takeChanged() {
    const changed = this.changed;
    this.changed = false;
    return changed;
  }
  /**
   * Móvel em movimento, ainda não gravado: as peças do conjunto andam pelo
   * deslocamento sem refazer o projeto. O deslocamento mostrado (`current`)
   * persegue o pedido (`target`) com amortecimento, então o arrasto em passos
   * de 1 cm e os toques nas setas deslizam em vez de pular. `blocked` pinta de
   * vermelho quando a posição bate em outro móvel.
   */
  private drag: {
    ids: Set<string>;
    modules: Set<string>;
    target: THREE.Vector3;
    current: THREE.Vector3;
    blocked: boolean;
    /** O projeto novo chegou com o móvel no lugar: a base pula, o resto desliza. */
    rebase: boolean;
  } | null = null;
  private lastTick = 0;
  /** Novo alvo do arrasto; `null` solta: o conjunto desliza de volta ao lugar. */
  setDrag(next: { ids: Set<string>; modules: Set<string>; offset: THREE.Vector3; blocked: boolean } | null) {
    this.dirty = true;
    if (!next) {
      if (this.drag) {
        this.drag.target.set(0, 0, 0);
        this.drag.blocked = false;
      }
      return;
    }
    const same = this.drag && this.drag.ids.size === next.ids.size && [...next.ids].every((id) => this.drag!.ids.has(id));
    if (same) {
      this.drag!.target.copy(next.offset);
      this.drag!.blocked = next.blocked;
      return;
    }
    this.drag = { ids: next.ids, modules: next.modules, target: next.offset.clone(), current: new THREE.Vector3(), blocked: next.blocked, rebase: false };
  }
  /**
   * O lugar novo foi gravado e o projeto vai chegar com ele: o que já andou na
   * tela vira a diferença até o lugar novo, que desliza até zero. Chamar antes
   * de `update` com o projeto novo.
   */
  rebaseDrag(delta: THREE.Vector3) {
    if (!this.drag) return;
    this.dirty = true;
    this.drag.current.sub(delta);
    this.drag.target.set(0, 0, 0);
    this.drag.blocked = false;
    this.drag.rebase = true;
  }
  /** Deslocamento mostrado agora num módulo (os pés andam junto). */
  dragOffset(moduleId: string) {
    return this.drag?.modules.has(moduleId) ? this.drag.current : null;
  }
  /** Ainda andando: as cotas esperam o móvel parar. */
  get moving() {
    return !!this.drag && (this.drag.target.lengthSq() > 0.25 || this.drag.current.lengthSq() > 0.25);
  }
  constructor(private scene: THREE.Scene) {}
  readonly entries = new Map<string, AnimatedPart>();
  private initialized = false;
  private read(entry: AnimatedPart): Pose {
    return {
      position: entry.mesh.position.clone(),
      size: entry.mesh.scale.clone(),
      color: entry.mesh.material.color.clone(),
      opacity: entry.mesh.material.opacity,
      rotation: entry.mesh.rotation.y,
    };
  }
  update(
    parts: Part[],
    params: { height: number; materialId: string },
    exploded: boolean,
    selected: readonly string[],
    now: number,
    reduced = false,
    duration: number = TRANSITION_MS,
  ) {
    this.tick(now, reduced);
    const present = new Set(parts.map((p) => p.id));
    const color = materials.find((m) => m.id === params.materialId)!.color;
    const centres = moduleCentres(parts);
    const fallbackCentre = new THREE.Vector3(0, params.height / 2, 0);
    for (const part of parts) {
      const target: Pose = {
        position: visualPosition(
          part,
          centres.get((part as { owners?: string[] }).owners?.[0] ?? 'módulo') ??
            fallbackCentre,
          exploded,
        ),
        size: new THREE.Vector3(...part.size),
        color: new THREE.Color(part.color ?? color),
        opacity: 1,
        rotation: part.rotation ?? 0,
      };
      let entry = this.entries.get(part.id);
      if (!entry) {
        const geo = new THREE.BoxGeometry(1, 1, 1),
          material = new THREE.MeshStandardMaterial({
            color: target.color,
            roughness: 0.72,
            envMapIntensity: 0.55,
          });
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.copy(target.position);
        mesh.rotation.y = target.rotation;
        mesh.scale.copy(target.size);
        mesh.userData.id = part.id;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({
            color: EDGE.rest,
            transparent: true,
            opacity: EDGE.restOpacity,
          }),
        );
        mesh.add(edge);
        this.scene.add(mesh);
        entry = {
          mesh,
          edge,
          from: target,
          to: target,
          started: now,
          duration: 0,
          exiting: false,
        };
        if (this.initialized && !reduced) {
          mesh.material.opacity = 0;
          mesh.position.y -= 20;
          mesh.scale.multiplyScalar(0.96);
        }
        this.entries.set(part.id, entry);
      }
      entry.from = this.read(entry);
      // A pose na tela inclui o deslocamento do arrasto, que o tick soma de
      // novo: a base é sem ele. Sem isto, redesenhar a página no meio da
      // prévia (ao soltar) mostrava o móvel com o dobro do deslocamento.
      if (this.drag?.ids.has(part.id)) entry.from.position.sub(this.drag.current);
      // Móvel recém-gravado no lugar novo: a base vai direto para lá e o
      // deslocamento que resta faz a transição, sem voltar ao lugar antigo.
      if (this.drag?.rebase && this.drag.ids.has(part.id)) {
        entry.from.position.copy(target.position);
        entry.from.rotation = target.rotation;
      }
      // Acabamento e veio seguem a peça: a textura é da cor de catálogo e as
      // coordenadas de textura são em milímetros do tamanho final, para o veio
      // não esticar numa lateral de 2,4 m nem encolher numa frente de gaveta.
      const finish = part.color ?? color;
      const sizeKey = part.size.map((v) => Math.round(v)).join('x');
      if (entry.finish !== finish || entry.sizeKey !== sizeKey) {
        const map = finishTexture(finish);
        entry.mesh.material.map = map;
        entry.mesh.material.roughness = map?.userData.roughness ?? 0.72;
        entry.mesh.material.needsUpdate = true;
        panelUV(entry.mesh.geometry, part.size);
        entry.finish = finish;
        entry.sizeKey = sizeKey;
      }
      entry.selected = selected.includes(part.id);
      this.syncHandle(entry, part);
      const motion = (
        part as Part & {
          motion?: { type: string; pivot: [number, number, number] };
        }
      ).motion;
      entry.pivot =
        !exploded && motion?.type === 'door'
          ? new THREE.Vector3(...motion.pivot)
          : undefined;
      if (entry.pivot) {
        const expected = entry.from.position
          .clone()
          .sub(entry.pivot)
          .applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            target.rotation - entry.from.rotation,
          )
          .add(entry.pivot);
        if (expected.distanceTo(target.position) > 1e-4)
          entry.pivot = undefined;
      }
      entry.to = target;
      entry.started = now;
      entry.duration = this.initialized && !reduced ? duration : 0;
      entry.exiting = false;
    }
    for (const [id, entry] of this.entries) {
      if (present.has(id) || entry.exiting) continue;
      entry.from = this.read(entry);
      entry.to = {
        ...entry.from,
        position: entry.from.position.clone().add(new THREE.Vector3(0, -20, 0)),
        size: entry.from.size.clone().multiplyScalar(0.96),
        opacity: 0,
      };
      entry.started = now;
      entry.duration = reduced ? 0 : duration;
      entry.exiting = true;
    }
    this.initialized = true;
    if (this.drag) this.drag.rebase = false;
    this.dirty = true;
    this.tick(now, reduced);
  }
  tick(now: number, reduced = false) {
    const dt = Math.min(Math.max(now - this.lastTick, 0), 50);
    this.lastTick = now;
    if (!this.dirty && !this.active) return;
    this.dirty = false;
    this.changed = true;
    let active = false;
    if (this.drag) {
      // Amortecimento de mola crítica: ~90% do caminho em 0,15 s.
      const k = reduced ? 1 : 1 - Math.exp(-dt / 65);
      this.drag.current.lerp(this.drag.target, k);
      if (!this.drag.rebase && this.drag.target.lengthSq() === 0 && this.drag.current.lengthSq() < 0.04) this.drag = null;
      // Chegou ao alvo (móvel parado sob o cursor ou esperando gravar): encaixa
      // e para de pedir quadros até o próximo alvo.
      else if (this.drag.current.distanceToSquared(this.drag.target) < 0.0025) this.drag.current.copy(this.drag.target);
      else active = true;
    }
    for (const [id, e] of this.entries) {
      const t =
        reduced || !e.duration ? 1 : ease((now - e.started) / e.duration);
      if (t < 1) active = true;
      e.mesh.position.lerpVectors(e.from.position, e.to.position, t);
      e.mesh.rotation.y = THREE.MathUtils.lerp(
        e.from.rotation,
        e.to.rotation,
        t,
      );
      if (e.pivot && Math.abs(e.to.rotation - e.from.rotation) > 1e-8) {
        e.mesh.position
          .copy(e.from.position)
          .sub(e.pivot)
          .applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            e.mesh.rotation.y - e.from.rotation,
          )
          .add(e.pivot);
      }
      if (t === 1) e.mesh.position.copy(e.to.position);
      const dragged = !!this.drag?.ids.has(id);
      if (dragged) e.mesh.position.add(this.drag!.current);
      e.mesh.scale.lerpVectors(e.from.size, e.to.size, t);
      if (e.handle) {
        const sc = e.mesh.scale;
        e.handle.group.scale.set(1 / sc.x, 1 / sc.y, 1 / sc.z);
        e.handle.group.position.set(e.handle.local.x / sc.x, e.handle.local.y / sc.y, e.handle.local.z / sc.z);
      }
      e.mesh.material.color.copy(e.from.color).lerp(e.to.color, t);
      const mark = this.diff
        ? this.diff.focus?.size
          ? this.diff.focus.has(id)
            ? this.diff.added.has(id)
              ? 'added'
              : this.diff.changed.has(id)
                ? 'changed'
                : 'focus'
            : null
          : this.diff.added.has(id)
            ? 'added'
            : this.diff.changed.has(id)
              ? 'changed'
              : null
        : null;
      // Sem marca durante o diff, a peça esmaece: o que mudou salta aos olhos.
      const fade = this.diff && this.diff.dim !== false && !mark && !e.selected ? 0.32 : 1;
      e.mesh.material.opacity =
        THREE.MathUtils.lerp(e.from.opacity, e.to.opacity, t) * fade;
      const transparent = e.mesh.material.opacity < 0.999;
      if (e.mesh.material.transparent !== transparent) {
        e.mesh.material.transparent = transparent;
        e.mesh.material.needsUpdate = true;
      }
      e.mesh.material.depthWrite = !transparent;
      if (e.handle) {
        e.handle.material.opacity = e.mesh.material.opacity;
        if (e.handle.material.transparent !== transparent) {
          e.handle.material.transparent = transparent;
          e.handle.material.needsUpdate = true;
        }
      }
      const hot = id === this.hovered || !!e.selected;
      const markColor =
        mark === 'added' ? DIFF_GLOW.added : mark === 'changed' ? DIFF_GLOW.changed : mark === 'focus' ? SELECTION_GLOW : null;
      e.edge.material.color.set(markColor ?? (hot ? EDGE.hot : EDGE.rest));
      e.edge.material.opacity =
        (markColor || hot ? EDGE.hotOpacity : EDGE.restOpacity) * e.mesh.material.opacity;
      // Selecionada brilha na cor de destaque sem perder o acabamento; no
      // diff, a cor diz se a peça entrou ou mudou.
      const blocked = dragged && this.drag!.blocked;
      const glow = blocked ? DIFF_GLOW.removed : e.selected ? SELECTION_GLOW : markColor;
      e.mesh.material.emissive.set(glow ?? '#000000');
      e.mesh.material.emissiveIntensity = blocked ? 0.5 : e.selected ? 0.42 : markColor ? 0.38 : 0;
      if (t === 1 && e.exiting) {
        this.disposeEntry(e);
        this.entries.delete(id);
      }
    }
    this.active = active;
  }
  pickable() {
    return [...this.entries.values()]
      .filter((e) => !e.exiting && e.mesh.material.opacity > 0.2)
      .map((e) => e.mesh);
  }
  /** Cria, refaz ou tira o puxador quando a frente muda de tamanho ou de lado. */
  private syncHandle(entry: AnimatedPart, part: Part) {
    const spec = handleSpec(part as Parameters<typeof handleSpec>[0]);
    const key = spec ? [spec.vertical, spec.len, spec.x, spec.y].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join(':') : '';
    if (entry.handle?.key === key) return;
    if (entry.handle) {
      entry.mesh.remove(entry.handle.group);
      this.disposeHandle(entry.handle);
      entry.handle = undefined;
    }
    if (!spec) return;
    const material = new THREE.MeshStandardMaterial({ color: '#b9bfc5', metalness: 0.8, roughness: 0.32 });
    const group = new THREE.Group();
    const bar = spec.vertical ? new THREE.BoxGeometry(12, spec.len, 12) : new THREE.BoxGeometry(spec.len, 12, 12);
    const barMesh = new THREE.Mesh(bar, material);
    barMesh.position.z = 26;
    barMesh.castShadow = true;
    group.add(barMesh);
    // Dois pés ligam a barra à frente.
    for (const end of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 20), material);
      const along = end * (spec.len / 2 - 10);
      post.position.set(spec.vertical ? 0 : along, spec.vertical ? along : 0, 10);
      group.add(post);
    }
    entry.mesh.add(group);
    entry.handle = { group, local: new THREE.Vector3(spec.x, spec.y, spec.z), material, key };
    this.dirty = true;
  }
  private disposeHandle(h: Handle) {
    h.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    h.material.dispose();
  }
  private disposeEntry(e: AnimatedPart) {
    if (e.handle) this.disposeHandle(e.handle);
    this.scene.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh.material.dispose();
    e.edge.geometry.dispose();
    e.edge.material.dispose();
  }
  dispose() {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
  }
}
