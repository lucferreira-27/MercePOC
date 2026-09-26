// Fotos reais de móveis e ambientes (bench/images/real-*.jpg, fora do git) e o
// gabarito de cada uma: o desenho que um projetista montaria no Merce olhando a
// foto, feito com o mesmo Builder dos ativos da biblioteca. O resultado da IA é
// comparado com o gabarito por impressão digital (frentes, medidas, pés,
// altura do chão, cor e ambiente), não por igualdade: a foto não tem medida e
// o gabarito também é uma estimativa.
import { Builder } from '../lib/assets.ts';
import { generateDesign, normalize } from '../lib/studio.ts';
import { layout } from '../lib/composition.ts';
import { materials } from '../lib/furniture.ts';

const P = 18;
const inner = (h) => h - 2 * P;

/** Cômoda da foto: gavetas com nicho em cima à esquerda; duas gavetas e porta à direita. */
function comoda(b, x = 0) {
  const h = 880;
  const l = b.box('l', 'Gavetas', [770, h, 450], 'walnut', { feet: 50, position: [x + 385, 0, 225] });
  const r = b.box('r', 'Porta', [348, h, 450], 'walnut', { feet: 50 });
  b.beside(l, r, true);
  const [drawers, niche] = b.split(b.root(l), 'y', inner(h) - P - 150);
  void niche;
  b.front(drawers, 'drawers', { count: 4 });
  const [door, top] = b.split(b.root(r), 'y', 520);
  b.front(door, 'single', { hinge: 'right' });
  const [mid, lid] = b.split(top, 'y', 170);
  b.front(mid, 'drawers', { count: 1 });
  b.front(lid, 'drawers', { count: 1 });
}

