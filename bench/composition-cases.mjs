/**
 * Grupo `composicao`: o pedido criativo em volta da TV e o pacote de
 * regressão do redesenho (docs/plans/redesign-verification.md).
 *
 * Cada caso parte de uma cena gravada em `bench/scenes` (cópia isolada do
 * projeto real, nunca o banco) e é julgado pelo oráculo próprio
 * (`bench/oracle.mjs`), não pelo validador do app.
 *
 * `tv-03` é o caso guardado: as expectativas foram escritas antes de rodar o
 * candidato e não mudam depois de ver o resultado.
 */
import { checkComposition, clearFloorSpans, floorGaps, moduleBoxes, offWall, sheetClaims, sheetFacts } from './oracle.mjs';

/** Juiz comum dos pedidos criativos: regras duras do oráculo. */
const composition =
  ({ protect, requireAddition = true } = {}) =>
  (got) => {
    const r = checkComposition({
      before: got.before,
      after: got.designAfter,
      roomBefore: got.roomBefore,
      roomAfter: got.room,
      protect,
      requireAddition,
      content: got.content,
      undo: got.undo,
    });
    got.oracle = r;
    return r.ok ? true : r.failures.join('; ');
  };

export const compositionGroup = {
  composicao:
    'Pacote do redesenho: composição em volta da TV, cozinha, lavanderia, guarda-roupa, estante, layout, edição exata e pedido impossível (oráculo próprio)',
};

/** Regras duras comuns (geometria, encaixe, TV, fixação do que entrou, protegidos, Ctrl+Z). */
const hard = (got, extra = {}) =>
  checkComposition({
    before: got.before,
    after: got.designAfter,
    roomBefore: got.roomBefore,
    roomAfter: got.room,
    content: got.content,
    undo: got.undo,
    ...extra,
  });
/** Afirma ter feito o que o estúdio não tem (mesa, cadeira, vidro, curva)? */
const claimsUnsupported = (text, words) =>
  new RegExp(`\\b(adicionei|coloquei|montei|criei|incluí|fiz)\\b[^.]*\\b(${words})`, 'i').test(text) && !/não|nao|sem|fora/i.test(text);

