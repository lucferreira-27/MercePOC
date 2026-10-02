/**
 * Móveis das fotos de referência que o usuário mandou, montados só com
 * operações do contrato (o mesmo caminho do design_apply da IA e da
 * biblioteca). `tests/references.test.ts` confere cada um; o seed de captura
 * carrega no app para comparar com a foto. Cada um usa só o que já existe:
 * o que a foto tem e o estúdio não faz fica dito no comentário.
 */
import { Builder } from '../../lib/assets';
import type { Composition, ModularOp } from '../../lib/composition';
import type { MaterialId } from '../../lib/furniture';
import type { Look } from '../../lib/look';

/** Acabamento em vários módulos de uma vez (a base vale para a fileira toda). */
function look(b: Builder, ids: string[], value: Look, extra: Partial<Extract<ModularOp, { kind: 'module.edit' }>> = {}) {
  for (const id of ids) b.op({ kind: 'module.edit', id, look: value, ...extra });
}
const steel = { frame: true, frameMaterialId: 'steel-black', handle: 'bar', handleMaterialId: 'steel-black' } as const satisfies Look;

/** Rack industrial: estrutura de aço, portas de tela em quadro de aço, nicho com prateleira, carvalho, pés de tubo. */
export function rackIndustrial(): Composition {
  const b = new Builder('');
  const ids = b.row('r', ['Porta esquerda', 'Nicho', 'Porta direita'], [560, 500, 560], 550, 450, 'oak', { feet: 100 });
  look(b, ids, { ...steel, legs: 'tube', legMaterialId: 'steel-black', front: 'mesh', insertMaterialId: 'steel-black' });
  b.front(b.root(ids[0]), 'single', { hinge: 'left', materialId: 'steel-black' as MaterialId });
  b.front(b.root(ids[2]), 'single', { hinge: 'right', materialId: 'steel-black' as MaterialId });
  b.split(b.root(ids[1]), 'y', 230);
  return b.d!;
}

/**
 * Aparador industrial (a parte de baixo da foto): porta de tela larga, três
 * gavetas de madeira no meio e porta de tela estreita, corpo preto com
 * contorno de aço. O nível aberto em cima (estrutura com tampo de madeira)
 * é uma estrutura aberta, que vem com as mesas.
 */
export function aparadorIndustrial(): Composition {
  const b = new Builder('');
  const ids = b.row('a', ['Porta larga', 'Gavetas', 'Porta estreita'], [560, 420, 420], 650, 450, 'black');
  look(b, ids, { ...steel, top: { materialId: 'walnut-solid', thickness: 30, overhang: 0, edge: 'square' } });
  // Portas de tela em quadro de aço com barra; gavetas lisas com perfil.
  look(b, [ids[0], ids[2]], { front: 'mesh', insertMaterialId: 'steel-black' });
  b.op({ kind: 'module.edit', id: ids[1], look: { handle: 'edge' } });
  b.front(b.root(ids[0]), 'single', { hinge: 'left', materialId: 'steel-black' as MaterialId });
  b.front(b.root(ids[1]), 'drawers', { count: 3, materialId: 'oak' });
  b.front(b.root(ids[2]), 'single', { hinge: 'right', materialId: 'steel-black' as MaterialId });
  return b.d!;
}

/**
 * Bancada de oficina: base com contorno de aço (gaveteiro de seis, nicho com
 * prateleira, gaveteiro de cinco), tampo de nogueira maciça, painel de
 * ferramentas perfurado na parede e armário aéreo com nicho iluminado,
 * gavetinhas e porta dupla. A cuba e a torneira ficam de fora.
 */
