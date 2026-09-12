/**
 * Corpus do benchmark do Merce.
 *
 * Cada caso é um pedido real (colhido nas avaliações com usuários ou nos
 * defeitos que elas revelaram) com uma expectativa verificável. O objetivo é
 * medir o que o par prompt + modelo + validação faz hoje e comparar depois de
 * qualquer mudança no prompt, no esquema de operações ou no modelo.
 *
 * Campos:
 * - id, group, prompt: o pedido como uma pessoa escreveria.
 * - setup: operações aplicadas antes do turno (ids explícitos para a resposta
 *   ser determinística) e `selected`, quando o pedido depende da seleção.
 * - expect.action: ação (ou ações) aceitáveis.
 * - expect.applied: true = tem de terminar em revisão nova; false = nada muda.
 * - expect.design: função (design, helpers) => true | string de erro.
 * - expect.content: regex que a resposta tem de conter e que não pode conter.
 * - expect.clarify: mínimos do cartão de esclarecimento (opções reais e vivas).
 * - learned: o que já observamos na prática, para não repetir a descoberta.
 */
export const groups = {
  ambiguidade: 'Medida ou alvo ambíguo: precisa perguntar em vez de adivinhar',
  unidades: 'Conversão de cm/m para mm',
  montagem: 'Adicionar, conectar, empilhar, separar e remover módulos',
  divisao: 'Dividir compartimento, frentes, gavetas e ordem das operações',
  prateleiras: 'Operações nas prateleiras antigas (sh-N)',
  limites: 'Limites físicos e do perfil: precisa recusar com clareza',
  copias: 'Cópias independentes contra fileira compartilhada',
  consulta: 'Pergunta informativa: responder o estado, sem mexer em nada',
  recusa: 'Pedido fora do escopo do produto: não inventar',
  referencia: 'Referência a peça que mudou ou sumiu',
  navegacao: 'Desfazer, refazer e voltar versão',
  tipos: 'Tipos de móvel que o produto declara não suportar',
  sugestoes: 'Próximos passos propostos pela IA para o chip de sugestão',
  foto: 'Foto de referência: estimar a escala e montar o layout, sem recusar',
};

const modulos = (design) => design.modules.length;
/** Vãos (folhas ou nós com frente) por módulo, para achar coluna de nichos. */
const vaosDoModulo = (design, helpers, id) =>
  helpers.cells.filter((c) => c.moduleId === id).length;
const vaoAltoAberto = (helpers, minimo) =>
  helpers.cells.some((c) => !c.node.front && c.size[1] >= minimo);
const conexoes = (design) => design.connections.length;
const compartilhadas = (design) => design.connections.filter((c) => c.shared).length;
const modulo = (design, id) => design.modules.find((m) => m.id === id);
const pecas = (helpers) => helpers.parts.length;
const semDizima = (helpers) =>
  helpers.parts.every(
    (part) =>
      Number.isInteger(part.c) && Number.isInteger(part.l) && Number.isInteger(part.thickness),
  );

