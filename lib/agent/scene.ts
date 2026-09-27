import { generateComposition, type ModularPart } from '../composition';
import { canonical, type Design } from '../studio';
import { framed, OBSTACLE_LABEL, TV_CLEARANCE_MM, tvMountZ, wallAt, type ObstacleKind, type Room } from '../room';

/**
 * A parede vista pelo app: o que está preso nela, o que ocupa espaço na
 * frente dela e onde ainda cabe coisa. É a mesma conta para posicionar peça
 * nova, para o resumo que a IA lê e para a conferência, em coordenadas de
 * quem desenha móvel: x do canto esquerdo da parede, y do piso, e a
 * profundidade `d` a partir da face da parede (0 = encostado nela).
 *
 * Sem ambiente, a "parede" é o fundo mais recuado do móvel e o x começa no
 * lado esquerdo dele (a convenção do row_build).
 */
export type Box3 = { x0: number; x1: number; y0: number; y1: number; d0: number; d1: number };
export type SceneModule = Box3 & {
  id: string;
  name: string;
  kind: 'box' | 'panel';
  /** Apoia no piso (com ou sem pés). */
  floor: boolean;
};
/**
 * Área protegida da parede. `block`: nada cobre (porta, janela, coluna,
 * outro); `tv`: nada avança na frente da tela nem encosta nela, mas o painel
 * atrás é o lugar dela; `free`: pode ficar atrás do móvel (tomada).
 */
