/**
 * Oráculo de aceitação das composições (grupo `composicao` do bench).
 *
 * Confere o estado gravado de forma independente do validador do app: o
 * `fitReport` antigo pulava a TV e aprovou um nicho na frente da tela, então
 * ele não pode ser o juiz. Aqui a conta da TV, do painel e da fixação é
 * própria, sobre as peças que o motor gera (a geometria do motor é a verdade;
 * a regra de o que pode ficar onde é deste arquivo).
 *
 * Nada aqui julga beleza: isso é revisão humana das capturas. O oráculo diz
 * se as regras duras valem e se a resposta não contradiz os fatos.
 */
import { generateComposition } from '../lib/composition.ts';
import { canonical, generateDesign } from '../lib/studio.ts';
import { fitReport } from '../lib/room.ts';
import { cutPlan } from '../lib/cutplan.ts';

/** Folga mínima em volta da tela: nada que avance para a frente chega mais perto. */
export const TV_CLEARANCE = 30;
const EPS = 2;

/** Caixa de cada módulo no mundo (x, y, z), pela união das peças dele. */
export function moduleBoxes(design) {
  const g = generateComposition(canonical(design), false);
  const boxes = new Map();
  for (const p of g.parts) {
    const turned = Math.round((p.rotation * 180) / Math.PI) % 180 !== 0;
    const w = turned ? p.size[2] : p.size[0];
    const dz = turned ? p.size[0] : p.size[2];
    const box = {
      minX: p.position[0] - w / 2,
      maxX: p.position[0] + w / 2,
      minY: p.position[1] - p.size[1] / 2,
      maxY: p.position[1] + p.size[1] / 2,
      minZ: p.position[2] - dz / 2,
      maxZ: p.position[2] + dz / 2,
    };
    for (const owner of p.owners) {
      const cur = boxes.get(owner);
      boxes.set(
        owner,
        cur
          ? {
              minX: Math.min(cur.minX, box.minX),
              maxX: Math.max(cur.maxX, box.maxX),
              minY: Math.min(cur.minY, box.minY),
              maxY: Math.max(cur.maxY, box.maxY),
              minZ: Math.min(cur.minZ, box.minZ),
              maxZ: Math.max(cur.maxZ, box.maxZ),
            }
          : box,
      );
    }
  }
  // Pés: o módulo chega ao piso.
  for (const m of design.modules) if (m.feet && boxes.has(m.id)) boxes.get(m.id).minY = m.position[1];
  return { boxes, bounds: g.bounds };
}

/** Onde a parede está no mundo (mesma convenção do ambiente: presa ou atrás do móvel). */
export function wallOf(room, bounds) {
  if (!room) return { x: bounds.min[0], z: bounds.min[2] };
  return room.anchor ?? { x: bounds.min[0] - (room.offsetMm ?? 0), z: bounds.min[2] };
}

/**
 * TVs no mundo: retângulo da tela na parede e o plano de trás dela, que é a
 * frente do painel que a segura (painel que contém o centro da tela) ou a
 * parede.
 */
export function tvsOf(design, room) {
  if (!room) return [];
  const { boxes, bounds } = moduleBoxes(design);
  const wall = wallOf(room, bounds);
  return (room.obstacles ?? [])
    .filter((o) => o.kind === 'tv')
    .map((o) => {
      const rect = { x0: wall.x + o.xMm, x1: wall.x + o.xMm + o.widthMm, y0: o.yMm, y1: o.yMm + o.heightMm };
      const cx = (rect.x0 + rect.x1) / 2,
        cy = (rect.y0 + rect.y1) / 2;
      const backing = design.modules.filter((m) => {
        const b = boxes.get(m.id);
        return m.kind === 'panel' && b && b.minX <= cx && b.maxX >= cx && b.minY <= cy && b.maxY >= cy;
      });
      const backZ = Math.max(wall.z, ...backing.map((m) => boxes.get(m.id).maxZ));
      return { id: o.id, label: o.label ?? 'TV', rect, backZ, backing: backing.map((m) => m.id) };
    });
}

