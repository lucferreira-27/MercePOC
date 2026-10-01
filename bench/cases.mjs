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
 * - askAct: o que o assistente deve fazer com o pedido. 'agir' (fazer),
 *   'perguntar' (não mexer e perguntar), 'responder' (só responder, sem
 *   perguntar) ou 'livre' (perguntar ou fazer são ambos razoáveis). A regra:
 *   perguntar só quando um chute errado custa caro e não há um padrão
 *   razoável nem um limite do produto para usar. Pedido acima do limite é
 *   'agir': faz no limite e diz na resposta.
 * - setup: operações aplicadas antes do turno (ids explícitos para a resposta
 *   ser determinística) e `selected`, quando o pedido depende da seleção.
 * - expect.action: ação (ou ações) aceitáveis, coerentes com askAct.
 * - expect.applied: true = tem de terminar em revisão nova; false = nada muda.
 * - expect.design: função (design, helpers) => true | string de erro.
 * - expect.content: regex que a resposta tem de conter e que não pode conter.
 * - expect.clarify: mínimos do cartão de esclarecimento (opções reais e vivas).
 * - learned: o que já observamos na prática, para não repetir a descoberta.
 * - agentOnly: só o assistente em laço (--agent) faz; o caminho antigo pula.
 * - expect.agent: função (got) => true | string, com o que o laço devolve:
 *   efeitos, frentes, ambiente, projeto (nome, versão), opções e etapas.
 */
import { createHash } from 'node:crypto';
import { compositionCases, compositionGroup } from './composition-cases.mjs';
import { photoCases } from './photo-real.mjs';
import { styleCases, styleGroup } from './style-cases.mjs';

