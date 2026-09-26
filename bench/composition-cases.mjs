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
import { checkComposition, sheetClaims, sheetFacts } from './oracle.mjs';

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
  composicao: 'Composição criativa em volta da TV e o pacote de regressão do redesenho (oráculo próprio)',
};

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