export const truths = {
  comoda: { build: (b) => comoda(b) },
  'guarda-roupa-duas-cores': {
    build(b) {
      const h = 1950;
      const a = b.box('a', 'Portas pretas', [590, h, 520], 'black', { feet: 50 });
      const c = b.box('b', 'Portas e gavetas', [578, h, 520], 'freijo', { feet: 50 });
      b.beside(a, c, false);
      b.front(b.root(a), 'double');
      const [low, high] = b.split(b.root(c), 'y', 400);
      b.front(low, 'drawers', { count: 2 });
      b.front(high, 'double');
    },
  },
  'guarda-roupa-8-portas': {
    build(b) {
      const h = 2100;
      const ids = b.row('g', ['Portas esquerda', 'Portas direita'], [1000, 1000], h, 600, 'freijo', { feet: 150 });
      for (const id of ids) {
        const [low, high] = b.split(b.root(id), 'y', 1450);
        b.front(low, 'double');
        b.front(high, 'double');
      }
    },
  },
  gaveteiro: {
    build(b) {
      const id = b.box('g', 'Gaveteiro', [500, 1030, 400], 'freijo', { feet: 120 });
      b.front(b.root(id), 'drawers', { count: 6 });
    },
  },
  'nicho-parede': {
    // 1,4 m passa do limite de um módulo (1,2 m): dois corpos ligados, três vãos iguais.
    build(b) {
      const a = b.box('a', 'Nicho de parede', [940, 220, 250], 'walnut', { wall: true, position: [470, 1500, 125] });
      const c = b.box('c', 'Nicho de parede 2', [478, 220, 250], 'walnut', { wall: true });
      b.beside(a, c, true);
      b.split(b.root(a), 'x', 443);
    },
  },
  'painel-sala': {
    // Parede de 3,2 m: porta de entrada à esquerda, painel com a TV à direita.
    room: {
      schemaVersion: 1,
      widthMm: 3200,
      heightMm: 2700,
      offsetMm: 1250,
      obstacles: [
        { id: 'porta', kind: 'door', xMm: 150, yMm: 0, widthMm: 900, heightMm: 2100 },
        { id: 'tv', kind: 'tv', xMm: 1590, yMm: 700, widthMm: 1120, heightMm: 650 },
      ],
    },
    build(b) {
      const cx = 890;
      b.panel('p', 'Painel', [1780, 1700, 25], 'oak', [cx, 150, 12.5]);
      const r1 = b.box('r1', 'Rack gaveta esquerda', [909, 300, 400], 'sand', { wall: true, position: [cx - 445, 200, 225] });
      const r2 = b.box('r2', 'Rack gaveta direita', [909, 300, 400], 'sand', { wall: true });
      b.beside(r1, r2, true);
      b.front(b.root(r1), 'drawers', { count: 1 });
      b.front(b.root(r2), 'drawers', { count: 1 });
      b.op({ kind: 'module.add', id: b.id('tampo'), preset: 'ledge', name: 'Tampo do rack' });
      b.op({ kind: 'module.edit', id: b.id('tampo'), width: 1860, height: 30, depth: 420, materialId: 'walnut', position: [cx, 500, 235] });
      b.op({ kind: 'module.add', id: b.id('prat'), preset: 'ledge', name: 'Prateleira do painel' });
      b.op({ kind: 'module.edit', id: b.id('prat'), width: 1780, height: 25, depth: 220, materialId: 'walnut', position: [cx, 1780, 135] });
    },
  },
  'cozinha-pia': {
    // Parede da pia: vão do fogão à esquerda, gabinete branco (quatro portas e
    // gaveteiro), janela larga sobre a pia e a geladeira no canto direito.
    // Sem aéreo: a parede da foto é só revestimento.
    room: {
      schemaVersion: 1,
      widthMm: 3600,
      heightMm: 2700,
      offsetMm: 760,
      obstacles: [{ id: 'janela', kind: 'window', xMm: 760, yMm: 1050, widthMm: 1700, heightMm: 700 }],
    },
    build(b) {
      const h = 750;
      const ids = b.row('b', ['Pia esquerda', 'Pia direita', 'Gaveteiro'], [780, 780, 576], h, 550, 'white', { feet: 100, position: [390, 0, 275] });
      b.front(b.root(ids[0]), 'double');
      b.front(b.root(ids[1]), 'double');
      b.front(b.root(ids[2]), 'drawers', { count: 3 });
    },
  },
  'torre-micro': {
    build(b) {
      const h = 1920;
      const id = b.box('t', 'Armário do micro-ondas', [760, h, 450], 'white', { feet: 80 });
      const [low, rest] = b.split(b.root(id), 'y', 560);
      b.front(low, 'double');
      const [drawer, rest2] = b.split(rest, 'y', 160);
      b.front(drawer, 'drawers', { count: 1 });
      const [niche, top] = b.split(rest2, 'y', 400);
      void niche;
      b.front(top, 'double');
    },
  },
  'quarto-janela': {
    // Parede da janela: cômoda à esquerda, janela de 1,2 m à direita dela.
    room: {
      schemaVersion: 1,
      widthMm: 3000,
      heightMm: 2600,
      offsetMm: 250,
      obstacles: [{ id: 'janela', kind: 'window', xMm: 1500, yMm: 1000, widthMm: 1200, heightMm: 1000 }],
    },
    build: (b) => comoda(b),
  },
};

const cache = new Map();
/** O gabarito montado (composição normalizada) e o ambiente dele. */
export function truth(key) {
  if (!cache.has(key)) {
    const t = truths[key];
    const b = new Builder('t-');
    t.build(b);
    cache.set(key, { design: normalize(b.d), room: t.room ?? null });
  }
  return cache.get(key);
}

const colorOf = new Map(materials.map((m) => [m.id, m.color]));
/** Tom da cor: escuro, médio ou claro (a foto não diz o acabamento, diz o tom). */
function tone(hex) {
  if (!hex) return 'mid';
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l < 0.4 ? 'dark' : l > 0.72 ? 'light' : 'mid';
}

/**
 * Impressão digital de um desenho: frentes (porta, gaveta, nicho aberto),
 * painéis e prateleiras de parede como retângulos na vista de frente, o
 * envelope, pés e altura do chão. Módulo girado entra pela caixa, sem frentes.
 */
