/**
 * Grupo `estilos`: a pessoa pede um estilo pelas palavras dela e o assistente
 * escolhe o estilo certo (asset.add com style, style.apply no que existe). A
 * conferência olha o que o estilo grava no módulo (base, puxador, frente,
 * cores), não o texto da resposta.
 *
 * Os casos `sty-h*` foram escritos antes da primeira rodada e não serviram
 * para ajustar o prompt: medem se o acerto vale para pedidos novos.
 */
export const styleGroup = { estilos: 'Estilo pedido pelas palavras da pessoa: escolher o estilo certo e vestir o móvel' };

/** Módulos de caixa ou mesa (sem painel nem prateleira de parede). */
const pieces = (design) => design.modules.filter((m) => !m.kind || m.kind === 'table');
/** Cada peça tem a base, o puxador ou a frente esperada (a maioria basta). */
const most = (design, test) => {
  const list = pieces(design);
  return list.length > 0 && list.filter(test).length >= Math.ceil(list.length / 2);
};
const legs = (...types) => (m) => types.includes(m.look?.legs);
const styled = (design, style) => design.style === style || most(design, (m) => !!m.look);
const width = (helpers) => {
  const xs = helpers.parts.flatMap((p) => [p.position[0] - p.size[0] / 2, p.position[0] + p.size[0] / 2]);
  return Math.round(Math.max(...xs) - Math.min(...xs));
};
const fronts = (helpers, type) => helpers.cells.filter((c) => c.node.front?.type === type).length;

export const styleCases = [
  {
    id: 'sty-01',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Quero uma estante industrial',
    expect: {
      action: ['update'],
      design: (d) => {
        if (!styled(d, 'industrial')) return 'sem estilo';
        if (!most(d, (m) => m.look?.frame || m.look?.legs === 'frame')) return 'sem estrutura de aço';
        return d.modules.some((m) => m.height + (m.feet ?? 0) >= 1200) ? true : 'não é estante (baixa)';
      },
    },
  },
  {
    id: 'sty-02',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Faz um aparador anos 60',
    expect: {
      action: ['update'],
      design: (d) => (most(d, legs('splayed', 'tapered')) ? true : `base ${pieces(d).map((m) => m.look?.legs ?? '-').join(',')}, esperava pé palito inclinado`),
    },
  },
  {
    id: 'sty-03',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Um criado-mudo escandinavo',
    expect: {
      action: ['update'],
      design: (d) => {
        if (!most(d, legs('tapered'))) return 'sem pé cônico';
        return most(d, (m) => ['white', 'ash', 'oak', 'sand'].includes(m.materialId)) ? true : 'cor escura para escandinavo';
      },
    },
  },
  {
    id: 'sty-04',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Monte uma cozinha rústica de 2,4 m',
    expect: {
      action: ['update'],
      design: (d, helpers) => {
        if (Math.abs(width(helpers) - 2400) > 80) return `largura ${width(helpers)} mm (pedido 2400)`;
        return most(d, (m) => m.look?.front === 'shaker' && ['pine', 'oak', 'pine-solid'].includes(m.materialId)) ? true : 'sem moldura ou sem pinus';
      },
    },
  },
  {
    id: 'sty-05',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Cômoda clássica com 4 gavetas',
    expect: {
      action: ['update'],
      design: (d, helpers) => {
        if (!most(d, (m) => m.look?.front === 'shaker')) return 'sem frente de moldura';
        const drawers = helpers.cells.reduce((n, c) => n + (c.node.front?.type === 'drawers' ? c.node.front.heights.length : 0), 0);
        return drawers >= 4 ? true : `${drawers} gavetas`;
      },
    },
  },
  {
    id: 'sty-06',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Rack minimalista sem puxador para a sala',
    expect: {
      action: ['update'],
      design: (d) => (most(d, (m) => ['groove', 'none'].includes(m.look?.handle)) ? true : 'com puxador aparente'),
    },
  },
  {
    id: 'sty-07',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Mesa de centro japandi',
    expect: {
      action: ['update'],
      design: (d) => {
        const t = d.modules.find((m) => m.kind === 'table');
        if (!t) return 'não montou mesa';
        if (t.height > 550) return `alta demais para mesa de centro: ${t.height} mm`;
        return t.look?.legs === 'block' ? true : `base ${t.look?.legs}`;
      },
    },
  },
  {
    id: 'sty-08',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Deixe este móvel industrial',
    setup: { ops: [{ kind: 'asset.add', asset: 'aparador', id: 'ap', placement: 'replace' }] },
    expect: {
      action: ['update'],
      design: (d, helpers) => {
        if (!most(d, (m) => m.look?.frame || m.look?.legs === 'tube' || m.look?.front === 'mesh')) return 'não ficou industrial';
        if (Math.abs(width(helpers) - 1800) > 60) return `largura mudou: ${width(helpers)} mm`;
        return d.modules.every((m) => m.id.startsWith('ap-')) ? true : 'trocou o móvel em vez de reestilizar';
      },
    },
  },
  {
    id: 'sty-09',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Rack industrial de 1,6 m com estrutura de aço preto, portas de tela nas pontas, nicho aberto no meio com prateleira, madeira clara e pés de tubo',
    expect: {
      action: ['update'],
      design: (d, helpers) => {
        if (Math.abs(width(helpers) - 1600) > 60) return `largura ${width(helpers)} mm`;
        if (!most(d, (m) => m.look?.frame)) return 'sem estrutura de aço';
        if (!most(d, legs('tube', 'frame'))) return 'sem pé de tubo';
        if (!helpers.parts.some((p) => p.kind === 'insert' && p.category === 'metal')) return 'sem porta de tela';
        if (!helpers.cells.some((c) => !c.node.front && !c.node.split && c.size[1] >= 150)) return 'sem nicho aberto';
        return most(d, (m) => ['oak', 'pine', 'ash', 'freijo'].includes(m.materialId)) ? true : 'madeira escura';
      },
    },
    learned: 'A foto do rack industrial que a pessoa mandou, descrita em palavras.',
  },
  // Escritos antes da primeira rodada: não ajustam o prompt.
  {
    id: 'sty-h1',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Quero um buffet estilo loft',
    expect: {
      action: ['update'],
      design: (d) => (most(d, (m) => m.look?.frame || m.look?.legs === 'tube' || m.look?.front === 'mesh') ? true : 'não ficou industrial (loft)'),
    },
  },
  {
    id: 'sty-h2',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Guarda-roupa nórdico com portas de correr',
    expect: {
      action: ['update'],
      design: (d, helpers) => {
        if (!fronts(helpers, 'sliding')) return 'sem porta de correr';
        return most(d, (m) => ['white', 'ash', 'oak', 'sand'].includes(m.materialId)) ? true : 'cor escura para nórdico';
      },
    },
  },
  {
    id: 'sty-h3',
    group: 'estilos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Dê uma cara provençal, mas mantenha as cores',
    setup: { ops: [{ kind: 'asset.add', asset: 'comoda', id: 'co', placement: 'replace' }] },
    expect: {
      action: ['update'],
      design: (d) => {
        if (!most(d, (m) => m.look?.front === 'shaker')) return 'sem frente de moldura';
        return d.modules.every((m) => m.materialId === 'white') ? true : `cores mudaram: ${d.modules.map((m) => m.materialId).join(',')}`;
      },
    },
  },
];