export const compositionCases = [
  {
    id: 'tv-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    // O pedido gravado, com os erros de digitação da pessoa.
    prompt: 'Vamos adicionar os nossos modelos custum no painel seja creativo',
    setup: { scene: 'bench/scenes/painel-tv.json' },
    learned:
      'Pedido real de 26/09 (Luna): 16 chamadas, 160 s, seis recusas (vão de 78 e 22 mm, nicho sobreposto ao painel duas vezes, profundidade e altura fora do limite) e o resultado aceito tapava a TV com um nicho alto e chamava de prateleira um painel vertical de 900 × 220 × 25 mm.',
    expect: { action: 'update', applied: true, agent: composition() },
  },
  {
    id: 'tv-02',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Monte uns módulos criativos em volta da TV, aproveitando o painel. Pode usar carvalho.',
    setup: { scene: 'bench/scenes/painel-65.json' },
    learned: 'Variação não vista: painel largo, TV de 65" fora do centro, rack embaixo e janela à direita.',
    expect: { action: 'update', applied: true, agent: composition() },
  },
  {
    id: 'tv-03',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Quero nichos e prateleiras na parede em volta da TV, algo bonito e equilibrado.',
    setup: { scene: 'bench/scenes/parede-tv.json' },
    learned: 'Caso guardado: parede lisa sem painel, rack de TV da biblioteca embaixo. Expectativa congelada antes do candidato.',
    expect: { action: 'update', applied: true, agent: composition() },
  },
  {
    id: 'coz-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'adicione outros moveis junto que fazem snetidom em uma cozinha, uma mesa, cadeiras, etc',
    setup: { scene: 'bench/scenes/cozinha-apoio.json' },
    learned: 'Pedido real: a IA montou um apoio, descartou com history_undo, montou outro; o registro guardou a operação descartada. Mesa e cadeira não existem no estúdio.',
    expect: {
      action: 'update',
      applied: true,
      content: { mustMatch: [/mesa|cadeira/i] },
      agent: (got) => {
        const r = hard(got, { requireAddition: true });
        if (!r.ok) return r.failures.join('; ');
        if (claimsUnsupported(got.content, 'mesa|cadeira')) return 'diz que pôs mesa ou cadeira';
        const off = offWall(got.designAfter, got.room);
        return off.length ? `fora da parede: ${off.join(', ')}` : true;
      },
    },
  },
  {
    id: 'coz-02',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    // "na altura de antes" era ambíguo (a IA não sabe o que era antes da bagunça): a medida vai no pedido.
    prompt: 'arrume o layout: tudo encostado na parede, os armários de baixo juntos, sem vão entre eles, e os aéreos com a base a 1,5 m do piso',
    setup: { scene: 'bench/scenes/cozinha-baguncada.json' },
    learned: 'Mudança de layout: só posições mudam; medidas, frentes e acabamentos ficam. Pedido real parecido esbarrou em "Selecione uma prateleira horizontal".',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const before = got.before.modules;
        const after = got.designAfter.modules;
        if (after.length !== before.length) return `${before.length} → ${after.length} módulos`;
        const strip = (m) => JSON.stringify({ ...m, position: 0, name: 0 });
        const changed = before.filter((m) => strip(m) !== strip(after.find((v) => v.id === m.id) ?? {}));
        if (changed.length) return `mudou mais que a posição: ${changed.map((m) => m.name).join(', ')}`;
        const off = offWall(got.designAfter, null);
        if (off.length) return `fora da parede: ${off.join(', ')}`;
        const gaps = floorGaps(got.designAfter);
        if (gaps.length) return `vão entre os de baixo: ${gaps.join('; ')}`;
        const { boxes } = moduleBoxes(got.designAfter);
        const uppers = after.filter((m) => m.wall).map((m) => Math.round(boxes.get(m.id).minY));
        return uppers.every((y) => y === 1500) ? true : `aéreos com base em ${[...new Set(uppers)].join(', ')} mm (antes: 1500)`;
      },
    },
  },
  {
    id: 'coz-03',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: '"Não cabe: o móvel tem 4,86 m de largura e a parede tem 3,00 m" arrume isso',
    setup: { scene: 'bench/scenes/cozinha-3m.json' },
    learned: 'A parede de 3 m foi medida depois da cozinha: o certo é caber nela sem mexer na parede.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        if (got.room?.widthMm !== 3000) return `mexeu na parede (${got.room?.widthMm} mm)`;
        const r = hard(got, { protect: [] });
        if (!r.ok) return r.failures.join('; ');
        const { boxes } = moduleBoxes(got.designAfter);
        const low = got.designAfter.modules.filter((m) => boxes.get(m.id).minY <= 5).length;
        const high = got.designAfter.modules.filter((m) => m.wall).length;
        return low >= 3 && high >= 2 ? true : `sobrou pouca cozinha: ${low} de baixo, ${high} aéreos`;
      },
    },
  },
  {
    id: 'coz-04',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Deixe a bancada com 90 cm de altura',
    setup: { scene: 'bench/scenes/cozinha-apoio.json' },
    learned: 'Edição exata numa fileira com painéis compartilhados: a altura vale para a fileira toda, e os aéreos não podem bater.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const r = hard(got, { protect: got.before.modules.filter((m) => m.wall).map((m) => m.id) });
        if (!r.ok) return r.failures.join('; ');
        const bases = got.designAfter.modules.filter((m) => !m.wall);
        const wrong = bases.filter((m) => Math.abs(m.height + (m.feet ?? 0) - 900) > 2);
        if (wrong.length) return `altura total fora de 900 mm: ${wrong.map((m) => `${m.name} ${m.height + (m.feet ?? 0)}`).join(', ')}`;
        const widths = bases.filter((m) => got.before.modules.find((v) => v.id === m.id)?.width !== m.width);
        return widths.length ? `mudou a largura de ${widths.map((m) => m.name).join(', ')}` : true;
      },
    },
  },
  {
    id: 'lav-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Adicone mais moveis e deixe o ceneario mais realista',
    setup: { scene: 'bench/scenes/lavanderia-2.json' },
    learned:
      'Pedido real (DeepSeek): estourou o tempo, gravou 4 módulos e um móvel de 4,20 m numa parede de 3,20 m, e a resposta disse "O móvel não mudou".',
    expect: {
      action: ['update', 'answer'],
      agent: (got) => {
        const r = hard(got, { requireAddition: got.action === 'update' });
        if (!r.ok) return r.failures.join('; ');
        if (got.action === 'update' && /não mudou/i.test(got.content)) return 'diz que não mudou, mas mudou';
        return true;
      },
    },
  },
  {
    id: 'lav-02',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Deixe um vão livre de 60 cm para a máquina de lavar à esquerda do armário e coloque um armário aéreo em cima dela',
    setup: { scene: 'bench/scenes/lavanderia-3.json' },
    learned: 'Pedido real parecido: criou caixas chamadas "Vão máquina de lavar". O nome não faz o vão: o oráculo confere o espaço livre.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const r = hard(got);
        if (!r.ok) return r.failures.join('; ');
        const { boxes, bounds } = moduleBoxes(got.designAfter);
        const wallX = got.room.anchor?.x ?? bounds.min[0] - (got.room.offsetMm ?? 0);
        const armario = Math.min(...['l1', 'l2'].map((id) => boxes.get(id).minX)) - wallX;
        const spans = clearFloorSpans(got.designAfter, got.room).filter(([a, b]) => b - a >= 595 && b <= armario + 1);
        if (!spans.length) return 'sem vão livre de 60 cm no piso à esquerda do armário';
        const over = got.designAfter.modules.filter((m) => {
          const b = boxes.get(m.id);
          return b.minY >= 850 && spans.some(([a, c]) => Math.min(b.maxX - wallX, c) - Math.max(b.minX - wallX, a) > 300);
        });
        return over.length ? true : 'sem armário aéreo em cima do vão';
      },
    },
  },
  {
    id: 'gr-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Adicione um módulo de 60 cm à direita do guarda-roupa, com a mesma altura e profundidade, com prateleiras e uma porta',
    setup: { scene: 'bench/scenes/guarda-roupa-quarto.json' },
    learned: 'Guarda-roupa que cresce de lado: mesma altura e profundidade, encostado, com interior e frente.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const r = hard(got, { requireAddition: true });
        if (!r.ok) return r.failures.join('; ');
        const had = new Set(got.before.modules.map((m) => m.id));
        const added = got.designAfter.modules.filter((m) => !had.has(m.id));
        if (added.length !== 1) return `${added.length} módulos novos`;
        const m = added[0];
        if (Math.abs(m.width - 600) > 20) return `largura ${m.width}`;
        if (m.height !== 2400 || m.depth !== 600) return `altura/profundidade ${m.height}/${m.depth}`;
        const { boxes } = moduleBoxes(got.designAfter);
        const right = Math.max(...got.before.modules.map((v) => boxes.get(v.id).maxX));
        if (Math.abs(boxes.get(m.id).minX - right) > 20) return 'não encostou à direita do guarda-roupa';
        const parts = got.parts.filter((p) => p.owners.includes(m.id));
        if (parts.filter((p) => p.kind === 'shelf').length < 2) return 'menos de 2 prateleiras';
        return parts.some((p) => p.kind === 'door') ? true : 'sem porta';
      },
    },
  },
  {
    id: 'gr-02',
    group: 'composicao',
    askAct: 'livre',
    agentOnly: true,
    prompt: 'Coloque uma sapateira de 60 cm ao lado do guarda-roupa',
    setup: { scene: 'bench/scenes/guarda-roupa-porta.json' },
    learned: 'Sem lugar: o canto fica à esquerda e a porta do quarto 8 cm à direita. O certo é dizer o conflito e o que dá para fazer, sem tapar a porta nem mexer na parede.',
    expect: {
      action: ['update', 'answer', 'clarify'],
      agent: (got) => {
        if (JSON.stringify(got.room?.obstacles) !== JSON.stringify(got.roomBefore?.obstacles) || got.room?.widthMm !== got.roomBefore?.widthMm)
          return 'mexeu na parede ou na porta';
        const r = hard(got, { protect: got.action === 'update' ? [] : undefined });
        if (!r.ok) return r.failures.join('; ');
        if (got.action !== 'update' && !/porta|espaço|cabe|canto/i.test(got.content)) return 'não explicou o conflito';
        return true;
      },
    },
  },
  {
    id: 'est-10',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Quero uma estante de 1,6 m de largura por 2 m de altura, com nichos abertos em cima e portas embaixo',
    learned: 'Estante do zero sobre o projeto novo: medidas ditadas valem, e o interior precisa ter nichos em cima e portas embaixo.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const r = hard(got, { protect: [] });
        if (!r.ok) return r.failures.join('; ');
        const d = got.designAfter;
        if (Math.abs(d.width - 1600) > 20 || Math.abs(d.height - 2000) > 20) return `medidas ${Math.round(d.width)} × ${Math.round(d.height)}`;
        const doors = got.parts.filter((p) => p.kind === 'door');
        if (!doors.length) return 'sem portas';
        if (doors.some((p) => p.position[1] > 1000)) return 'porta na parte de cima';
        const open = got.cells.filter((c) => !c.node.split && !c.node.front && c.origin[1] > 900);
        return open.length >= 2 ? true : 'menos de 2 nichos abertos em cima';
      },
    },
  },
  {
    id: 'esc-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Monte uma estante para livros em volta da janela, com armários baixos embaixo dela',
    setup: { scene: 'bench/scenes/escritorio-janela.json' },
    learned: 'Caso guardado fora de TV: janela no meio da parede e uma cômoda no canto. Expectativa congelada antes do candidato.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const r = hard(got, { requireAddition: true });
        if (!r.ok) return r.failures.join('; ');
        const had = new Set(got.before.modules.map((m) => m.id));
        const shelves = got.parts.filter((p) => p.kind === 'shelf' && p.owners.some((o) => !had.has(o))).length;
        return shelves >= 3 ? true : `só ${shelves} prateleiras novas`;
      },
    },
  },
  {
    id: 'mat-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Reduco a quantidade placas necesseria, entao tudo do mesmo material',
    setup: { scene: 'bench/scenes/painel-criativo.json' },
    learned:
      'Pedido real: trocou o carvalho por nogueira, leu o orçamento, depois passou os painéis de 25 para 18 mm e respondeu que o plano ainda usava 25 e 18 mm. O estado final tinha 2 chapas de nogueira 18 mm.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const before = sheetFacts(got.before),
          after = sheetFacts(got.designAfter);
        if (after.sheets >= before.sheets) return `chapas ${before.sheets} → ${after.sheets}: não reduziu`;
        const materials = new Set(got.designAfter.modules.map((m) => m.materialId));
        if (materials.size > 1) return `ainda usa ${materials.size} acabamentos`;
        const wrong = sheetClaims(got.content, got.designAfter);
        return wrong.length ? `resposta contradiz o plano final: ${wrong.join('; ')}` : true;
      },
    },
  },
  {
    id: 'rem-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Remove tudo menos a tv e o painel',
    setup: { scene: 'bench/scenes/painel-rack.json' },
    learned: 'Pedido real: a primeira tentativa foi recusada com "Separe as conexões antes de remover o módulo".',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const ids = got.designAfter.modules.map((m) => m.id);
        if (ids.length !== 1 || ids[0] !== 'p') return `ficaram ${ids.join(', ')}`;
        const r = checkComposition({ before: got.before, after: got.designAfter, roomBefore: got.roomBefore, roomAfter: got.room, protect: ['p'], content: got.content });
        if (!r.ok) return r.failures.join('; ');
        const bookkeeping = got.steps.filter((s) => !s.ok && /Separe|conex/i.test(s.detail ?? ''));
        return bookkeeping.length ? `a IA teve de separar conexões à mão (${bookkeeping.length} recusa(s))` : true;
      },
    },
  },
  {
    id: 'rep-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Crie um gaveteiro de 80 × 90 × 45 cm no lugar da estante',
    learned: 'Pedido real parecido: a primeira tentativa foi recusada com "Mantenha ao menos um módulo".',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const d = got.designAfter;
        if (d.modules.some((m) => m.id === 'module-1')) return 'a estante continua no projeto';
        const w = Math.round(d.width),
          h = Math.round(d.height),
          dep = Math.round(d.depth);
        if (Math.abs(w - 800) > 2 || Math.abs(h - 900) > 2 || Math.abs(dep - 450) > 2) return `medidas ${w} × ${h} × ${dep} mm`;
        const drawers = got.parts.filter((p) => p.kind === 'drawer' && p.id.endsWith(':front')).length;
        if (!drawers) return 'sem gavetas';
        const empty = got.steps.filter((s) => !s.ok && /ao menos um módulo/i.test(s.detail ?? ''));
        return empty.length ? 'a IA viu o erro de projeto vazio' : true;
      },
    },
  },
  {
    id: 'edit-01',
    group: 'composicao',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Deixe o nicho de destaque com 35 cm de largura e em nogueira, sem mexer no resto.',
    setup: { scene: 'bench/scenes/painel-criativo.json' },
    learned: 'Edição exata depois de uma composição: a medida pedida vale e o resto não muda.',
    expect: {
      action: 'update',
      applied: true,
      agent: (got) => {
        const n = got.designAfter.modules.find((m) => m.id === 'nicho-destaque');
        if (!n) return 'o nicho de destaque sumiu';
        if (n.width !== 350) return `largura ${n.width} mm`;
        if (n.materialId !== 'walnut') return `acabamento ${n.materialId}`;
        const others = got.before.modules.filter((m) => m.id !== 'nicho-destaque');
        const changed = others.filter((m) => JSON.stringify(m) !== JSON.stringify(got.designAfter.modules.find((v) => v.id === m.id)));
        if (changed.length) return `mexeu em ${changed.map((m) => m.name).join(', ')}`;
        const was = got.before.modules.find((m) => m.id === n.id);
        const also = ['height', 'depth'].filter((k) => n[k] !== was[k]);
        return also.length ? `mudou também ${also.join(', ')}` : true;
      },
    },
  },
  {
    id: 'imp-01',
    group: 'composicao',
    askAct: 'livre',
    agentOnly: true,
    prompt: 'Coloque uma estante de vidro curva de 3 metros bem na frente da TV',
    setup: { scene: 'bench/scenes/painel-tv.json' },
    learned: 'Pedido impossível de propósito: vidro e curva não existem, e na frente da TV tapa a tela.',
    expect: {
      action: ['update', 'answer', 'clarify'],
      content: { mustMatch: [/vidro|curv/i] },
      agent: (got) => {
        const r = checkComposition({
          before: got.before,
          after: got.designAfter,
          roomBefore: got.roomBefore,
          roomAfter: got.room,
          content: got.content,
        });
        const hard = r.failures.filter((f) => !/prateleira/.test(f));
        if (hard.length) return hard.join('; ');
        if (/\b(fiz|montei|coloquei|adicionei)\b[^.]*\b(vidro|curva)/i.test(got.content) && !/sem|não|nao/i.test(got.content))
          return 'diz que fez vidro ou curva';
        return true;
      },
    },
  },
];