export function fingerprint(design, room = null) {
  const g = generateDesign(design);
  const rects = [];
  for (const p of g.parts) {
    const front = p.kind === 'door' || (p.kind === 'drawer' && /Frente gaveta/.test(p.name));
    if (!front) continue;
    const [cx, cy] = p.position;
    const [w, h] = p.size;
    rects.push({ type: p.kind, x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2, tone: tone(p.color) });
  }
  const byId = new Map(design.modules.map((m) => [m.id, m]));
  // Vão aberto: folha sem frente e sem porta de um vão acima cobrindo.
  const covered = new Set();
  const mark = (c, under) => {
    if (under) covered.add(c.id);
    for (const k of c.split?.children ?? []) mark(k, under || !!c.front);
  };
  for (const m of design.modules) if (m.root) mark(m.root, false);
  for (const c of layout(design).cells) {
    const m = byId.get(c.moduleId);
    if (c.node.split || c.node.front || covered.has(c.id) || m.rotation) continue;
    if (c.size[0] < 100 || c.size[1] < 100) continue;
    const x0 = m.position[0] + c.origin[0];
    const y0 = m.position[1] + (m.feet ?? 0) + c.origin[1];
    rects.push({ type: 'open', x0, x1: x0 + c.size[0], y0, y1: y0 + c.size[1], tone: tone(colorOf.get(m.materialId)) });
  }
  for (const m of design.modules) {
    if (m.kind !== 'panel' && m.kind !== 'ledge') continue;
    const x0 = m.position[0] - m.width / 2;
    rects.push({ type: m.kind, x0, x1: x0 + m.width, y0: m.position[1], y1: m.position[1] + m.height, tone: tone(colorOf.get(m.materialId)) });
  }
  const b = g.bounds ?? null;
  const xs = g.parts.flatMap((p) => [p.position[0] - p.size[0] / 2, p.position[0] + p.size[0] / 2]);
  const ys = g.parts.flatMap((p) => [p.position[1] - p.size[1] / 2, p.position[1] + p.size[1] / 2]);
  const zs = g.parts.flatMap((p) => [p.position[2] - p.size[2] / 2, p.position[2] + p.size[2] / 2]);
  void b;
  const env = {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    d: Math.max(...zs) - Math.min(...zs),
  };
  const boxes = design.modules.filter((m) => m.kind !== 'panel' && m.kind !== 'ledge');
  return {
    env,
    rects,
    feet: Math.max(0, ...boxes.map((m) => m.feet ?? 0)),
    modules: design.modules.length,
    room: room
      ? {
          widthMm: room.widthMm,
          // Do canto esquerdo da parede ao móvel, como o app calcula (wallAt):
          // parede presa no mundo (anchor) ou encostada atrás do móvel.
          offsetMm: room.anchor ? Math.min(...xs) - room.anchor.x : (room.offsetMm ?? 0),
          obstacles: (room.obstacles ?? []).map((o) => ({ kind: o.kind, xMm: o.xMm, yMm: o.yMm, widthMm: o.widthMm, heightMm: o.heightMm })),
        }
      : null,
  };
}

const count = (fp, type) => fp.rects.filter((r) => r.type === type).length;
const TYPES = ['door', 'drawer', 'open', 'panel', 'ledge'];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Retângulos na caixa [0,1] do envelope: compara layout sem depender da escala. */
function unit(fp) {
  const { x0, y0, w, h } = fp.env;
  return fp.rects.map((r) => ({ ...r, x0: (r.x0 - x0) / w, x1: (r.x1 - x0) / w, y0: (r.y0 - y0) / h, y1: (r.y1 - y0) / h }));
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
}

/**
 * Quanto o resultado se parece com o gabarito, de 0 a 1, e por quê.
 * - layout: frentes casadas por tipo e posição relativa (IoU), e a contagem de cada tipo;
 * - medidas: largura, altura, profundidade e altura do chão;
 * - detalhes: pés e tom das frentes;
 * - ambiente (só quando o gabarito tem): parede e cada porta, janela e TV no lugar.
 */