export type SceneZone = {
  id: string;
  kind: ObstacleKind;
  label: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  rule: 'block' | 'tv' | 'free';
  /** TV: distância da parede ao plano de trás dela (frente do painel que a segura). */
  mount?: number;
};
export type Scene = {
  /** Canto esquerdo da parede e face dela, no mundo. */
  origin: { x: number; z: number };
  /** Largura e pé-direito da parede; null sem ambiente. */
  width: number | null;
  height: number | null;
  modules: SceneModule[];
  zones: SceneZone[];
  /** Parede sem âncora: o app prende antes de pôr peça nova, para nada andar junto. */
  anchor: { x: number; z: number } | null;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

function partBox(p: ModularPart) {
  const turned = Math.round((p.rotation * 180) / Math.PI) % 180 !== 0;
  const w = turned ? p.size[2] : p.size[0];
  const d = turned ? p.size[0] : p.size[2];
  return {
    min: [p.position[0] - w / 2, p.position[1] - p.size[1] / 2, p.position[2] - d / 2],
    max: [p.position[0] + w / 2, p.position[1] + p.size[1] / 2, p.position[2] + d / 2],
  };
}

export function sceneOf(design: Design, room: Room | undefined): Scene {
  const g = generateComposition(canonical(design), false);
  const wall = room ? wallAt(room, g.bounds) : { x: g.bounds.min[0], z: g.bounds.min[2] };
  const boxes = new Map<string, { min: number[]; max: number[] }>();
  for (const p of g.parts) {
    const b = partBox(p);
    for (const owner of p.owners) {
      const cur = boxes.get(owner);
      boxes.set(
        owner,
        cur ? { min: cur.min.map((v, i) => Math.min(v, b.min[i])), max: cur.max.map((v, i) => Math.max(v, b.max[i])) } : { min: [...b.min], max: [...b.max] },
      );
    }
  }
  const modules: SceneModule[] = design.modules.flatMap((m) => {
    const b = boxes.get(m.id);
    if (!b) return [];
    const y0 = m.feet ? m.position[1] : b.min[1];
    return [
      {
        id: m.id,
        name: m.name,
        kind: m.kind === 'panel' ? 'panel' : 'box',
        x0: r1(b.min[0] - wall.x),
        x1: r1(b.max[0] - wall.x),
        y0: r1(y0),
        y1: r1(b.max[1]),
        d0: r1(b.min[2] - wall.z),
        d1: r1(b.max[2] - wall.z),
        floor: y0 <= 5,
      },
    ];
  });
  const panels = g.parts.filter((p) => p.kind === 'panel').map(partBox);
  const zones: SceneZone[] = (room?.obstacles ?? []).map((o) => {
    const f = framed(o);
    const zone: SceneZone = {
      id: o.id,
      kind: o.kind,
      label: o.label ?? OBSTACLE_LABEL[o.kind],
      x0: f.x0,
      x1: f.x1,
      y0: f.y0,
      y1: f.y1,
      rule: o.kind === 'tv' ? 'tv' : o.kind === 'outlet' ? 'free' : 'block',
    };
    if (o.kind === 'tv') {
      const rect = { x0: wall.x + o.xMm, x1: wall.x + o.xMm + o.widthMm, y0: o.yMm, y1: o.yMm + o.heightMm };
      zone.mount = r1(tvMountZ(rect, panels, wall.z) - wall.z);
    }
    return zone;
  });
  return {
    origin: { x: wall.x, z: wall.z },
    width: room?.widthMm ?? null,
    height: room?.heightMm ?? null,
    modules,
    zones,
    anchor: room && !room.anchor ? { x: wall.x, z: wall.z } : null,
  };
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.5;

/**
 * O que a caixa `b` (coordenadas da parede) atravessa: módulo (em 3D), área
 * protegida, borda da parede ou teto. Frase curta por conflito, com as
 * medidas de quem bloqueia, para a IA decidir de uma vez.
 */
export function conflictsOf(
  scene: Scene,
  b: Box3,
  ignore: ReadonlySet<string> = new Set(),
  extra: readonly (Box3 & { name: string })[] = [],
  /** Painel de parede: é onde a TV se prende, então fica atrás dela sem "tapar" a tela. */
  wallPanel = false,
) {
  const out: { who: string; box: { x0: number; x1: number; y0: number; y1: number }; why: string }[] = [];
  if (scene.width !== null && (b.x0 < -0.5 || b.x1 > scene.width + 0.5))
    out.push({ who: 'parede', box: { x0: 0, x1: scene.width, y0: 0, y1: scene.height ?? 0 }, why: `passa da parede (0 a ${scene.width} mm)` });
  if (scene.height !== null && b.y1 > scene.height + 0.5)
    out.push({ who: 'teto', box: { x0: 0, x1: scene.width ?? 0, y0: scene.height, y1: scene.height }, why: `passa do teto (${scene.height} mm)` });
  if (b.y0 < -0.5) out.push({ who: 'piso', box: { x0: b.x0, x1: b.x1, y0: 0, y1: 0 }, why: 'fica abaixo do piso' });
  for (const m of [...scene.modules, ...extra.map((e) => ({ ...e, id: e.name }))]) {
    if (ignore.has(m.id)) continue;
    if (overlap(b.x0, b.x1, m.x0, m.x1) && overlap(b.y0, b.y1, m.y0, m.y1) && overlap(b.d0, b.d1, m.d0, m.d1))
      out.push({ who: m.name, box: m, why: `bate em ${m.name} (x ${Math.round(m.x0)}–${Math.round(m.x1)}, y ${Math.round(m.y0)}–${Math.round(m.y1)} mm)` });
  }
  for (const z of scene.zones) {
    if (z.rule === 'free') continue;
    if (z.rule === 'tv') {
      // A TV se prende no painel que passa pelo centro da tela (a mesma regra
      // do encaixe final, tvMountZ); painel atrás só de uma borda dela tapa.
      const cx = (z.x0 + z.x1) / 2,
        cy = (z.y0 + z.y1) / 2;
      if (wallPanel && b.x0 <= cx && b.x1 >= cx && b.y0 <= cy && b.y1 >= cy) continue;
      if (wallPanel && overlap(b.x0, b.x1, z.x0, z.x1) && overlap(b.y0, b.y1, z.y0, z.y1)) {
        out.push({
          who: z.label,
          box: z,
          why: `fica atrás só de parte de ${z.label}: o painel que segura a TV passa pelo centro da tela (x ${Math.round(cx)}, y ${Math.round(cy)} mm)`,
        });
        continue;
      }
      const c = TV_CLEARANCE_MM;
      if (overlap(b.x0, b.x1, z.x0 - c, z.x1 + c) && overlap(b.y0, b.y1, z.y0 - c, z.y1 + c) && b.d1 > (z.mount ?? 0) + 0.5)
        out.push({
          who: z.label,
          box: { x0: z.x0 - c, x1: z.x1 + c, y0: z.y0 - c, y1: z.y1 + c },
          why: `tapa ${z.label} ou encosta na tela (tela de x ${Math.round(z.x0)} a ${Math.round(z.x1)} e y ${Math.round(z.y0)} a ${Math.round(z.y1)} mm, com ${c} mm livres em volta)`,
        });
    } else if (overlap(b.x0, b.x1, z.x0, z.x1) && overlap(b.y0, b.y1, z.y0, z.y1))
      out.push({ who: z.label, box: z, why: `cobre ${z.label.toLowerCase()} (x ${Math.round(z.x0)}–${Math.round(z.x1)}, y ${Math.round(z.y0)}–${Math.round(z.y1)} mm)` });
  }
  return out;
}

/**
 * Trechos livres da parede (em x) numa faixa de altura e profundidade: o que
 * a IA recebe quando uma peça não cabe, em vez de tentar outra posição às
 * cegas. Sem ambiente, vai de 3 m à esquerda a 3 m à direita do móvel.
 */
export function freeSpans(scene: Scene, y0: number, y1: number, d0: number, d1: number, ignore: ReadonlySet<string> = new Set(), extra: readonly (Box3 & { name: string })[] = []) {
  const lo = scene.width === null ? Math.min(0, ...scene.modules.map((m) => m.x0)) - 3000 : 0;
  const hi = scene.width ?? Math.max(0, ...scene.modules.map((m) => m.x1)) + 3000;
  const blocks: [number, number][] = [];
  for (const m of [...scene.modules, ...extra.map((e) => ({ ...e, id: e.name }))])
    if (!ignore.has(m.id) && overlap(y0, y1, m.y0, m.y1) && overlap(d0, d1, m.d0, m.d1)) blocks.push([m.x0, m.x1]);
  for (const z of scene.zones) {
    if (z.rule === 'free') continue;
    const c = z.rule === 'tv' ? TV_CLEARANCE_MM : 0;
    if (z.rule === 'tv' && d1 <= (z.mount ?? 0) + 0.5) continue;
    if (overlap(y0, y1, z.y0 - c, z.y1 + c)) blocks.push([z.x0 - c, z.x1 + c]);
  }
  blocks.sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let x = lo;
  for (const [a, b] of blocks) {
    if (a - x > 0.5) spans.push([x, Math.min(a, hi)]);
    x = Math.max(x, b);
  }
  if (hi - x > 0.5) spans.push([x, hi]);
  return spans.filter(([a, b]) => b - a >= 1).map(([a, b]) => [Math.round(a), Math.round(b)] as [number, number]);
}

/**
 * Resumo da parede para a IA: medidas, o que está preso nela (com a área
 * protegida de cada obstáculo), cada módulo com x, y e profundidade, e onde
 * cabe coisa em três faixas de altura. Ela planeja com isto, sem converter
 * posição de centro em borda nem somar espessura.
 */
export function sceneSummary(scene: Scene) {
  const round = (v: number) => Math.round(v);
  const bands: [string, number, number][] = [
    ['piso (0–900)', 0, 900],
    ['meio (900–1500)', 900, 1500],
    ['alto (1500–2400)', 1500, Math.min(2400, scene.height ?? 2400)],
  ];
  return {
    parede_mm: scene.width === null ? 'sem ambiente: x a partir do lado esquerdo do móvel' : { largura: scene.width, altura: scene.height },
    fixos: scene.zones.map((z) => ({
      id: z.id,
      o_que: z.label,
      x: [round(z.x0), round(z.x1)],
      y: [round(z.y0), round(z.y1)],
      regra:
        z.rule === 'tv'
          ? `nada na frente da tela nem a menos de ${TV_CLEARANCE_MM} mm dela; painel atrás pode`
          : z.rule === 'block'
            ? 'não cobrir'
            : 'pode ficar atrás do móvel',
    })),
    ocupado: scene.modules.map((m) => ({
      id: m.id,
      nome: m.name,
      x: [round(m.x0), round(m.x1)],
      y: [round(m.y0), round(m.y1)],
      prof: [round(m.d0), round(m.d1)],
      ...(m.kind === 'panel' ? { superficie: 'painel de parede: peça na frente dele fica presa nele' } : {}),
    })),
    livre_na_parede: Object.fromEntries(
      bands.filter(([, a, b]) => b > a).map(([name, a, b]) => [name, freeSpans(scene, a, b, 0, 300).map(([x0, x1]) => `${x0}–${x1}`)]),
    ),
    // Na frente de cada painel de parede: onde uma peça presa nele cabe.
    ...(scene.modules.some((m) => m.kind === 'panel')
      ? {
          livre_nos_paineis: Object.fromEntries(
            scene.modules
              .filter((m) => m.kind === 'panel')
              .map((p) => [
                p.id,
                Object.fromEntries(
                  bands
                    .map(([name, a, b]) => [name, Math.max(a, p.y0), Math.min(b, p.y1)] as const)
                    .filter(([, a, b]) => b - a >= 100)
                    .map(([name, a, b]) => [
                      `${name.split(' ')[0]} (${round(a)}–${round(b)})`,
                      freeSpans(scene, a, b, p.d1, p.d1 + 250)
                        .map(([x0, x1]) => [Math.max(x0, p.x0), Math.min(x1, p.x1)])
                        .filter(([x0, x1]) => x1 - x0 >= 100)
                        .map(([x0, x1]) => `${round(x0)}–${round(x1)}`),
                    ]),
                ),
              ]),
          ),
        }
      : {}),
  };
}
