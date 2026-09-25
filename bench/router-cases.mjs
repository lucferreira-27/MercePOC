/**
 * Pedidos para calibrar o roteador (Jev). Cada caso diz o caminho certo:
 * - direct: ações que o app faz sem LLM (ids de DIRECT em lib/agent/router.ts);
 * - ask_axis: medida sem eixo, pergunta antes;
 * - agent: vai para o laço (intent opcional, só para medir a classificação).
 *
 * Atalho errado (direct/ask_axis onde devia ser agent, ou ação trocada) é o
 * erro grave: faz a coisa errada rápido. Atalho perdido só custa tempo.
 */
export const routerCases = [
  // ---- direto: vista e cena
  { text: 'mostra de frente', expect: 'direct', actions: ['vista_frente'] },
  { text: 'quero ver de lado', expect: 'direct', actions: ['vista_lado'] },
  { text: 'vista de cima', expect: 'direct', actions: ['vista_topo'] },
  { text: 'volta pra perspectiva', expect: 'direct', actions: ['vista_perspectiva'] },
  { text: 'enquadra o móvel', expect: 'direct', actions: ['enquadrar'] },
  { text: 'abre as portas e gavetas', expect: 'direct', actions: ['abrir_frentes'] },
  { text: 'fecha tudo', expect: 'direct', actions: ['fechar_frentes'] },
  { text: 'mostra de frente e abre as gavetas', expect: 'direct', actions: ['vista_frente', 'abrir_frentes'] },
  { text: 'explode as peças', expect: 'direct', actions: ['explodir'] },
  { text: 'junta as peças de novo', expect: 'direct', actions: ['juntar'] },
  { text: 'esconde as cotas', expect: 'direct', actions: ['cotas_esconder'] },
  { text: 'mostra as medidas na tela', expect: 'direct', actions: ['cotas_mostrar'] },
  // ---- direto: abas, versões, arquivos
  { text: 'abre o orçamento', expect: 'direct', actions: ['aba_orcamento'] },
  { text: 'me mostra o plano de corte', expect: 'direct', actions: ['aba_corte'] },
  { text: 'abre a lista de peças', expect: 'direct', actions: ['aba_pecas'] },
  { text: 'desfaz', expect: 'direct', actions: ['desfazer'] },
  { text: 'desfaz a última coisa que você fez', expect: 'direct', actions: ['desfazer'] },
  { text: 'refaz', expect: 'direct', actions: ['refazer'] },
  { text: 'gera o pdf', expect: 'direct', actions: ['pdf'] },
  { text: 'baixa o csv das peças', expect: 'direct', actions: ['csv_pecas'] },
  { text: 'quero o plano de corte em csv', expect: 'direct', actions: ['csv_corte'] },
  { text: 'tira uma foto da vista', expect: 'direct', actions: ['foto'] },
  { text: 'exporta o projeto em json', expect: 'direct', actions: ['json'] },
  { text: 'mostra de frente e manda o pdf', expect: 'direct', actions: ['vista_frente', 'pdf'] },
  // ---- medida sem eixo
  { text: 'aumenta 10 cm', expect: 'ask_axis' },
  { text: 'deixe com 2 metros', expect: 'ask_axis' },
  { text: 'diminui 5 centímetros', expect: 'ask_axis' },
  { text: 'coloca 90', expect: 'ask_axis' },
  // ---- laço: construir
  { text: 'faz uma cozinha pra uma parede de 3,20 com a janela no meio', expect: 'agent', intent: 'build' },
  { text: 'quero um rack de tv de 1,80', expect: 'agent', intent: 'build' },
  { text: 'monta um guarda-roupa de casal', expect: 'agent', intent: 'build' },
  { text: 'desenha uma estante de livros com portas embaixo', expect: 'agent', intent: 'build' },
  { text: 'Cozinha para uma parede de 3,2 m com janela de 1,2 m no meio: balcões embaixo e aéreos dos dois lados da janela. Mostre de frente e me mande o PDF', expect: 'agent', intent: 'build' },
  { text: 'monta um rack de 1,80 e me mostra de frente', expect: 'agent', intent: 'build' },
  { text: 'desenha um guarda-roupa de 2 portas e gera o pdf', expect: 'agent', intent: 'build' },
  { text: 'coloca uma porta no nicho e abre tudo', expect: 'agent', intent: 'edit' },
  // ---- laço: editar
  { text: 'aumenta a altura em 10 cm', expect: 'agent', intent: 'edit' },
  { text: 'deixa com 90 de largura', expect: 'agent', intent: 'edit' },
  { text: 'troca para nogueira', expect: 'agent', intent: 'edit' },
  { text: 'coloca duas portas no vão de cima', expect: 'agent', intent: 'edit' },
  { text: 'põe 3 gavetas no nicho da esquerda', expect: 'agent', intent: 'edit' },
  { text: 'tira as prateleiras do meio', expect: 'agent', intent: 'edit' },
  { text: 'adiciona um nicho de 60 à direita', expect: 'agent', intent: 'edit' },
  { text: 'abre só a porta da esquerda', expect: 'agent', intent: 'view' },
  // ---- laço: perguntas
  { text: 'quanto fica isso tudo?', expect: 'agent', intent: 'ask' },
  { text: 'quantas chapas vai usar?', expect: 'agent', intent: 'ask' },
  { text: 'qual a profundidade do balcão?', expect: 'agent', intent: 'ask' },
  { text: 'isso cabe na minha parede?', expect: 'agent', intent: 'ask' },
  // ---- laço: estúdio que precisa de argumento livre
  { text: 'deixa a margem em 40% e manda o pdf', expect: 'agent', intent: 'studio' },
  { text: 'volta pra versão 3', expect: 'agent', intent: 'studio' },
  { text: 'renomeia o projeto para Cozinha da Ana', expect: 'agent', intent: 'studio' },
  { text: 'a chapa de freijó agora custa 450', expect: 'agent', intent: 'studio' },
  { text: 'cria uma alternativa em branco', expect: 'agent', intent: 'studio' },
  // ---- laço: opções
  { text: 'me dá 3 opções: mais barata, mais espaço e mais bonita', expect: 'agent', intent: 'options' },
  { text: 'compara uma versão com portas e outra com gavetas', expect: 'agent', intent: 'options' },
  // ---- laço: mistura de tela com mudança
  { text: 'troca para freijó e mostra de frente', expect: 'agent', intent: 'edit' },
  { text: 'coloca gavetas e gera o pdf', expect: 'agent', intent: 'edit' },
];