export function similarity(t, r) {
  const T = unit(t);
  const R = unit(r);
  const pairs = [];
  T.forEach((a, i) => R.forEach((b, j) => a.type === b.type && pairs.push({ i, j, v: iou(a, b) })));
  pairs.sort((a, b) => b.v - a.v);
  const usedT = new Set();
  const usedR = new Set();
  let matched = 0;
  let toneHits = 0;
  for (const p of pairs) {
    if (usedT.has(p.i) || usedR.has(p.j) || p.v <= 0) continue;
    usedT.add(p.i);
    usedR.add(p.j);
    matched += p.v;
    if (T[p.i].tone === R[p.j].tone) toneHits++;
  }
  const place = T.length || R.length ? matched / Math.max(T.length, R.length) : 1;
  const present = TYPES.filter((k) => count(t, k) || count(r, k));
  const counts = present.length
    ? present.reduce((s, k) => s + Math.min(count(t, k), count(r, k)) / Math.max(count(t, k), count(r, k)), 0) / present.length
    : 1;
  const layoutScore = 0.6 * place + 0.4 * counts;
  const rel = (a, b, tol) => clamp01(1 - Math.abs(a - b) / b / tol);
  const dims = (2 * rel(r.env.w, t.env.w, 0.4) + 2 * rel(r.env.h, t.env.h, 0.4) + rel(r.env.d, t.env.d, 0.5) + clamp01(1 - Math.abs(r.env.y0 - t.env.y0) / 600)) / 6;
  const feet = (t.feet > 0) === (r.feet > 0) ? 1 : 0;
  const tones = T.length ? toneHits / T.length : 1;
  const details = 0.5 * feet + 0.5 * tones;
  let roomScore = null;
  const notes = [];
  if (t.room) {
    if (!r.room) roomScore = 0;
    else {
      const wall = rel(r.room.widthMm, t.room.widthMm, 0.4);
      const obs = t.room.obstacles.map((o) => {
        const cands = r.room.obstacles.filter((v) => v.kind === o.kind);
        if (!cands.length) {
          notes.push(`sem ${o.kind}`);
          return 0;
        }
        // Posição na parede em fração da largura: a escala da foto é estimada.
        const c = (v, room) => (v.xMm + v.widthMm / 2) / room.widthMm;
        return Math.max(
          ...cands.map((v) => clamp01(1 - Math.abs(c(v, r.room) - c(o, t.room)) / 0.25) * rel(v.widthMm, o.widthMm, 0.6)),
        );
      });
      // Onde o móvel fica na parede, também em fração.
      const at = (fp) => ((fp.room.offsetMm ?? 0) + fp.env.w / 2) / fp.room.widthMm;
      const spot = clamp01(1 - Math.abs(at(r) - at(t)) / 0.25);
      roomScore = (wall + obs.reduce((s, v) => s + v, 0) + spot) / (obs.length + 2);
    }
  }
  const total =
    roomScore === null
      ? 0.5 * layoutScore + 0.3 * dims + 0.2 * details
      : 0.4 * layoutScore + 0.2 * dims + 0.1 * details + 0.3 * roomScore;
  for (const k of TYPES) if (count(t, k) !== count(r, k)) notes.push(`${k} ${count(r, k)}/${count(t, k)}`);
  if (feet < 1) notes.push(t.feet > 0 ? 'sem pés' : 'pés a mais');
  notes.push(`${Math.round(r.env.w)}×${Math.round(r.env.h)}×${Math.round(r.env.d)} para ${Math.round(t.env.w)}×${Math.round(t.env.h)}×${Math.round(t.env.d)}`);
  const pct = (v) => Math.round(v * 100);
  return {
    total,
    parts: { layout: pct(layoutScore), medidas: pct(dims), detalhes: pct(details), ...(roomScore === null ? {} : { ambiente: pct(roomScore) }) },
    notes,
  };
}

/** Nota do resultado contra o gabarito `key`. */
export function scoreAgainst(key, design, room) {
  const t = truth(key);
  return similarity(fingerprint(t.design, t.room), fingerprint(design, room));
}