export const groups = {
  ambiguidade: 'Medida ou alvo ambíguo: pergunta quando não há padrão razoável, faz quando há',
  unidades: 'Conversão de cm/m para mm',
  montagem: 'Adicionar, conectar, empilhar, separar e remover módulos',
  divisao: 'Dividir compartimento, frentes, gavetas e ordem das operações',
  prateleiras: 'Operações nas prateleiras antigas (sh-N)',
  limites: 'Limites físicos e do perfil: faz no limite e diz qual é',
  copias: 'Cópias independentes contra fileira compartilhada',
  consulta: 'Pergunta informativa: responder o estado, sem mexer em nada',
  recusa: 'Pedido fora do escopo do produto: não inventar',
  referencia: 'Referência a peça que mudou ou sumiu',
  navegacao: 'Desfazer, refazer e voltar versão',
  tipos: 'Tipos de peça: o que o produto faz (porta de correr, mesa) e o que fica de fora (curva)',
  sugestoes: 'Próximos passos propostos pela IA para o chip de sugestão',
  foto: 'Foto de referência: estimar a escala e montar o layout, sem recusar',
  'foto-real': 'Fotos reais de móveis e ambientes, comparadas com o gabarito montado à mão',
  biblioteca: 'Móvel conhecido pedido pelo nome: partir do ativo certo da biblioteca',
  estudio: 'Assistente em laço: câmera, frentes, arquivos, ambiente, preços, versões e nome do projeto',
  autoconferencia: 'Assistente em laço: confere o próprio trabalho (encaixe, pedido cumprido) antes de responder',
  'trabalho-completo': 'Assistente em laço: pedido grande do começo ao fim (parede, móveis, vista, arquivo)',
  opcoes: 'Assistente em laço: opções lado a lado sem mudar o projeto',
  ...compositionGroup,
  ...styleGroup,
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
    askAct: 'perguntar',
    prompt: 'deixe com 2 metros',
    expect: {
      // Pergunta pelo cartão ou em texto; mexer no eixo errado é o erro.
      action: ['clarify', 'answer'],
      applied: false,
      content: { mustMatch: [/largura|altura|profundidade/i] },
    },
    learned:
      'Na primeira avaliação a IA aplicou 2 metros na altura quando o usuário queria largura. Na segunda rodada ela passou a perguntar, mas a pergunta precisa citar as medidas possíveis.',
  },
  {
    id: 'amb-02',
    group: 'ambiguidade',
    askAct: 'perguntar',
    prompt: 'aumente 10 cm',
    expect: {
      action: ['clarify', 'answer'],
      applied: false,
      content: { mustMatch: [/largura|altura|profundidade|qual/i] },
    },
    learned: 'Sem eixo, qualquer escolha é chute. Ivo digitou "aumente 10 cm" e a IA mexeu no módulo selecionado.',
  },
  {
    id: 'amb-03',
    group: 'ambiguidade',
    askAct: 'perguntar',
    prompt: 'mova a outra prateleira 5 cm para cima',
    setup: { ops: [{ kind: 'distribute' }] },
    expect: {
      action: ['clarify', 'answer'],
      applied: false,
      content: { mustMatch: [/prateleira|qual/i] },
    },
    learned: 'Com quatro prateleiras, "a outra" não identifica nada. A rota já tem uma guarda para isso.',
  },
  {
    id: 'amb-04',
    group: 'ambiguidade',
    askAct: 'agir',
    prompt: 'quero 1,20 de largura e 60 de profundidade',
    expect: {
      action: ['update'],
      design: (design) =>
        design.width === 1200 || design.width === 120
          ? true
          : `largura ficou ${design.width}, nem 1200 mm nem 120 mm`,
      content: { mustMatch: [/cm|mm|metro/i] },
    },
    learned:
      'Marceneiro escreve "1,20" querendo metro, leigo escreve "60" querendo centímetro. O padrão razoável resolve (1,20 m e 60 cm): faz e diz as unidades que assumiu, em vez de perguntar.',
  },

  // ------------------------------------------------------------------- unidades
  {
    id: 'uni-01',
    group: 'unidades',
    askAct: 'agir',
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
    askAct: 'agir',
    prompt: 'Deixe a altura com 2 metros e meio.',
    expect: {
      action: ['update'],
      design: (design, helpers) =>
        helpers.design.modules.every((m) => m.height <= 2400)
          ? helpers.design.height <= 2400 || 'altura total acima de 2400 mm sem explicação'
          : 'módulo acima de 2400 mm',
      content: { mustMatch: [/2400|2,40|limite|máximo/i] },
    },
    learned: '2,50 m excede o limite de módulo (2400 mm). Faz no limite e explica, sem aceitar nem ignorar.',
  },
  {
    id: 'uni-03',
    group: 'unidades',
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
    prompt: 'Aumente a largura do módulo da direita para 1 metro e deixe a fileira com 2,20 m.',
    setup: {
      ops: [
        { kind: 'module.add', id: 'b', preset: 'niche' },
        { kind: 'connect', parent: 'module-1', child: 'b', side: 'right', shared: false, align: 'front', offset: 0 },
      ],
    },
    expect: {
      action: ['update'],
      design: (design) =>
        modulo(design, 'b')?.width !== undefined && modulo(design, 'module-1')?.width !== undefined
          ? true
          : 'não devolveu um estado navegável',
    },
    learned: 'Valdir tentou redimensionar um módulo encostado no vizinho e a sobreposição recusou o lote inteiro, inclusive o nome. É o caso que mede a capacidade de correção.',
  },

  // -------------------------------------------------------------------- divisao
  {
    id: 'div-01',
    group: 'divisao',
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
    prompt: 'Junte os dois compartimentos de volta num só.',
    setup: {
      ops: [
        { kind: 'module.add', id: 'n', preset: 'niche' },
        { kind: 'cell.split', id: 'n:root', axis: 'x', gapMm: 300 },
        { kind: 'front.set', id: 'n:root:low', type: 'single' },
      ],
    },
    expect: {
      action: ['update'],
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
    askAct: 'agir',
    prompt: 'Divida este compartimento com 50 mm na coluna da esquerda.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      // Faz no limite (100 mm livres) e diz o limite.
      action: ['update'],
      applied: true,
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
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'agir',
    prompt: 'Deixe a largura com 15 metros.',
    expect: {
      action: ['update'],
      design: (design) => (design.modules.every((m) => m.width <= 1200) ? true : 'aceitou módulo com mais de 1200 mm'),
      content: { mustMatch: [/1200|limite|máximo/i] },
    },
    learned: 'O limite é por módulo, não do conjunto. Faz no limite (ou com mais módulos) e explica, em vez de só recusar.',
  },
  {
    id: 'lim-02',
    group: 'limites',
    askAct: 'agir',
    prompt: 'Quero uma estante de 10 mm de altura.',
    expect: {
      action: ['update'],
      applied: true,
      // No limite: 200 mm (tira as prateleiras que não cabem) e diz o mínimo.
      design: (design) =>
        design.modules.some((m) => m.height === 200) ? true : `alturas ${design.modules.map((m) => m.height).join(', ')} (limite 200 mm)`,
      content: { mustMatch: [/200|mínimo|limite/i] },
    },
    learned: 'Mínimo de 200 mm por módulo. Antes o caso aceitava recusar; a regra agora é fazer no limite e dizer o mínimo.',
  },
  {
    id: 'lim-03',
    group: 'limites',
    askAct: 'agir',
    prompt: 'Coloque 7 gavetas neste compartimento.',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }], selected: ['n:root'] },
    expect: {
      action: ['update'],
      design: (design, helpers) => {
        // Cada gaveta tem frente, laterais, caixa e fundo: conta só as frentes.
        const frentes = helpers.parts.filter((part) => /frente gaveta/i.test(part.name)).length;
        return frentes >= 1 && frentes <= 6 ? true : `${frentes} frentes de gaveta`;
      },
      content: { mustMatch: [/6|seis|máximo|limite/i] },
    },
    learned: 'De uma a seis gavetas por compartimento. Aplica seis e explica o limite.',
  },
  {
    id: 'lim-04',
    group: 'limites',
    askAct: 'agir',
    prompt: 'Crie doze módulos iguais de 1 metro, um ao lado do outro.',
    expect: {
      action: ['update'],
      design: (design) => (modulos(design) <= 12 ? true : `${modulos(design)} módulos, acima do teto`),
      content: { mustMatch: [/12|doze|limite|máximo|painéis/i] },
    },
    learned: 'Doze módulos ou 200 painéis é o teto. Joana descobriu o teto de 200 painéis depois de 104 s de espera.',
  },

  // --------------------------------------------------------------------- copias
  {
    id: 'cop-01',
    group: 'copias',
    askAct: 'agir',
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
    askAct: 'agir',
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
    askAct: 'responder',
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
    askAct: 'responder',
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
    askAct: 'responder',
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
    askAct: 'responder',
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
    askAct: 'responder',
    prompt: 'Quanto custa esse armário? Me dá o preço em reais.',
    expect: {
      action: ['answer'],
      applied: false,
      // O valor vem do orçamento do app (tabela de preços da aba Orçamento),
      // e a resposta diz que é estimativa.
      content: { mustMatch: [/R\$\s*\d/, /estimad|orçamento|aproximad|tabela|custo|margem/i] },
    },
    learned:
      'Cinco das seis personas pediram preço. Antes o produto não tinha tabela e a resposta honesta era recusar; agora a aba Orçamento calcula com a tabela de preços, então a resposta dá o total estimado e diz de onde vem, sem inventar.',
  },
  {
    id: 'rec-02',
    group: 'recusa',
    askAct: 'responder',
    prompt: 'Me manda o plano de corte das chapas, com quantas chapas eu compro.',
    expect: {
      action: ['answer'],
      applied: false,
      // A aba Corte calcula o plano: a resposta dá o número de chapas dele.
      content: { mustMatch: [/\d+\s*chapas?|chapas?[^.]*\d/i] },
    },
    learned: 'Antes o CSV era só lista de peças e a resposta honesta era recusar; agora o plano de corte (aba Corte) conta as chapas, e a resposta usa esse número.',
  },
  {
    id: 'rec-03',
    group: 'recusa',
    askAct: 'responder',
    prompt: 'Liste as ferragens e as posições de furação das dobradiças.',
    expect: {
      action: ['answer'],
      applied: false,
      content: { mustMatch: [/não|fora|não faz|não inclui|furação/i] },
    },
    learned: 'Ferragem e furação estão fora do escopo declarado; a IA não pode preencher com números plausíveis.',
  },

  // ----------------------------------------------------------------- referencia
  {
    id: 'ref-01',
    group: 'referencia',
    askAct: 'perguntar',
    prompt: 'Suba a prateleira 4 mais 5 cm.',
    setup: { ops: [{ kind: 'remove', ids: ['sh-4'] }] },
    expect: {
      // A prateleira 4 sumiu: mover outra no lugar é o erro que o Ivo viu.
      action: ['clarify', 'answer'],
      applied: false,
      content: { mustMatch: [/não existe|qual|escolha|já não/i] },
    },
    learned: 'Peça removida nunca é substituída em silêncio: o Ivo viu a IA mover a peça errada.',
  },
  {
    id: 'ref-02',
    group: 'referencia',
    askAct: 'agir',
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
  {
    id: 'ref-03',
    group: 'referencia',
    askAct: 'livre',
    agentOnly: true,
    // O pedido gravado, em inglês e com os erros de digitação da pessoa.
    prompt: 'Maek those two match in weigth, so increase the one that i smaller',
    setup: {
      scene: 'bench/scenes/painel-faixa.json',
      history: [
        { role: 'user', content: 'Monta essa parede da minha sala: o painel da TV com o rack e a porta do lado.', image: 'bench/images/real-sala-painel.jpg' },
        {
          role: 'assistant',
          content:
            'Montei na parede da sala a porta à esquerda, o painel amadeirado com TV, a prateleira superior e o rack branco suspenso com duas portas, estimando as proporções pela porta padrão de 80 × 210 cm. As medidas são aproximadas (erro esperado de ±10–20%); uma medida real da parede e da porta ajudaria a fechar o dimensionamento. A foto inclui objetos decorativos e um acabamento de parede que não fazem parte do móvel.',
        },
      ],
      selected: ['faixa-topo:panel', 'painel-tv:panel'],
    },
    expect: {
      action: ['update', 'clarify'],
      design: (design, helpers) => {
        const width = (d, id) => d.modules.find((m) => m.id === id)?.width;
        if (width(design, 'painel-tv') !== 2000) return 'mexeu no painel da TV, que já era o maior';
        if (Math.abs(width(design, 'faixa-topo') - 2000) > 1) return `faixa com ${width(design, 'faixa-topo')} mm, não 2000`;
        const other = helpers.before.modules.find((m) => !['faixa-topo', 'painel-tv'].includes(m.id) && JSON.stringify(m) !== JSON.stringify(design.modules.find((v) => v.id === m.id)));
        return other ? `mexeu em ${other.name}, fora da seleção` : true;
      },
      content: { mustMatch: [/faixa|painel/i], mustNotMatch: [/rack/i] },
    },
    learned:
      'Pedido real de 26/09 (Luna) com a faixa (1900 mm) e o painel da TV (2000 mm) selecionados: a IA escolheu os dois módulos do rack, iguais entre si, e respondeu que não precisava mudar nada. A seleção ia só como ids no fim do estado; agora vai com nome e medida logo antes do pedido.',
  },
  {
    id: 'ref-04',
    group: 'referencia',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Legal agora aumente o painel para pegar o a rack tambem.',
    setup: {
      scene: 'bench/scenes/painel-ate-rack.json',
      history: [
        { role: 'user', content: 'aumenta a distancia entre a rack e a prateleria, na minha tem um espaco legal entre eles' },
        {
          role: 'assistant',
          content:
            'Aumentei para 20 cm o vão entre o rack e a prateleira, descendo o conjunto do rack; conferi o resultado no desenho. O móvel continua cabendo na parede.',
        },
      ],
      selected: [
        'rack-tv-2:right', 'rack-tv-2:base', 'rack-tv-2:top', 'rack-tv-2:back', 'front-716ab6a9-2bf:door-0', 'painel-tv:panel',
        'rack-tv:left', 'rack-tv:right', 'rack-tv:base', 'rack-tv:top', 'rack-tv:back', 'front-4e6a9d4c-c88:door-0',
      ],
    },
    expect: {
      action: 'update',
      applied: true,
      design: (design, helpers) => {
        const at = (d, id) => d.modules.find((m) => m.id === id);
        const panel = at(design, 'painel-tv'),
          was = at(helpers.before, 'painel-tv');
        if (!panel) return 'o painel da TV sumiu';
        // Pegar o rack: o painel desce até perto do fundo do rack (175 mm do piso).
        if (panel.position[1] > 175 + 60) return `painel começa a ${panel.position[1]} mm, não chega ao rack (175 mm)`;
        if (panel.position[1] + panel.height < 1800 - 1) return 'o painel perdeu o topo (1800 mm)';
        // Continua na parede, com a mesma espessura: não foi empurrado para trás nem engrossado.
        if (Math.abs(panel.position[2] - was.position[2]) > 1) return `painel saiu da parede (z ${was.position[2]} → ${panel.position[2]})`;
        if (panel.depth !== was.depth) return `espessura do painel ${was.depth} → ${panel.depth} mm`;
        for (const id of ['rack-tv', 'rack-tv-2']) {
          const rack = at(design, id),
            before = at(helpers.before, id);
          if (!rack) return `${id} sumiu`;
          if (rack.width !== before.width || rack.height !== before.height || rack.depth !== before.depth) return `mudou as medidas de ${rack.name}`;
          // O rack fica preso na frente do painel: o fundo dele encosta na frente do painel.
          const back = rack.position[2] - rack.depth / 2,
            face = panel.position[2] + panel.depth / 2;
          if (Math.abs(back - face) > 1) return `${rack.name} com o fundo em ${back}, a frente do painel está em ${face}`;
        }
        return true;
      },
      content: { mustMatch: [/painel/i] },
    },
    learned:
      'Pedido real de 26/09 (Luna): aumentar o painel até atrás do rack dava "Módulos sobrepostos" (painel e rack ocupando a mesma espessura na parede). A IA contornou, releu o projeto e desfez tudo com history_undo, que descartava o pedido inteiro. Agora o app prende o rack na frente do painel e o desfazer volta um passo.',
  },

  // ----------------------------------------------------------------- navegacao
  {
    id: 'nav-01',
    group: 'navegacao',
    askAct: 'agir',
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
    askAct: 'agir',
    prompt: 'Volte uma versão e deixe a largura com 900 mm.',
    setup: { ops: [{ kind: 'resize', width: 1000 }] },
    expect: {
      // O assistente em laço desfaz e muda a largura no mesmo pedido (update).
      action: ['undo', 'update'],
      design: (design, helpers, info) =>
        !helpers.design.modules.every((m) => m.width <= 1200)
          ? 'aplicou largura impossível'
          : info.action === 'update' && helpers.design.width !== 900
            ? `largura ${helpers.design.width} mm (pedido 900)`
            : true,
    },
    learned:
      'Foi o P1 da primeira rodada: editar a partir de uma versão antiga descartava 9 versões em silêncio. Hoje a interface confirma o descarte, e o modelo deve preferir desfazer a truncar.',
  },

  // ---------------------------------------------------------------------- tipos
  {
    id: 'tip-01',
    group: 'tipos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Quero uma porta de correr neste armário.',
    expect: {
      action: ['update'],
      design: (design, helpers) => (helpers.cells.some((c) => c.node.front?.type === 'sliding') ? true : 'sem porta de correr'),
    },
    learned: 'Até a fase 2 dos estilos a porta de correr ficava de fora e o produto avisava; agora existe (front.set sliding).',
  },
  {
    id: 'tip-02',
    group: 'tipos',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Faça um tampo de mesa de 1,50 m para o escritório.',
    expect: {
      action: ['update'],
      design: (design) => {
        const t = design.modules.find((m) => m.kind === 'table');
        if (!t) return 'não montou mesa';
        return Math.abs(t.width - 1500) <= 20 ? true : `mesa de ${t.width} mm (pedido 1500)`;
      },
    },
    learned: 'Até a fase 4 dos estilos mesa e tampo avulso ficavam de fora; agora a escrivaninha da biblioteca ou o preset table resolvem.',
  },
  {
    id: 'tip-03',
    group: 'tipos',
    askAct: 'responder',
    prompt: 'Faça uma estante curva, em arco, para o canto da sala.',
    expect: {
      action: ['answer', 'update'],
      content: { mustMatch: [/curv|arco|não/i] },
    },
    learned: 'Curva continua fora do perfil: o produto diz, sem fingir que montou um arco.',
  },
  {
    id: 'mon-06',
    group: 'montagem',
    askAct: 'agir',
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
    askAct: 'agir',
    prompt: 'Adicione um nicho à direita da estante.',
    expect: {
      action: ['update'],
      suggestions: { min: 2, max: 4, maxChars: 60, mustMatch: [/nicho|porta|gaveta|vão|prateleira|altura/i] },
    },
    learned:
      'O chip deixou de ser lista fixa: depois de mexer no nicho, o próximo passo tem de falar do nicho, não de conselho genérico.',
  },
  {
    id: 'sug-02',
    group: 'sugestoes',
    askAct: 'responder',
    prompt: 'Qual é a altura total do projeto?',
    expect: {
      action: ['answer'],
      suggestions: { min: 2, max: 4, maxChars: 60 },
    },
    learned: 'Pergunta informativa também abre caminho para o próximo pedido sem sugerir algo fora do escopo.',
  },
  {
    id: 'sug-03',
    group: 'sugestoes',
    askAct: 'responder',
    prompt: 'Quanto custa para fazer este armário?',
    expect: {
      action: ['answer'],
      // O orçamento existe (aba Orçamento, PDF): sugerir abrir ou detalhar é
      // válido. Continua fora ferragem e furação, que o produto não faz.
      suggestions: { min: 1, mustNotMatch: [/furação|ferragens? detalhad|mão de obra/i] },
    },
    learned: 'Cinco de seis personas pediram preço. Antes a sugestão não podia citar preço porque o produto não tinha tabela; agora tem, e a sugestão não pode abrir porta para o que continua fora (furação, mão de obra).',
  },

  // ---------------------------------------------------------------------- foto
  {
    id: 'foto-01',
    group: 'foto',
    askAct: 'agir',
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
    askAct: 'agir',
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
  {
    id: 'foto-03',
    group: 'foto',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Esses aqui estao errados. nao estao na imagem ref',
    setup: {
      // O turno da foto como ficou gravado: o guarda-roupa da biblioteca, com
      // gaveteiro no meio, e a conferência dizendo o que estava errado.
      ops: [{ kind: 'asset.add', asset: 'guarda-roupa', id: 'roupeiro-ref', width: 2200, height: 2200, depth: 600, materialId: 'freijo', frontMaterialId: 'freijo', placement: 'replace' }],
      history: [
        { role: 'user', content: 'Use esta imagem como referência para a estante.', image: 'bench/images/guarda-roupa-quatro-portas.webp' },
        {
          role: 'assistant',
          content: 'Módulo "Cabideiro" adicionado. Módulo "Gaveteiro" adicionado. Módulo "Coluna de portas" adicionado. Módulo "Estante" removido.\n\nUsei a porta ao lado (~800 × 2100 mm) como régua; a estimativa tem erro esperado de ±10–20%.',
          review: { fidelity: 'parcial', verdict: 'O desenho se aproxima da proporção geral e tem a faixa superior sobre portas altas, mas mostra cinco colunas e um bloco de gavetas no centro; a referência tem quatro colunas de portas contínuas embaixo.', corrections: 0 },
        },
      ],
      // As frentes de gaveta selecionadas (os ids das frentes mudam a cada montagem).
      selected: (design) => {
        const fronts = [];
        const walk = (node) => {
          if (node.front?.type === 'drawers') node.front.heights.forEach((_, i) => fronts.push(`${node.front.id}:drawer-${i}:front`));
          for (const child of node.split?.children ?? []) walk(child);
        };
        for (const m of design.modules) if (m.root) walk(m.root);
        return fronts;
      },
    },
    expect: {
      action: ['update'],
      applied: true,
      design: (design, helpers) => {
        if (helpers.cells.some((c) => c.node.front?.type === 'drawers')) return 'ainda tem gavetas, e a foto não tem';
        const aberto = helpers.cells.find((c) => !c.node.split && !c.node.front && c.size[1] >= 200);
        if (aberto) return `deixou um vão aberto de ${Math.round(aberto.size[1])} mm: a foto é toda de portas`;
        return true;
      },
      content: { mustNotMatch: [/(imagem|foto|referência)[^.]{0,40}(não está disponível|indisponível|não (consigo|posso) ver)/i] },
    },
    learned:
      'Pedido real depois de um turno com foto: a foto não voltava no pedido seguinte, a IA tirou as gavetas selecionadas e deixou o vão aberto, dizendo que a imagem não estava disponível. A conferência já tinha dito "quatro colunas de portas contínuas".',
  },
];


/** Envelope do conjunto em mm, pelas peças geradas. */
const envelope = (helpers) => {
  const xs = helpers.parts.flatMap((p) => [p.position[0] - p.size[0] / 2, p.position[0] + p.size[0] / 2]);
  const ys = helpers.parts.map((p) => p.position[1] + p.size[1] / 2);
  return { width: Math.round(Math.max(...xs) - Math.min(...xs)), height: Math.round(Math.max(...ys)) };
};
const perto = (valor, alvo, folga = 20) => Math.abs(valor - alvo) <= folga;
cases.push(
  {
    id: 'bib-01',
    group: 'biblioteca',
    askAct: 'agir',
    prompt: 'Faz um rack de TV pra mim',
    expect: {
      action: ['update'],
      design: (design, helpers) => {
        const e = envelope(helpers);
        if (e.width < 1200) return `rack estreito: ${e.width} mm`;
        if (e.height > 800) return `alto demais para rack: ${e.height} mm`;
        return modulos(design) >= 2 ? true : 'rack de um módulo só';
      },
    },
    learned: 'Sem base, a IA montava uma estante e chamava de rack; o ativo rack-tv resolve.',
  },
  {
    id: 'bib-02',
    group: 'biblioteca',
    askAct: 'agir',
    prompt: 'Quero um painel de TV com rack suspenso',
    expect: {
      action: ['update'],
      design: (design) => {
        if (!design.modules.some((m) => m.kind === 'panel')) return 'sem painel de parede';
        return design.modules.some((m) => m.kind !== 'panel' && m.position[1] > 200)
          ? true
          : 'rack não ficou suspenso';
      },
    },
  },
  {
    id: 'bib-03',
    group: 'biblioteca',
    askAct: 'agir',
    prompt: 'Monte uma cômoda de 1 metro de largura com gavetas',
    expect: {
      action: ['update'],
      design: (design, helpers) => {
        const e = envelope(helpers);
        if (!perto(e.width, 1000)) return `largura ${e.width} mm (pedido 1000)`;
        const gavetas = helpers.cells.filter((c) => c.node.front?.type === 'drawers');
        return gavetas.length ? true : 'sem gavetas';
      },
    },
  },
  {
    id: 'bib-04',
    group: 'biblioteca',
    askAct: 'agir',
    prompt: 'Quero uma cozinha de 3 metros com armário aéreo',
    expect: {
      action: ['update'],
      design: (design, helpers) => {
        const e = envelope(helpers);
        if (!perto(e.width, 3000)) return `largura ${e.width} mm (pedido 3000)`;
        return design.modules.some((m) => m.position[1] >= 1200) ? true : 'sem armário aéreo';
      },
    },
  },
  {
    id: 'bib-05',
    group: 'biblioteca',
    askAct: 'agir',
    prompt: 'Coloque um criado-mudo encostado à direita desta estante',
    expect: {
      action: ['update'],
      design: (design, helpers) => {
        if (!design.modules.some((m) => helpers.before.modules.some((b) => b.id === m.id)))
          return 'a estante original sumiu';
        return modulos(design) > helpers.before.modules.length ? true : 'nada foi adicionado';
      },
    },
    learned: 'Somar ao projeto usa placement right, sem trocar o que já existe.',
  },
  {
    id: 'bib-06',
    group: 'biblioteca',
    askAct: 'agir',
    prompt: 'Faça um guarda-roupa de 2,80 m de largura',
    expect: {
      action: ['update'],
      design: (design, helpers) => {
        const e = envelope(helpers);
        if (!perto(e.width, 2800)) return `largura ${e.width} mm (pedido 2800)`;
        return e.height >= 2000 ? true : `baixo para guarda-roupa: ${e.height} mm`;
      },
    },
  },
);

// Grupos do assistente em laço: o caminho antigo não mexe em câmera,
// arquivo, ambiente, preços, versões nem monta opções.
const efeito = (got, type, extra = {}) => got.effects.some((e) => e.type === type && Object.entries(extra).every(([k, v]) => e[k] === v));
const janelaNoMeio = { widthMm: 3200, heightMm: 2700, obstacles: [{ id: 'jan', kind: 'window', xMm: 1000, yMm: 1100, widthMm: 1200, heightMm: 1000 }] };
cases.push(
  {
    id: 'est-01',
    group: 'estudio',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'mostra de frente e abre as gavetas',
    setup: { ops: [{ kind: 'module.add', id: 'n', preset: 'niche' }, { kind: 'front.set', id: 'n:root', type: 'drawers', count: 3 }] },
    expect: {
      applied: false,
      agent: (got) =>
        !efeito(got, 'camera', { mode: 'front' }) ? 'não pôs a vista de frente' : !got.fronts?.open ? 'não abriu as gavetas' : true,
    },
  },
  {
    id: 'est-02',
    group: 'estudio',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'renomeia o projeto para Cozinha da Ana',
    expect: { agent: (got) => (got.project.name === 'Cozinha da Ana' ? true : `nome ficou "${got.project.name}"`) },
  },
  {
    id: 'est-03',
    group: 'estudio',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'gera o PDF e baixa o CSV das peças',
    expect: {
      applied: false,
      agent: (got) =>
        !efeito(got, 'export', { kind: 'pdf' }) ? 'sem PDF' : !efeito(got, 'export', { kind: 'parts-csv' }) ? 'sem CSV das peças' : true,
    },
  },
  {
    id: 'est-04',
    group: 'estudio',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'a parede tem 2,8 m de largura e 2,6 m de altura',
    expect: {
      agent: (got) =>
        got.room?.widthMm === 2800 && got.room?.heightMm === 2600 ? true : `parede ${got.room?.widthMm ?? '-'} × ${got.room?.heightMm ?? '-'}`,
    },
  },
  {
    id: 'est-05',
    group: 'estudio',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'sobe a margem para 35%',
    expect: {
      applied: false,
      agent: (got) => (got.effects.some((e) => e.type === 'prices' && e.prices.margin === 35) ? true : 'margem não foi para 35%'),
    },
  },
  {
    id: 'est-06',
    group: 'estudio',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'volta para a versão 1',
    setup: { ops: [{ kind: 'module.edit', id: 'module-1', width: 900 }] },
    expect: { agent: (got) => (got.project.cursor === 0 ? true : `ficou na versão ${got.project.cursor + 1}`) },
  },
  {
    id: 'auto-01',
    group: 'autoconferencia',
    askAct: 'livre',
    agentOnly: true,
    prompt: 'Coloque um armário aéreo de 80 cm de largura bem no meio da parede, a 1,5 m do piso.',
    setup: { room: janelaNoMeio },
    expect: {
      action: ['update', 'clarify', 'answer'],
      // A janela ocupa o meio: ou desvia, ou pergunta, ou diz que não dá.
      agent: (got) =>
        got.action !== 'update' || got.fitIssues === 0 || /janela/i.test(got.content)
          ? true
          : `aéreo sobre a janela sem avisar (${got.fitIssues} problema(s) de encaixe)`,
    },
  },
  {
    id: 'auto-02',
    group: 'autoconferencia',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Monte balcões e aéreos nessa parede e me mande o PDF.',
    setup: { room: janelaNoMeio },
    expect: {
      action: ['update'],
      agent: (got) => {
        if (!got.design.modules.some((m) => m.wall)) return 'sem aéreos';
        if (!efeito(got, 'export', { kind: 'pdf' })) return 'sem PDF';
        return got.fitIssues === 0 ? true : `${got.fitIssues} problema(s) de encaixe`;
      },
    },
  },
  {
    id: 'tc-01',
    group: 'trabalho-completo',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Cozinha para uma parede de 3,2 m com janela de 1,2 m no meio: balcões embaixo e aéreos dos dois lados da janela. Mostre de frente e me mande o PDF',
    expect: {
      action: ['update'],
      agent: (got) => {
        if (got.room?.widthMm !== 3200) return `parede ${got.room?.widthMm ?? 'sem ambiente'}`;
        if (!got.room.obstacles?.some((o) => o.kind === 'window')) return 'sem a janela';
        const floor = got.design.modules.filter((m) => !m.wall);
        const wall = got.design.modules.filter((m) => m.wall);
        if (floor.length < 2 || wall.length < 2) return `${floor.length} balcões e ${wall.length} aéreos`;
        if (got.fitIssues) return `${got.fitIssues} problema(s) de encaixe`;
        if (!efeito(got, 'camera', { mode: 'front' })) return 'não mostrou de frente';
        return efeito(got, 'export', { kind: 'pdf' }) ? true : 'sem PDF';
      },
    },
  },
  {
    id: 'op-01',
    group: 'opcoes',
    askAct: 'agir',
    agentOnly: true,
    prompt: 'Me dá 3 opções de estante para uma parede de 2 m: uma mais barata, uma com portas e uma com gavetas',
    expect: {
      // Medir a parede de 2 m vira versão (ambiente); o móvel é que não muda.
      agent: (got) => {
        if (got.design.modules.map((m) => `${m.id}:${m.width}`).join() !== 'module-1:800') return 'o móvel mudou; opções não aplicam nada';
        if (got.cards.length < 2) return `${got.cards.length} opção(ões)`;
        if (new Set(got.cards.map((c) => c.total)).size < got.cards.length) return 'opções com o mesmo preço';
        return got.cards.some((c) => c.drawers > 0) ? true : 'nenhuma opção com gavetas';
      },
    },
  },
);
cases.push(...compositionCases);
cases.push(...photoCases);
cases.push(...styleCases);

/** Rótulos de askAct e o que a ação de cada um não pode ser. */
export const ASK_ACT = ['agir', 'perguntar', 'responder', 'livre'];

/**
 * Erro de infraestrutura (provedor fora, limite de taxa, rede): não é
 * resultado do assistente. Sempre chega como exceção do turno.
 */
export const INFRA_ERROR =
  /exceção: .*(provedor de IA retornou|conexão com a IA|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|Insufficient|rate.?limit|Endpoint is unavailable|operation was aborted)/i;

/**
 * Impressão do caso (pedido, preparação, rótulo e expectativa): muda quando a
 * regra muda, e o painel marca as linhas avaliadas com a regra antiga.
 */
export function caseHash(c) {
  const norm = (v) =>
    typeof v === 'function' || v instanceof RegExp
      ? String(v).replace(/\s+/g, ' ')
      : Array.isArray(v)
        ? v.map(norm)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
          : v;
  const text = JSON.stringify(norm({ prompt: c.prompt, image: c.image, setup: c.setup, askAct: c.askAct, expect: c.expect }));
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

/**
 * Erro de perguntar ou agir, pela ação do turno: null quando combina com o
 * rótulo. O painel separa estes erros dos demais.
 */
export function askActMiss(askAct, action) {
  if (askAct === 'agir' && action === 'clarify') return 'perguntou em vez de fazer';
  if (askAct === 'responder' && action === 'clarify') return 'perguntou em vez de responder';
  if (askAct === 'perguntar' && ['update', 'undo', 'redo'].includes(action)) return 'fez em vez de perguntar';
  return null;
}

/** Casos que só rodam com modelo (os demais aceitam fixture gravada). */
export const requiresModel = new Set(['con-01', 'con-02', 'con-03', 'rec-01', 'rec-02', 'rec-03']);

export { modulos, conexoes, compartilhadas, modulo, pecas, semDizima };