export function bancadaOficina(): Composition {
  const b = new Builder('');
  // Fileira de 1764 mm centrada na parede (x 0), fundo encostado (z -300).
  const base = b.row('b', ['Gaveteiro esquerdo', 'Nicho', 'Gaveteiro direito'], [600, 600, 600], 860, 600, 'walnut', { position: [-582, 0, 0] });
  look(b, base, { ...steel, handleMaterialId: 'steel-brushed', top: { materialId: 'walnut-solid', thickness: 40, overhang: 20, edge: 'square' } });
  b.front(b.root(base[0]), 'drawers', { count: 6 });
  b.split(b.root(base[1]), 'y', 380);
  b.front(b.root(base[2]), 'drawers', { count: 5 });
  // Painel de ferramentas de 1,7 m entre a bancada e o aéreo, preso na parede.
  b.panel('p', 'Painel de ferramentas', [1700, 520, 18], 'black', [0, 960, -300 + 9]);
  b.op({ kind: 'module.edit', id: 'p', look: { front: 'perforated' } });
  const up = b.row('u', ['Nicho iluminado', 'Gavetinhas', 'Portas'], [500, 500, 800], 420, 350, 'walnut', { position: [-632, 1500, -300 + 175], wall: true });
  look(b, up, { ...steel });
  b.op({ kind: 'module.edit', id: up[0], look: { ...steel, led: true } });
  b.front(b.root(up[1]), 'drawers', { count: 3 });
  b.front(b.root(up[2]), 'double');
  return b.d!;
}

/**
 * Cozinha de pinus com serralheria: cada porta e gaveta num quadro de aço
 * preto com almofada de pinus, tampo de Nero, base aparente preta e aéreos
 * do mesmo jeito. Fogão, cuba e coifa ficam de fora (vão reservado, se
 * precisar).
 */
export function cozinhaPinus(): Composition {
  const b = new Builder('');
  const widths = [500, 800, 600, 600];
  const base = b.row('b', ['Portas', 'Gavetas largas', 'Pia', 'Gaveteiro'], widths, 820, 580, 'black', { feet: 80, position: [-973, 0, 0] });
  look(b, base, { legs: 'skirt', front: 'framed', insertMaterialId: 'pine', handle: 'edge', handleMaterialId: 'steel-black', top: { materialId: 'nero', thickness: 20, overhang: 20, edge: 'square' } });
  b.front(b.root(base[0]), 'double', { materialId: 'steel-black' as MaterialId });
  b.front(b.root(base[1]), 'drawers', { count: 2, materialId: 'pine' });
  b.front(b.root(base[2]), 'double', { materialId: 'steel-black' as MaterialId });
  b.front(b.root(base[3]), 'drawers', { count: 3, materialId: 'pine' });
  const up = b.row('a', ['Aéreo 1', 'Aéreo 2', 'Aéreo 3'], [800, 700, 800], 560, 330, 'black', { position: [-732, 1500, -290 + 165], wall: true });
  look(b, up, { front: 'framed', insertMaterialId: 'pine', handle: 'edge', handleMaterialId: 'steel-black', frame: true, frameMaterialId: 'steel-black' });
  for (const id of up) b.front(b.root(id), 'double', { materialId: 'steel-black' as MaterialId });
  return b.d!;
}

/**
 * Parede de garagem: base de nogueira escura com frentes shaker, gaveteiro
 * e tampo grafite, colunas altas de nichos com LED e moldura no topo, e o
 * painel de ferramentas no meio. O rack de teto fica de fora.
 */
export function garagem(): Composition {
  const b = new Builder('');
  const base = b.row('b', ['Portas', 'Gavetas', 'Portas 2'], [800, 600, 800], 820, 600, 'smoked', { feet: 100, position: [-682, 0, 0] });
  look(b, base, { legs: 'skirt', front: 'shaker', handleMaterialId: 'steel-brushed', top: { materialId: 'nero', thickness: 30, overhang: 20, edge: 'square' } });
  b.front(b.root(base[0]), 'double');
  b.front(b.root(base[1]), 'drawers', { count: 4 });
  b.front(b.root(base[2]), 'double');
  const tall = b.box('t', 'Coluna de nichos', [500, 2300, 450], 'smoked', { position: [1082 + 50 + 250, 0, -300 + 225] });
  b.stack(b.root(tall), 5, 2300 - 36);
  b.op({ kind: 'module.edit', id: tall, look: { cornice: true, led: true } });
  b.panel('p', 'Painel de ferramentas', [2164, 560, 18], 'graphite', [0, 1000, -300 + 9]);
  b.op({ kind: 'module.edit', id: 'p', look: { front: 'perforated' } });
  const up = b.row('u', ['Aéreo 1', 'Aéreo 2', 'Aéreo 3'], [740, 720, 740], 650, 350, 'smoked', { position: [-712, 1600, -300 + 175], wall: true });
  look(b, up, { front: 'shaker', handleMaterialId: 'steel-brushed', cornice: true, led: true });
  for (const id of up) b.front(b.root(id), 'double');
  return b.d!;
}