const SEM_RECUSA = /(não consigo medir|não posso medir|não é possível medir|imagem não está disponível)/i;
const caso = (id, image, key, prompt, learned, extra = {}) => ({
  id,
  group: 'foto-real',
  askAct: 'agir',
  image: `bench/images/${image}`,
  prompt,
  truth: key,
  expect: {
    action: ['update'],
    applied: true,
    minScore: 0.7,
    score: (design, room) => scoreAgainst(key, design, room),
    content: { mustNotMatch: [SEM_RECUSA] },
  },
  learned,
  ...extra,
});

/** Casos do grupo foto-real: pedidos como a pessoa faria, com a foto do celular. */
export const photoCases = [
  caso('real-01', 'real-comoda.jpg', 'comoda', 'Quero uma cômoda igual a essa da foto.', 'Cômoda comum de quarto: quatro gavetas com nicho em cima, e do lado duas gavetas e uma porta.'),
  caso('real-02', 'real-guarda-roupa-duas-cores.jpg', 'guarda-roupa-duas-cores', 'Faz esse guarda-roupa pra mim, com as mesmas cores.', 'Dois corpos de cores diferentes: preto com duas portas e madeira com duas portas sobre duas gavetas. Na foto há também um gaveteiro e uma porta do quarto.'),
  caso('real-03', 'real-guarda-roupa-8-portas.jpg', 'guarda-roupa-8-portas', 'Use esta imagem como referência para a estante.', 'O pedido real que abriu esta rodada: o modelo usou o guarda-roupa da biblioteca (gaveteiro no meio, cinco colunas) em vez das quatro colunas de portas da foto.'),
  caso('real-04', 'real-quarto-guarda-roupa.jpg', 'gaveteiro', 'Quero fazer esse gaveteiro de madeira da esquerda, com as 6 gavetas.', 'Foto com vários móveis: o pedido aponta o gaveteiro entalhado ao lado do guarda-roupa.'),
  caso('real-05', 'real-quarto-nicho.jpg', 'nicho-parede', 'Quero essa prateleira com nichos que está na parede, em cima da cama.', 'Nicho suspenso comprido, três vãos abertos, preso na parede acima da cama.'),
  caso('real-12', 'real-nicho-frente.jpg', 'nicho-parede', 'Faz essa prateleira de nichos igual à da foto.', 'A mesma prateleira do quarto verde, de frente e de perto: três nichos iguais, laterais inclinadas (fora do contrato) e mãos-francesas.'),
  caso('real-06', 'real-sala-painel.jpg', 'painel-sala', 'Monta essa parede da minha sala: o painel da TV com o rack e a porta do lado.', 'Painel com prateleira em cima, rack suspenso de duas gavetas com tampo de madeira, TV e a porta de entrada na mesma parede.'),
  caso('real-07', 'real-quarto-janela.jpg', 'quarto-janela', 'Monte essa parede do meu quarto como está na foto: a janela e a cômoda do lado.', 'Parede com janela e a cômoda à esquerda dela; a cama e o nicho ficam fora do pedido.'),
  caso('real-08', 'real-quarto-verde.jpg', 'guarda-roupa-duas-cores', 'Quero um guarda-roupa igual a esse preto e madeira.', 'O mesmo guarda-roupa de duas cores, visto de lado com a cama e a porta na frente.'),
  caso('real-09', 'real-cozinha-pia.jpg', 'cozinha-pia', 'Monte a parede da pia da minha cozinha como na foto: o gabinete com as portas e as gavetas, o espaço do fogão e a janela.', 'Cozinha real: gabinete branco sob a pia, fogão de piso à esquerda, geladeira à direita, janela larga e nenhum aéreo. O ativo "cozinha" traz aéreo e não serve como está.'),
  caso('real-11', 'real-cozinha-geral.jpg', 'cozinha-pia', 'Monte a parede da pia como nessa foto da cozinha, com o fogão, o gabinete e a janela.', 'A mesma parede da pia vista do canto, com a ilha e a torre na frente: o pedido é só a parede da pia.'),
  caso('real-10', 'real-cozinha-torre.jpg', 'torre-micro', 'Faz esse armário branco do micro-ondas que fica do lado da geladeira.', 'Torre alta com nicho aberto para o micro-ondas: portas em cima e embaixo, gaveta sob o nicho, em foto com geladeira e ilha na frente.'),
];