export const cases = [
  // ---------------------------------------------------------------- ambiguidade
  {
    id: 'amb-01',
    group: 'ambiguidade',
    prompt: 'deixe com 2 metros',
    expect: {
      action: ['clarify', 'update'],
      design: (design, helpers, info) =>
        info.action === 'clarify'
          ? true
          : helpers.design.width === 2000 || helpers.design.height === 2000
            ? true
            : 'aplicou uma medida diferente de 2000 mm sem perguntar',
      content: { mustMatch: [/largura|altura|profundidade/i] },
    },
    learned:
      'Na primeira avaliação a IA aplicou 2 metros na altura quando o usuário queria largura. Na segunda rodada ela passou a perguntar, mas a pergunta precisa citar as medidas possíveis.',
  },
  {
    id: 'amb-02',
    group: 'ambiguidade',
    prompt: 'aumente 10 cm',
    expect: {
      action: ['clarify'],
      applied: false,
      content: { mustMatch: [/largura|altura|profundidade|qual/i] },
    },
    learned: 'Sem eixo, qualquer escolha é chute. Ivo digitou "aumente 10 cm" e a IA mexeu no módulo selecionado.',
  },
  {
    id: 'amb-03',
    group: 'ambiguidade',
    prompt: 'mova a outra prateleira 5 cm para cima',
    setup: { ops: [{ kind: 'distribute' }] },
    expect: {
      action: ['clarify', 'update'],
      content: { mustMatch: [/prateleira|qual/i] },
    },
    learned: 'Com quatro prateleiras, "a outra" não identifica nada. A rota já tem uma guarda para isso.',
  },
  {
    id: 'amb-04',
    group: 'ambiguidade',
    prompt: 'quero 1,20 de largura e 60 de profundidade',
    expect: {
      action: ['clarify', 'update'],
      design: (design) =>
        design.width === 1200 || design.width === 120
          ? true
          : `largura ficou ${design.width}, nem 1200 mm nem 120 mm`,
      content: { mustMatch: [/cm|mm|metro/i] },
    },
    learned: 'Marceneiro escreve "1,20" querendo metro, leigo escreve "60" querendo centímetro. Precisa confirmar a unidade.',
  },

  // ------------------------------------------------------------------- unidades
  {
    id: 'uni-01',
    group: 'unidades',
    prompt: 'Aumente a largura para 2,40 m.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) => (design.width === 2400 ? true : `largura ${design.width} em vez de 2400`),
    },
    learned: 'O caso básico de conversão. É o pedido mais comum de um marceneiro.',
  },
  {
    id: 'uni-02',
    group: 'unidades',
    prompt: 'Deixe a altura com 2 metros e meio.',
    expect: {
      action: ['update', 'clarify'],
      design: (design, helpers, info) =>
        info.action === 'clarify'
          ? true
          : helpers.design.modules.every((m) => m.height <= 2400)
            ? helpers.design.height <= 2400 || 'altura total acima de 2400 mm sem explicação'
            : 'módulo acima de 2400 mm',
      content: { mustMatch: [/2400|2,40|limite|máximo/i] },
    },
    learned: '2,50 m excede o limite de módulo (2400 mm). O produto tem de explicar, não aceitar nem ignorar.',
  },
  {
    id: 'uni-03',
    group: 'unidades',
    prompt: 'a profundidade tem 45 cm',
    expect: {
      action: 'update',
      applied: true,
      design: (design) =>
        design.modules.every((m) => m.depth === 450) ? true : 'profundidade diferente de 450 mm',
    },
    learned: 'Conversão simples de centímetro.',
  },

  // ------------------------------------------------------------------- montagem
  {
    id: 'mon-01',
    group: 'montagem',
    prompt: 'Adicione um nicho à direita deste módulo.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) =>
        modulos(design) === 2 && conexoes(design) === 1
          ? true
          : `módulos ${modulos(design)}, conexões ${conexoes(design)}`,
    },
    learned: 'O caso mais frequente de todos: crescer a composição para a direita.',
  },
  {
    id: 'mon-02',
    group: 'montagem',
    prompt: 'Coloque um nicho em cima deste módulo.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) => {
        const c = design.connections[0];
        if (!c) return 'nenhuma conexão criada';
        return c.side === 'top' ? true : `conectou com side ${c.side} em vez de top`;
      },
    },
    learned: 'Empilhar usa side "top"; errar isso gera sobreposição e custa uma rodada de retry.',
  },
  {
    id: 'mon-03',
    group: 'montagem',
    prompt: 'Crie dois nichos, um à direita do outro, ligados a este módulo.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) =>
        modulos(design) === 3 && conexoes(design) === 2
          ? true
          : `módulos ${modulos(design)}, conexões ${conexoes(design)}`,
    },
    learned: 'Dois módulos ligados no mesmo pai caem um sobre o outro. A cadeia é a correção que a validação devolve.',
  },
  {
    id: 'mon-04',
    group: 'montagem',
    prompt: 'Separe os módulos e remova o da direita.',
    setup: {
      ops: [
        { kind: 'module.add', id: 'b', preset: 'niche' },
        { kind: 'connect', parent: 'module-1', child: 'b', side: 'right', shared: false, align: 'front', offset: 0 },
      ],
    },
    expect: {
      action: 'update',
      applied: true,
      design: (design) =>
        modulos(design) === 1 && conexoes(design) === 0
          ? true
          : `módulos ${modulos(design)}, conexões ${conexoes(design)}`,
    },
    learned: 'Remover módulo conectado exige separar antes; a ordem das operações no lote importa.',
  },
  {
    id: 'mon-05',
    group: 'montagem',
    prompt: 'Aumente a largura do módulo da direita para 1 metro e deixe a fileira com 2,20 m.',
    setup: {
      ops: [
        { kind: 'module.add', id: 'b', preset: 'niche' },
        { kind: 'connect', parent: 'module-1', child: 'b', side: 'right', shared: false, align: 'front', offset: 0 },
      ],
    },
    expect: {
      action: ['update', 'clarify'],
      design: (design, helpers, info) =>
        info.action === 'clarify'
          ? true
          : modulo(design, 'b')?.width !== undefined && modulo(design, 'module-1')?.width !== undefined
            ? true
            : 'não devolveu um estado navegável',
    },
    learned: 'Valdir tentou redimensionar um módulo encostado no vizinho e a sobreposição recusou o lote inteiro, inclusive o nome. É o caso que mede a capacidade de correção.',
  },

  // -------------------------------------------------------------------- divisao
  {
    id: 'div-01',
    group: 'divisao',
    prompt: 'Divida este compartimento em duas colunas.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      action: 'update',
      applied: true,
      design: (design, helpers) =>
        helpers.cells.some((c) => c.node.split && c.node.split.axis === 'x')
          ? true
          : 'nenhuma divisão horizontal criada',
    },
    learned: 'Divisão em colunas é pedido de projeto de interiores.',
  },
  {
    id: 'div-02',
    group: 'divisao',
    prompt: 'Coloque três gavetas neste compartimento.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      action: 'update',
      applied: true,
      design: (_design, helpers) =>
        helpers.parts.some((p) => /gaveta/i.test(p.name)) ? true : 'nenhuma gaveta criada',
    },
    learned: 'Gaveteiro é o preset mais usado por marceneiro.',
  },
  {
    id: 'div-03',
    group: 'divisao',
    prompt: 'Divida em duas colunas e coloque uma porta em cada lado.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      action: 'update',
      applied: true,
      design: (design, helpers) => {
        const split = helpers.cells.find((c) => c.node.split?.axis === 'x');
        if (!split) return 'sem divisão';
        const portas = helpers.parts.filter((p) => /porta/i.test(p.name));
        return portas.length >= 2 ? true : `só ${portas.length} porta(s)`;
      },
    },
    learned: 'A ordem importa: dividir e depois pôr frente. Inverter gera "escolha um compartimento livre, sem frente".',
  },
  {
    id: 'div-04',
    group: 'divisao',
    prompt: 'Junte os dois compartimentos de volta num só.',
    setup: {
      ops: [
        { kind: 'module.add', id: 'n', preset: 'niche' },
        { kind: 'cell.split', id: 'n:root', axis: 'x', gapMm: 300 },
        { kind: 'front.set', id: 'n:root:low', type: 'single' },
      ],
    },
    expect: {
      action: ['update', 'clarify'],
      design: (design, helpers) => {
        const alvo = helpers.cells.find((c) => c.id === 'n:root');
        if (!alvo?.node.split) return true; // juntou
        return /frente|porta|remova/i.test(String(helpers.content))
          ? true
          : 'não juntou e não explicou que a frente impede';
      },
    },
    learned: 'cell.merge recusa nó com filhos que têm frente. A explicação é o que salva a experiência.',
  },
  {
    id: 'div-05',
    group: 'divisao',
    prompt: 'Divida este compartimento com 50 mm na coluna da esquerda.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      action: ['update', 'clarify'],
      design: (design, helpers) =>
        helpers.cells.every((c) => {
          if (!c.node.split) return true;
          const celulas = helpers.cells.filter((x) => x.node.split?.id === c.node.split?.id || x.id.startsWith(c.id));
          return celulas.every((x) => x.size[0] >= 100 || x.size[1] >= 100);
        })
          ? true
          : 'criou vão livre abaixo de 100 mm',
      content: { mustMatch: [/100|mínimo|livre/i] },
    },
    learned: 'Vão livre mínimo de 100 mm: o produto precisa nomear o limite.',
  },

  // ---------------------------------------------------------------- prateleiras
  {
    id: 'pra-01',
    group: 'prateleiras',
    prompt: 'Suba a prateleira de cima 5 cm.',
    expect: {
      action: 'update',
      applied: true,
      design: (design, helpers) => {
        const antes = helpers.before.shelves.map((s) => s.elevation).sort((a, b) => a - b);
        const agora = design.shelves.map((s) => s.elevation).sort((a, b) => a - b);
        return Math.abs(agora.at(-1) - antes.at(-1) - 50) < 0.01
          ? true
          : `a prateleira de cima foi de ${antes.at(-1)} para ${agora.at(-1)}`;
      },
    },
    learned: 'Referência por posição ("de cima") é como o marceneiro fala.',
  },
  {
    id: 'pra-02',
    group: 'prateleiras',
    prompt: 'Remova as duas prateleiras de baixo.',
    expect: {
      action: 'update',
      applied: true,
      design: (design, helpers) =>
        design.shelves.length <= helpers.before.shelves.length - 2
          ? true
          : `sobraram ${design.shelves.length} prateleiras de ${helpers.before.shelves.length}`,
    },
    learned: 'Remover de baixo para cima evita renumerar ids no meio do lote.',
  },
  {
    id: 'pra-03',
    group: 'prateleiras',
    prompt: 'Deixe o vão de baixo com 45 cm.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) => {
        const menor = design.shelves.map((s) => s.elevation).sort((a, b) => a - b)[0];
        return typeof menor === 'number' ? true : 'sem prateleiras';
      },
      content: { mustMatch: [/450|45 cm|vão/i] },
    },
    learned: 'Vão é medido do piso, não da prateleira anterior; confundir isso muda a peça toda.',
  },

  // -------------------------------------------------------------------- limites
  {
    id: 'lim-01',
    group: 'limites',
    prompt: 'Deixe a largura com 15 metros.',
    expect: {
      action: ['clarify', 'update', 'answer'],
      design: (design, helpers, info) =>
        info.action === 'clarify'
          ? true
          : design.modules.every((m) => m.width <= 1200)
            ? true
            : 'aceitou módulo com mais de 1200 mm',
      content: { mustMatch: [/1200|limite|máximo/i] },
    },
    learned: 'O limite é por módulo, não do conjunto. Precisa explicar isso em vez de só recusar.',
  },
  {
    id: 'lim-02',
    group: 'limites',
    prompt: 'Quero uma estante de 10 mm de altura.',
    expect: { action: ['clarify', 'answer'], applied: false, content: { mustMatch: [/200|mínimo|limite/i] } },
    learned: 'Mínimo de 200 mm por módulo.',
  },
  {
    id: 'lim-03',
    group: 'limites',
    prompt: 'Coloque 7 gavetas neste compartimento.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      action: ['clarify', 'update'],
      design: (design, helpers) => {
        const frentes = helpers.parts.filter((part) => /gaveta/i.test(part.name)).length;
        return frentes <= 6 ? true : `${frentes} frentes de gaveta`;
      },
      content: { mustMatch: [/6|seis|máximo|limite/i] },
    },
    learned: 'De uma a seis gavetas por compartimento. Recusar ou aplicar seis explicando são as duas saídas honestas.',
  },
  {
    id: 'lim-04',
    group: 'limites',
    prompt: 'Crie doze módulos iguais de 1 metro, um ao lado do outro.',
    expect: {
      action: ['update', 'clarify'],
      design: (design) => (modulos(design) <= 12 ? true : `${modulos(design)} módulos, acima do teto`),
      content: { mustMatch: [/12|doze|limite|máximo|painéis/i] },
    },
    learned: 'Doze módulos ou 200 painéis é o teto. Joana descobriu o teto de 200 painéis depois de 104 s de espera.',
  },

  // --------------------------------------------------------------------- copias
  {
    id: 'cop-01',
    group: 'copias',
    prompt: 'Duplique este módulo.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) =>
        modulos(design) === 2 && compartilhadas(design) === 0
          ? true
          : `módulos ${modulos(design)}, compartilhadas ${compartilhadas(design)}`,
    },
    learned: 'Uma cópia tem de ser independente: nada de painel compartilhado de graça.',
  },
  {
    id: 'cop-02',
    group: 'copias',
    prompt: 'Quero quatro cópias iguais deste módulo, cada uma independente.',
    expect: {
      action: 'update',
      applied: true,
      design: (design) =>
        modulos(design) === 5 && compartilhadas(design) === 0
          ? true
          : `módulos ${modulos(design)}, compartilhadas ${compartilhadas(design)}`,
    },
    learned:
      'Joana pediu 4 armários iguais e recebeu uma fileira com 3 laterais compartilhadas: o arquivo ficou 3 peças menor que a compra real.',
  },

  // ------------------------------------------------------------------- consulta
  {
    id: 'con-01',
    group: 'consulta',
    prompt: 'Qual é a largura total do projeto?',
    expect: {
      action: 'answer',
      applied: false,
      content: { mustMatch: [/\d/], mustNotMatch: [/sh-\d|module-\d|:\/\/|a:root/] },
    },
    learned: 'A resposta tem de citar o número do projeto e nunca ids internos (a primeira rodada devolveu "sh-4").',
  },
  {
    id: 'con-02',
    group: 'consulta',
    prompt: 'Quantas peças o projeto tem hoje?',
    expect: {
      action: 'answer',
      applied: false,
      design: (design, helpers, info) => {
        const numero = String(helpers.parts.length);
        return info.content.includes(numero)
          ? true
          : `a resposta não citou ${numero} peças`;
      },
    },
    learned: 'Contagem é a pergunta de quem vai comprar chapa.',
  },
  {
    id: 'con-04',
    group: 'consulta',
    prompt: 'Qual é a largura total do conjunto?',
    setup: {
      ops: [
        { kind: 'module.add', id: 'b', preset: 'niche' },
        { kind: 'module.edit', id: 'b', width: 1200, height: 1800, depth: 350 },
        { kind: 'connect', parent: 'module-1', child: 'b', side: 'right', shared: true, align: 'front', offset: 0 },
      ],
    },
    expect: {
      action: 'answer',
      applied: false,
      design: (design, helpers, info) => {
        // Painel compartilhado: a largura real é 800 + 1200 - 18 = 1982 mm,
        // não a soma das larguras dos módulos (2000).
        const esperado = design.width;
        const texto = String(info.content);
        const emCm = String(Number((esperado / 10).toFixed(1))).replace('.', ',');
        const citouCerto = texto.includes(String(esperado)) || texto.includes(emCm);
        const citouSoma = texto.includes('2000') || texto.includes('200 cm');
        return citouCerto && !citouSoma
          ? true
          : `resposta citou ${texto.slice(0, 80)} (esperado ${esperado} mm)`;
      },
    },
    learned:
      'O vendedor Tiago viu a IA dizer 2.500 mm enquanto o app mostrava 2.464 mm: a prosa somava as larguras dos módulos e ignorava os painéis compartilhados. O número do envelope tem de ser o mesmo na tela, no arquivo e na conversa.',
  },
  {
    id: 'con-03',
    group: 'consulta',
    prompt: 'Descreva os módulos do projeto.',
    expect: {
      action: 'answer',
      applied: false,
      content: { mustMatch: [/módulo|Estante/i], mustNotMatch: [/sh-\d|module-\d|a:root/] },
    },
    learned: 'Descrição é pedida por quem acabou de abrir o projeto e não sabe o que tem ali.',
  },

  // --------------------------------------------------------------------- recusa
  {
    id: 'rec-01',
    group: 'recusa',
    prompt: 'Quanto custa esse armário? Me dá o preço em reais.',
    expect: {
      action: ['answer', 'clarify'],
      applied: false,
      content: { mustNotMatch: [/R\$\s*\d/] },
    },
    learned:
      'Cinco das seis personas pediram preço. O produto não tem tabela de preços: a resposta honesta é dizer o que não faz e o que levar à loja, nunca inventar valor.',
  },
  {
    id: 'rec-02',
    group: 'recusa',
    prompt: 'Me manda o plano de corte das chapas, com quantas chapas eu compro.',
    expect: {
      action: ['answer', 'clarify'],
      applied: false,
      content: { mustMatch: [/não|lista de peças|não faz|não calculo|aproveitamento/i] },
    },
    learned: 'O CSV é lista de peças, não plano de aproveitamento. O produto já avisa isso na interface.',
  },
  {
    id: 'rec-03',
    group: 'recusa',
    prompt: 'Liste as ferragens e as posições de furação das dobradiças.',
    expect: {
      action: ['answer', 'clarify'],
      applied: false,
      content: { mustMatch: [/não|fora|não faz|não inclui|furação/i] },
    },
    learned: 'Ferragem e furação estão fora do escopo declarado; a IA não pode preencher com números plausíveis.',
  },

  // ----------------------------------------------------------------- referencia
  {
    id: 'ref-01',
    group: 'referencia',
    prompt: 'Suba a prateleira 4 mais 5 cm.',
    setup: { ops: [{ kind: 'remove', ids: ['sh-4'] }] },
    expect: {
      action: ['clarify', 'update'],
      design: (design, helpers, info) =>
        info.action === 'clarify'
          ? true
          : design.shelves.length <= helpers.before.shelves.length
            ? true
            : 'não mexeu em prateleira inexistente',
      content: { mustMatch: [/não existe|qual|escolha|já não/i] },
    },
    learned: 'Peça removida nunca é substituída em silêncio: o Ivo viu a IA mover a peça errada.',
  },
  {
    id: 'ref-02',
    group: 'referencia',
    prompt: 'Mova esta prateleira 5 cm para cima.',
    setup: { selected: ['sh-2'] },
    expect: {
      action: 'update',
      applied: true,
      design: (design, helpers) => {
        const alvo = design.shelves.find((s) => s.id === 'sh-2');
        const antes = helpers.before.shelves.find((s) => s.id === 'sh-2');
        return alvo && antes && Math.abs(alvo.elevation - antes.elevation - 50) < 0.01
          ? true
          : 'não moveu a prateleira selecionada';
      },
    },
    learned: 'A seleção explícita tem precedência sobre qualquer referência anterior.',
  },

  // ----------------------------------------------------------------- navegacao
  {
    id: 'nav-01',
    group: 'navegacao',
    prompt: 'Desfaça a última alteração.',
    setup: { ops: [{ kind: 'resize', width: 1000 }] },
    expect: {
      action: 'undo',
      applied: true,
      design: (design) => (design.width === 800 ? true : `voltou para largura ${design.width}`),
    },
    learned:
      'Desfazer sem ops. O caso precisa de duas revisões: no primeiro projeto a resposta certa é dizer que não há nada para desfazer, e o modelo fez exatamente isso.',
  },
  {
    id: 'nav-02',
    group: 'navegacao',
    prompt: 'Volte uma versão e deixe a largura com 900 mm.',
    setup: { ops: [{ kind: 'resize', width: 1000 }] },
    expect: {
      action: ['undo', 'clarify'],
      design: (design, helpers, info) =>
        info.action === 'clarify'
          ? true
          : helpers.design.modules.every((m) => m.width <= 1200)
            ? true
            : 'aplicou largura impossível',
    },
    learned:
      'Foi o P1 da primeira rodada: editar a partir de uma versão antiga descartava 9 versões em silêncio. Hoje a interface confirma o descarte, e o modelo deve preferir desfazer a truncar.',
  },

  // ---------------------------------------------------------------------- tipos
  {
    id: 'tip-01',
    group: 'tipos',
    prompt: 'Quero uma porta de correr neste armário.',
    expect: {
      action: ['answer', 'clarify', 'update'],
      content: { mustMatch: [/não|correr|disponível|suporta/i] },
    },
    learned: 'Porta deslizante está fora do perfil: o produto avisa, não finge.',
  },
  {
    id: 'tip-02',
    group: 'tipos',
    prompt: 'Faça um tampo de mesa de 1,50 m para o escritório.',
    expect: {
      action: ['answer', 'clarify'],
      applied: false,
      content: { mustMatch: [/não|mesa|tampo|suporta/i] },
    },
    learned: 'Tampos avulsos e mesas estão fora do escopo declarado.',
  },
  {
    id: 'mon-06',
    group: 'montagem',
    prompt: 'Adicione um nicho de 800 × 600 × 450 mm encostado à direita da estante.',
    expect: {
      action: ['update'],
      design: (design) => {
        const novo = design.modules.find((m) => /nicho/i.test(m.name)) ?? design.modules.at(-1);
        if (!novo) return 'nenhum módulo novo';
        return novo.width === 800 && novo.height === 600 && novo.depth === 450
          ? true
          : `medidas aplicadas ${novo.width} × ${novo.height} × ${novo.depth} (pedido 800 × 600 × 450)`;
      },
    },
    learned:
      'Medida ditada em três eixos: o modelo já aplicou só a largura duas vezes, com a prosa prometendo 800 × 600 × 450. O cartão da interface denuncia, mas o certo é aplicar as três.',
  },
  // ------------------------------------------------------------------ sugestoes
  {
    id: 'sug-01',
    group: 'sugestoes',
    prompt: 'Adicione um nicho à direita da estante.',
    expect: {
      action: ['update', 'answer', 'clarify'],
      suggestions: { min: 2, max: 4, maxChars: 60, mustMatch: [/nicho|porta|gaveta|vão|prateleira|altura/i] },
    },
    learned:
      'O chip deixou de ser lista fixa: depois de mexer no nicho, o próximo passo tem de falar do nicho, não de conselho genérico.',
  },
  {
    id: 'sug-02',
    group: 'sugestoes',
    prompt: 'Qual é a altura total do projeto?',
    expect: {
      action: ['answer', 'update', 'clarify'],
      suggestions: { min: 2, max: 4, maxChars: 60 },
    },
    learned: 'Pergunta informativa também abre caminho para o próximo pedido sem sugerir algo fora do escopo.',
  },
  {
    id: 'sug-03',
    group: 'sugestoes',
    prompt: 'Quanto custa para fazer este armário?',
    expect: {
      action: ['answer', 'clarify', 'update'],
      // Preço está fora do escopo declarado: sugerir orçamento seria inventar
      // recurso que o produto não tem.
      suggestions: { min: 1, mustNotMatch: [/orçamento|preço|R\$|custa/i] },
    },
    learned: 'Cinco de seis personas pediram preço; a sugestão não pode abrir uma porta que o produto não atende.',
  },

  // ---------------------------------------------------------------------- foto
  {
    id: 'foto-01',
    group: 'foto',
    image: 'bench/images/armario-canto.webp',
    prompt: 'Copia o layout dessa foto: é um armário de canto com nicho no meio.',
    expect: {
      action: ['update'],
      applied: true,
      design: (design, helpers) => {
        // O que a foto exige: uma fileira de módulos (não um móvel solto), com
        // o nicho alto e aberto, coluna de vãos pequenos e gavetas.
        if (design.modules.length < 4) return `layout raso: ${design.modules.length} módulo(s)`;
        if (design.width < 2400) return `parede curta demais para a fileira da foto: ${design.width} mm`;
        if (design.modules.some((m) => m.width > 1200)) return 'módulo acima do limite de 1200 mm';
        if (!vaoAltoAberto(helpers, 1200)) return 'sem vão alto e aberto (o nicho da foto)';
        if (!helpers.cells.some((c) => c.node.front?.type === 'drawers'))
          return 'sem gavetas, e a foto tem três';
        if (!design.modules.some((m) => vaosDoModulo(design, helpers, m.id) >= 4))
          return 'sem coluna de vãos pequenos, e a foto tem duas';
        if (design.connections.filter((c) => c.shared).length < 2)
          return 'módulos soltos: a fileira precisa de laterais compartilhadas';
        return true;
      },
      content: {
        // O pedido do dono: estimar e dizer o erro, em vez de recusar.
        mustMatch: [/(estimat|aproximad|régua|margem|erro|±|\+\/-)/i],
        mustNotMatch: [/(não consigo medir|não posso medir|sem uma referência real|não é possível medir)/i],
      },
    },
    learned:
      'Antes o prompt mandava pedir as medidas que faltavam e o modelo recusava copiar layouts de foto. Medido com perguntas de controle, ele vê a imagem e acerta; o que faltava era o procedimento de escala e a ordem da montagem (um módulo por vez, medidas antes do próximo add, frentes por último).',
  },
  {
    id: 'foto-02',
    group: 'foto',
    image: 'bench/images/armario-canto.webp',
    prompt: 'Copia o layout da foto, mas a minha parede tem 3600 mm.',
    expect: {
      action: ['update'],
      applied: true,
      design: (design) => {
        if (design.modules.length < 4) return `layout raso: ${design.modules.length} módulo(s)`;
        if (design.width < 3200 || design.width > 4000)
          return `não usou a parede informada: ${design.width} mm para 3600 mm`;
        return true;
      },
      content: { mustNotMatch: [/(não consigo medir|não posso medir|não é possível medir)/i] },
    },
    learned:
      'Duas medidas na mesma frase (layout da foto + parede real): a parede manda na escala e a foto nas proporções.',
  },
];


/** Casos que só rodam com modelo (os demais aceitam fixture gravada). */
export const requiresModel = new Set(['con-01', 'con-02', 'con-03', 'rec-01', 'rec-02', 'rec-03']);

export { modulos, conexoes, compartilhadas, modulo, pecas, semDizima };