/**
 * Estante de nichos desencontrados em nogueira: sem fundo, base aparente, e
 * colunas com prateleiras em alturas diferentes (o desencontro vem das
 * divisões de cada coluna, não de uma grade).
 */
export function estanteDesencontrada(): Composition {
  const b = new Builder('');
  const id = b.box('e', 'Estante', [800, 1740, 320], 'walnut', { feet: 60 });
  b.op({ kind: 'module.edit', id, back: false, look: { legs: 'skirt' } });
  const [left, right] = b.split(b.root(id), 'x', 330);
  // Coluna da esquerda: quatro vãos; a da direita se divide de novo, com as
  // prateleiras deslocadas meia altura.
  b.split(left, 'y', 420);
  b.split(`${left}:high`, 'y', 360);
  b.split(`${left}:high:high`, 'y', 330);
  const [lowR, highR] = b.split(right, 'y', 230);
  b.split(highR, 'x', 160);
  b.split(`${highR}:low`, 'y', 470);
  b.split(`${highR}:high`, 'y', 640);
  b.split(`${highR}:high:high`, 'y', 330);
  void lowR;
  return b.d!;
}

/**
 * Rack com torres de aço (a foto com medidas): duas torres abertas de 395 ×
 * 1570 × 410 com cinco níveis, um console de 1460 com portas e nicho entre
 * elas e uma prateleira de parede fazendo a ponte por cima da TV.
 */
export function torresAco(): Composition {
  const b = new Builder('');
  // 30 mm entre a torre e o console: a porta da ponta abre inteira (a folha gira para fora da caixa).
  const tower = (key: string, name: string, x: number) =>
    b.table(key, name, [395, 1570, 410], 'oak-solid', { position: [x, 0, 0], shelves: 4, look: { legs: 'frame', legMaterialId: 'steel-black', top: { materialId: 'oak-solid', thickness: 30, overhang: 0, edge: 'square' } } });
  tower('t1', 'Torre esquerda', -(1460 / 2 + 395 / 2 + 30));
  tower('t2', 'Torre direita', 1460 / 2 + 395 / 2 + 30);
  const ids = b.row('c', ['Porta', 'Nicho', 'Porta 2'], [470, 538, 470], 450, 400, 'oak', { feet: 100, position: [-1460 / 2 + 235, 0, -5] });
  look(b, ids, { ...steel, legs: 'tube', legMaterialId: 'steel-black' });
  b.front(b.root(ids[0]), 'single', { hinge: 'left' });
  b.front(b.root(ids[2]), 'single', { hinge: 'right' });
  b.split(b.root(ids[1]), 'y', 180);
  b.op({ kind: 'module.add', id: 'ponte', preset: 'ledge', name: 'Ponte' });
  b.op({ kind: 'module.edit', id: 'ponte', width: 1460, height: 30, depth: 300, materialId: 'oak-solid', position: [0, 1400, -205 + 150] });
  return b.d!;
}

/**
 * O aparador industrial com o nível aberto em cima: a estrutura de aço sobe
 * do tampo e segura uma prateleira de madeira, como na foto.
 */
export function aparadorNivelAberto(): Composition {
  const d = aparadorIndustrial();
  const b = new Builder('');
  b.d = d;
  const width = 560 + 420 + 420 - 2 * 18;
  // A fileira começa no centro do primeiro módulo (x 0), 280 mm à direita da ponta.
  b.table('n', 'Nível aberto', [width, 420, 450], 'walnut-solid', { position: [-280 + width / 2, 650 + 30, 0], look: { legs: 'frame', legMaterialId: 'steel-black', top: { materialId: 'walnut-solid', thickness: 30, overhang: 0, edge: 'square' } } });
  return b.d!;
}

export const REFERENCES = {
  'rack-industrial': rackIndustrial,
  'aparador-industrial': aparadorIndustrial,
  'bancada-oficina': bancadaOficina,
  'cozinha-pinus': cozinhaPinus,
  garagem,
  'estante-desencontrada': estanteDesencontrada,
  'torres-aco': torresAco,
  'aparador-nivel-aberto': aparadorNivelAberto,
} as const;