/** Módulos que tapam ou encostam na tela (dentro da folga) e avançam além do plano dela. */
export function tvBlockers(design, room, clearance = TV_CLEARANCE) {
  const { boxes } = moduleBoxes(design);
  const out = [];
  for (const tv of tvsOf(design, room))
    for (const m of design.modules) {
      if (tv.backing.includes(m.id)) continue;
      const b = boxes.get(m.id);
      if (!b) continue;
      const overlapX = Math.min(b.maxX, tv.rect.x1 + clearance) - Math.max(b.minX, tv.rect.x0 - clearance);
      const overlapY = Math.min(b.maxY, tv.rect.y1 + clearance) - Math.max(b.minY, tv.rect.y0 - clearance);
      if (overlapX > 0.5 && overlapY > 0.5 && b.maxZ > tv.backZ + 0.5) out.push({ tv: tv.id, module: m.id, name: m.name });
    }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** O módulo como objeto físico: tudo menos o nome. */
const body = (m) => {
  const { name: _n, ...rest } = m;
  void _n;
  return rest;
};

/** Fatos do plano de corte: chapas por material e espessura. */
export function sheetFacts(design) {
  const plan = cutPlan(generateDesign(design).parts);
  return {
    sheets: plan.sheets.length,
    groups: plan.groups.map((g) => ({ material: g.material, thickness: g.thickness, sheets: g.sheets })),
  };
}

/**
 * Conferência de uma composição.
 * @param {object} o
 * @param o.before design de partida; o.after design gravado
 * @param o.roomBefore, o.roomAfter ambientes
 * @param o.protect ids que não podem mudar (padrão: todos os de partida)
 * @param o.panel id do painel que recebe as peças (opcional)
 * @param o.requireAddition exige ao menos uma peça funcional nova
 * @param o.content resposta final
 * @param o.undo { design, room } depois de um Ctrl+Z (opcional)
 */
export function checkComposition(o) {
  const failures = [];
  const facts = {};
  const protect = o.protect ?? o.before.modules.map((m) => m.id);
  // 1. Geometria válida.
  try {
    generateComposition(canonical(o.after));
  } catch (e) {
    failures.push(`geometria inválida: ${e.message}`);
    return { ok: false, failures, facts };
  }
  // 2. Protegidos iguais (medidas, posição, material, frentes).
  for (const id of protect) {
    const a = o.before.modules.find((m) => m.id === id);
    const b = o.after.modules.find((m) => m.id === id);
    if (!b) failures.push(`protegido sumiu: ${a?.name ?? id}`);
    else if (!same(body(a), body(b))) failures.push(`protegido mudou: ${a.name}`);
  }
  // 3. TV no mesmo lugar do mundo e com a mesma medida.
  const tvA = tvsOf(o.before, o.roomBefore),
    tvB = tvsOf(o.after, o.roomAfter);
  for (const t of tvA) {
    const u = tvB.find((v) => v.id === t.id);
    if (!u) failures.push(`${t.label} sumiu do ambiente`);
    else if (['x0', 'x1', 'y0', 'y1'].some((k) => Math.abs(t.rect[k] - u.rect[k]) > 1))
      failures.push(`${t.label} mudou de lugar na parede (${Math.round(t.rect.x0)}→${Math.round(u.rect.x0)} em x)`);
  }
  // 4. Tela livre.
  const blockers = tvBlockers(o.after, o.roomAfter);
  facts.tvBlockers = blockers.map((b) => b.name);
  if (blockers.length) failures.push(`TV tapada por ${[...new Set(blockers.map((b) => b.name))].join(', ')}`);
  // 5. Cabe no ambiente (sem as regras de TV do app, que o oráculo confere acima).
  const fit = o.roomAfter ? fitReport(o.after, o.roomAfter).issues.filter((i) => !/^tv/.test(i.code)) : [];
  if (fit.length) failures.push(`não cabe: ${fit.map((i) => i.message).join('; ')}`);
  // 6. Peças novas: funcionais, presas no painel ou na parede, sem passar da borda do painel.
  const { boxes, bounds } = moduleBoxes(o.after);
  // Sem ambiente, a parede é o fundo mais recuado dos módulos.
  const wall = o.roomAfter ? wallOf(o.roomAfter, bounds) : { x: bounds.min[0], z: Math.min(...[...boxes.values()].map((b) => b.minZ)) };
  const had = new Set(o.before.modules.map((m) => m.id));
  const added = o.after.modules.filter((m) => !had.has(m.id));
  facts.added = added.map((m) => `${m.name} (${m.kind ?? 'caixa'} ${m.width}×${m.height}×${m.depth})`);
  const panels = o.after.modules.filter((m) => m.kind === 'panel' && had.has(m.id));
  const g = generateDesign(o.after);
  let functional = 0;
  for (const m of added) {
    const b = boxes.get(m.id);
    if (!b) continue;
    if (m.kind === 'ledge') functional++;
    else if (m.kind !== 'panel') {
      const leaves = g.cells.filter((c) => c.moduleId === m.id && !c.node.split);
      if (leaves.some((c) => c.node.front || (c.size[0] >= 100 && c.size[1] >= 100))) functional++;
    }
    const onPanel = panels.find((p) => {
      const pb = boxes.get(p.id);
      return Math.min(b.maxX, pb.maxX) - Math.max(b.minX, pb.minX) > EPS && Math.min(b.maxY, pb.maxY) - Math.max(b.minY, pb.minY) > EPS;
    });
    const connected = o.after.connections.some((c) => c.child === m.id || c.parent === m.id);
    if (onPanel) {
      const pb = boxes.get(onPanel.id);
      const inside = b.minX >= pb.minX - EPS && b.maxX <= pb.maxX + EPS && b.minY >= pb.minY - EPS && b.maxY <= pb.maxY + EPS;
      const touching = Math.abs(b.minZ - pb.maxZ) <= EPS;
      if (!touching && !connected) failures.push(`${m.name} não encosta no painel (fundo a ${Math.round(b.minZ - pb.maxZ)} mm da frente dele)`);
      else if (!inside && touching) failures.push(`${m.name} passa da borda do painel`);
    } else if (!connected) {
      const onFloor = b.minY <= 5;
      const onWall = Math.abs(b.minZ - wall.z) <= EPS;
      if (!onFloor && !onWall) failures.push(`${m.name} flutua: nem no piso, nem na parede, nem no painel`);
      if (!onFloor && onWall && !m.wall && m.kind !== 'panel' && m.kind !== 'ledge') failures.push(`${m.name} suspenso sem marcar fixação na parede`);
    }
  }
  if (o.requireAddition && !functional) failures.push('nenhuma peça funcional nova (nicho, armário, gaveteiro ou prateleira)');
  // 7. A resposta não contradiz o estado.
  const text = o.content ?? '';
  facts.reply = text;
  const shelves = added.some(
    (m) => m.kind === 'ledge' || g.parts.some((p) => p.kind === 'shelf' && p.owners.includes(m.id)),
  );
  if (/prateleira/i.test(text) && !shelves && !/sem prateleira|não (tem|há|existe)[^.]*prateleira/i.test(text))
    failures.push('a resposta fala em prateleira e nenhuma prateleira horizontal entrou');
  if (/\b(tv|tela)\b[^.]*\b(livre|desobstru|à vista|visível)/i.test(text) && blockers.length)
    failures.push('a resposta diz que a TV ficou livre, mas está tapada');
  // 8. Um Ctrl+Z volta ao começo (móvel e ambiente).
  if (o.undo) {
    if (!same(canonical(o.undo.design), canonical(o.before))) failures.push('desfazer não voltou o móvel de partida');
    if (!same(o.undo.room ?? null, o.roomBefore ?? null)) failures.push('desfazer não voltou o ambiente de partida');
  }
  return { ok: failures.length === 0, failures, facts };
}

/**
 * A resposta contradiz o plano de corte final? Pega "ainda usa chapas de 25
 * mm" quando não sobrou peça de 25 mm, e "3 chapas" quando o plano tem 2.
 */
export function sheetClaims(text, design) {
  const f = sheetFacts(design);
  const out = [];
  const thick = new Set(f.groups.map((g) => g.thickness));
  for (const m of text.matchAll(/chapas?[^.]{0,60}?\b(\d{2})\s*mm|\b(\d{2})\s*mm[^.]{0,30}?chapas?/gi)) {
    const t = Number(m[1] ?? m[2]);
    if ([15, 18, 25, 30, 6].includes(t) && !thick.has(t) && !/antes|era|eram|troc|passou|substitu|de \d{2} mm para|reduz|elimin|tirei|sem/i.test(m[0]))
      out.push(`fala em chapa de ${t} mm, e o plano final só tem ${[...thick].join(', ')} mm`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+chapas?\b/gi)) {
    const n = Number(m[1]);
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    if (n !== f.sheets && !f.groups.some((g) => g.sheets === n) && !/de\s*$|eram\s*$|antes|para\s*$/i.test(before))
      out.push(`fala em ${n} chapas, e o plano final tem ${f.sheets}`);
  }
  return out;
}

/**
 * Plano da parede para uma cena sem ambiente: o fundo mais recuado dos
 * módulos. Com ambiente, a parede dele.
 */
export function wallPlane(design, room) {
  const { boxes, bounds } = moduleBoxes(design);
  if (room) return wallOf(room, bounds).z;
  return Math.min(...[...boxes.values()].map((b) => b.minZ));
}

/** Módulos que não encostam o fundo na parede (nem apoiam em outro por conexão em cima). */
export function offWall(design, room) {
  const { boxes } = moduleBoxes(design);
  const z = wallPlane(design, room);
  const onTop = new Set(design.connections.filter((c) => c.side === 'top').map((c) => c.child));
  return design.modules.filter((m) => !onTop.has(m.id) && Math.abs(boxes.get(m.id).minZ - z) > EPS).map((m) => m.name);
}

/** Vãos maiores que `tol` entre módulos de piso vizinhos (ordenados em x). */
export function floorGaps(design, tol = 5) {
  const { boxes } = moduleBoxes(design);
  const floor = design.modules
    .filter((m) => boxes.get(m.id).minY <= 5)
    .map((m) => ({ name: m.name, ...boxes.get(m.id) }))
    .sort((a, b) => a.minX - b.minX);
  const out = [];
  for (let i = 1; i < floor.length; i++) {
    const gap = floor[i].minX - floor[i - 1].maxX;
    if (gap > tol) out.push(`${Math.round(gap)} mm entre ${floor[i - 1].name} e ${floor[i].name}`);
  }
  return out;
}

/** Trechos da parede (x) sem nada abaixo de `y` na faixa do piso: vão livre para aparelho. */
export function clearFloorSpans(design, room, below = 900) {
  const { boxes, bounds } = moduleBoxes(design);
  const wall = wallOf(room, bounds);
  const taken = [...boxes.values()].filter((b) => b.minY < below).map((b) => [b.minX - wall.x, b.maxX - wall.x]).sort((a, b) => a[0] - b[0]);
  const spans = [];
  let x = 0;
  for (const [a, b] of taken) {
    if (a - x > 1) spans.push([x, a]);
    x = Math.max(x, b);
  }
  if (room.widthMm - x > 1) spans.push([x, room.widthMm]);
  return spans;
}
