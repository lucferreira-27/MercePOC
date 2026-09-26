# Benchmark do Merce

Mede o caminho real do produto (prompt + modelo + validação + laço de correção) contra um corpus de pedidos reais, para saber se uma mudança **melhorou ou piorou**. Serve para três coisas:

1. Comparar modelos e configurações (provedor padrão, modo rápido, outro modelo).
2. Comparar prompts e o esquema de operações antes e depois de mexer.
3. Guardar, sem rede, as decisões já gravadas do modelo e conferir se o harness (validação, geometria, aplicação) continua aceitando o que aceitava.

Cada caso é um pedido que uma pessoa faria, colhido nas avaliações com usuários ou nos defeitos que elas revelaram, com uma expectativa verificável. O runner diz, caso a caso: passou, ação escolhida, latência, quantas chamadas ao provedor e quantas correções foram precisas. No fim, a comparação com uma execução anterior mostra o que passou a funcionar, o que passou a falhar, a variação de latência e a variação de correções.

## Como rodar

```bash
npm run bench                                  # corpus inteiro, uma vez cada caso
npm run bench -- --list                        # lista os casos e os grupos
npm run bench -- --group divisao               # um grupo
npm run bench -- --id amb-01 --repeat 3        # um caso, três vezes (mede a variância)
npm run bench -- --model luna                  # outro modelo: deepseek, luna, mimo ou qwen-fast
npm run bench -- --fast                        # atalho antigo de --model qwen-fast (Cerebras)
npm run bench -- --budget 600 --max-calls 40   # teto de tempo e de chamadas
npm run bench -- --record                      # grava as decisões em bench/fixtures
npm run bench -- --offline                     # sem rede, contra as fixtures gravadas
npm run bench -- --out bench/results/depois.json
npm run bench -- --compare bench/results/baseline.json
npm run bench -- --agent                       # o assistente em laço (lib/agent), o padrão do app
npm run bench -- --agent --record              # grava as respostas do modelo e do Jev em bench/fixtures/agent
npm run bench -- --agent --offline             # repete as gravações do laço, sem rede
npm run bench -- --agent --repeat 3 --concurrency 4   # três repetições, quatro casos por vez
npm run bench:router                           # roteador do Jev contra bench/router-cases.mjs
npm run bench:claims                           # conferência da resposta contra bench/claims-cases.mjs
npm run bench:askact                           # portão do perguntar (Jev) contra bench/askact-cases.mjs
```

### Perguntar ou fazer (`askAct`)

Todo caso diz o que o assistente deve fazer com o pedido: `agir` (fazer), `perguntar` (não mexer e perguntar), `responder` (só responder, sem perguntar) ou `livre` (os dois são razoáveis). A regra: perguntar só quando um chute errado custa caro e não há um padrão razoável nem um limite do produto para usar. Pedido acima do limite ("15 metros", "7 gavetas", "2,5 m de altura") é `agir`: faz no limite e diz qual é na resposta. A ação esperada (`expect.action`) tem de combinar com o rótulo; `tests/bench-cases.test.ts` confere.

O erro de perguntar ou agir tem nome próprio no resultado e no painel: **perguntou em vez de fazer** (pergunta num caso `agir` ou `responder`) e **fez em vez de perguntar** (mudou o projeto num caso `perguntar`). Era a falha mais comum em todos os modelos.

O portão do perguntar (`lib/agent/ask-gate.ts`) usa o Jev quando o assistente chama `ask_user`: o Jev diz o que a pergunta quer saber (eixo, peça, valor, limite, preferência, ambiente) e o código decide. Eixo só vale quando o pedido tem medida sem eixo; peça só sem seleção e com alvo vago, ou quando a peça citada sumiu; o resto tem padrão ou limite, e a pergunta volta para a IA fazer. Uma vez por pedido: se ela insistir, a pergunta segue. Sem Jev, a pergunta segue. `MERCE_ASK_GATE=0` desliga (para medir antes e depois); o rótulo da rodada diz "sem portão".

`npm run bench:askact -- --extract` refaz `bench/askact-cases.mjs` com as perguntas que o assistente já fez nas rodadas gravadas (sem repetir o par pedido + pergunta), rotuladas pelo `askAct` do caso. `npm run bench:askact` mede três jeitos de perguntar ao Jev: A (o par pedido + pergunta), B (o que a pergunta quer saber, o jeito do portão) e C (o pedido sozinho, no começo do turno, para pegar o "fez sem perguntar"). Critério: pegar pelo menos 70% das perguntas a mais e barrar no máximo uma legítima.

### Repetições, paralelo e erro do provedor

- `--repeat N` no laço grava e repete uma fixture por repetição: `<id>.json` na primeira, `<id>#2.json`, `<id>#3.json` nas outras. O resumo mostra o acerto médio com a faixa (mínimo a máximo) e os casos instáveis (passaram numa repetição e falharam noutra).
- `--concurrency N` roda N casos ao mesmo tempo. Cada caso tem o próprio estado (fita do Jev, chamadas ao provedor) por contexto assíncrono, então as gravações não se misturam; o resultado volta na ordem do corpus.
- Erro do provedor (503, conexão caída, limite de taxa) não é resultado do assistente: no laço, o caso roda de novo depois de 10 s e de 30 s. Se continuar, a linha sai com `infra: true` e fica fora da taxa ("55/59 casos válidos · 2 infra").
- Sem `--label`, a rodada ganha um rótulo com modelo, provedor, esforço, modo, portão, repetições e filtro.
- `--agent --record` não grava as fixtures do caminho antigo (foto): elas são de outra rodada, e sobrescrever estraga o `--offline` delas.
- Cada linha leva `caseHash`, a impressão do caso (pedido, preparação, rótulo e expectativa). O painel marca **regra antiga** nas linhas avaliadas antes de a expectativa mudar.

### Grupo `foto-real` e o gabarito

Fotos de celular de móveis e ambientes reais (quarto, sala, cozinha), com pedidos como a pessoa faria ("quero uma cômoda igual a essa", "monte essa parede da minha sala"). O gabarito de cada foto está em `bench/photo-real.mjs`: o desenho que um projetista montaria no Merce olhando a foto, feito com o mesmo `Builder` dos ativos da biblioteca, e o ambiente (parede, porta, janela, TV) quando o pedido é a parede.

- O resultado não precisa ser igual ao gabarito: a foto não tem medida. A nota (`similarity`, 0 a 100%) compara a impressão digital dos dois: frentes (porta, gaveta, nicho aberto, painel, prateleira de parede) casadas por posição relativa no envelope e pela contagem de cada tipo; largura, altura, profundidade e altura do chão; pés e tom das frentes; e, com ambiente, a largura da parede, cada porta, janela e TV no lugar (em fração da parede) e onde o móvel fica.
- O caso passa com 70% (`expect.minScore`) e a linha grava a nota (`score`, com as partes e o que diferiu) e o estado final (`final`), para desenhar foto, gabarito e resultado lado a lado.
- Calibração: o guarda-roupa da biblioteca (cinco colunas, gaveteiro) tira 53% contra o de oito portas da foto; a versão corrigida, 93%; a estante inicial contra a cômoda, 14%.

### Grupo `composicao` e o oráculo próprio

O pacote do redesenho do assistente (`bench/composition-cases.mjs`, ver `docs/plans/redesign-report.md`): composição em volta da TV (painel, TV fora do centro, parede sem painel), cozinha (móveis de apoio, layout bagunçado, parede de 3 m, altura da bancada), lavanderia (mais móveis, vão da máquina), guarda-roupa (módulo a mais, sem lugar), estante do zero, escritório com janela, redução de chapas, remoção ligada, troca do único módulo, edição exata e pedido impossível. `tv-03` e `esc-01` são casos guardados: expectativas escritas antes de rodar o candidato.

- Cada caso parte de uma cena em `bench/scenes` (`setup.scene`: cópia isolada de um projeto real, lida só uma vez do banco, ou variação gerada com as operações do contrato).
- O juiz é `bench/oracle.mjs`, independente do validador do app (o `fitReport` antigo aprovava um nicho na frente da TV): TV e painel no mesmo lugar do mundo, tela livre com 30 mm de folga, peça nova presa no painel, na parede ou no piso (sem flutuar nem passar da borda do painel), peça funcional, geometria válida, encaixe, resposta sem contradizer o plano de corte e o Ctrl+Z voltando móvel e ambiente.
- Cada linha grava `startHash` e `finalHash` (design + ambiente), `rejected` (tentativas recusadas), `report` (desfecho, fatos, conferência) e `final` (o estado gravado, para julgar de novo com outro oráculo). O resumo grava `code` (revisão e arquivos locais) e `promptHash` (regras + ferramentas).
- `--fixtures <pasta>` grava ou lê as respostas do laço noutra pasta: a base e o candidato não se misturam.
- `npx tsx bench/compare-redesign.mjs --base <rodadas ao vivo da base> --judge <base rejulgada offline> --cand <candidato> --md saida.md` monta a tabela caso a caso (acerto, recusas, chamadas, mediana, p90, custo).

### Painel (`npm run bench:dash`)

Página para quem desenvolve, gerada de todos os `bench/results/*.json` em `bench/results/painel.html` (uma página só, sem servidor nem rede). Cada rodada com `--out` atualiza o painel sozinha. `npm run bench:dash -- --serve` abre um servidor local em `http://127.0.0.1:4320/` que refaz o painel a cada recarga.

- **Rodadas:** acerto (só linhas válidas; com repetições, a média e a faixa), mediana, p90, máximo, custo por caso, cache, tokens de saída e erros de provedor de cada rodada, com os gráficos qualidade × custo e qualidade × tempo. Marque rodadas para comparar.
- **Rodada:** números da rodada, acerto por grupo, por que falhou (provedor, perguntou em vez de fazer, fez em vez de perguntar, harness, ação errada, resposta, resultado do móvel), tempo por caso e a tabela de casos; com repetições, cada linha mostra k/N do caso e marca "instável". Cada linha abre o que era certo (askAct), etapas, resposta, sugestões, tokens e o mesmo caso nas outras rodadas.
- **Comparar:** rodadas marcadas lado a lado, caso a caso (k/N quando há repetições), com o que melhorou e piorou contra a primeira.
- **Casos:** cada caso em todas as rodadas completas, quantas linhas falharam e quantas vezes trocou de resultado (instável). Por padrão só as linhas avaliadas com a regra de hoje; "incluir linhas com regra antiga" mostra todas.

Rodadas antigas são reavaliadas com a regra de perguntar ou agir de hoje (o `askAct` do caso, pela ação gravada): uma linha que passava e agora falha leva a marca **regra nova**. O erro do provedor vem da marca `infra` ou, em rodada antiga, de `INFRA_ERROR` em `bench/cases.mjs` (antes, "prateleira" contava como erro de provedor por conter "rate").

"Preço como" recalcula o custo pelos tokens com a tabela de um provedor (Command Code ou OpenCode Zen), para comparar a mesma rodada em outro provedor. Para o painel saber como a rodada foi feita, use `--label "nome"`; provedor, modelo e esforço vão sozinhos para o resultado.

Outras opções úteis: `--ids a,b,c` roda só esses casos; `--photo-legacy` manda foto pelo caminho antigo (a rota manda foto pelo laço); `MERCE_REASONING_EFFORT=none|low|medium|high|xhigh|max` troca o esforço de raciocínio (o Command Code só aceita de `low` para cima).

### Assistente em laço (`--agent`)

Cada caso roda por `runAgentTurn`, como a rota faz com o modo ligado, e o resultado vira as ações antigas (update, clarify, answer, undo, redo) para as mesmas expectativas valerem. Os grupos `estudio`, `autoconferencia`, `trabalho-completo` e `opcoes` são só do laço (`agentOnly`): o caminho antigo pula. Eles conferem com `expect.agent(got)`, que recebe efeitos (vista, arquivos, preços), frentes abertas, ambiente, projeto (nome, versão aberta), opções montadas e etapas.

As fixtures do laço (`bench/fixtures/agent/*.json`) guardam a sequência de respostas do modelo, cada uma identificada pelo pedido e pela posição na conversa (as opções rodam sub-laços em paralelo), e as respostas do Jev, identificadas pelas perguntas. Com `--offline` o laço repete tudo sem rede; se o caminho mudou (outra ferramenta, outra conversa), a gravação acaba antes e o caso falha dizendo isso.

O banco usado é temporário (`MERCE_DATA_DIR` em pasta do sistema): a base real de projetos nunca é tocada. A chave do provedor vem do `.env` da raiz, como no app.

Casos com foto (`image` no caso, grupos `foto` e `foto-real`) leem o arquivo indicado, salvam a imagem no diretório temporário e mandam o mesmo pedido que o app manda, com imagem. A foto **não** é versionada: ponha o arquivo em `bench/images/` (ignorado no git) para rodar; sem ele o caso é pulado com o motivo impresso, em vez de virar falha por falta de insumo. Com `--agent`, a foto vai pelo laço, como na rota (o laço confere o desenho com `render_look` e a rota ainda roda a conferência do resultado, `reviewAndCorrect`). `--photo-legacy` mede o caminho antigo: uma chamada com a foto e o desenho atual, os obstáculos da decisão no ambiente e a conferência com correção, como a rota fazia. Um pedido sem foto logo depois de um com foto recebe a foto de novo (`setup.history` no caso, ver `foto-03`).

Saídas: `bench/results/*.json` (ignorados no git) e `bench/fixtures/*.json` (versionados, uma decisão do modelo por caso, gravada com `--record`).

## O que cada medida significa

| Medida | Leitura |
|---|---|
| Taxa de acerto por grupo | Onde o par prompt + modelo erra mais |
| Latência média, mediana e p90 | Tempo de espera que o usuário sente (a cauda é o que dói) |
| Chamadas ao provedor por caso | 1 é o normal; 2 ou 3 significa que a validação recusou e o laço de correção entrou |
| Correções (`retrying`) | Quantas vezes o harness pediu para a IA refazer o lote |
| Custo (US$) por caso | Tokens do provedor (entrada, cache, saída) vezes a tabela de `lib/models.ts`; `costUsd` e `tokens` em cada resultado |
| Falhas com a decisão crua | Serve para distinguir erro do modelo de erro do harness |

`--offline` é o modo de regressão do harness: as decisões são as gravadas, então uma mudança na validação, na geometria ou na aplicação que quebre um caso aparece sem gastar chamada de modelo. Ele **não** mede prompt nem modelo, porque a resposta está congelada na fixture.

## Como adicionar um caso

Em `bench/cases.mjs`, um objeto com `id`, `group`, `askAct` (o que é certo: `agir`, `perguntar`, `responder` ou `livre`, ver acima), `prompt`, `setup` (operações aplicadas antes do turno, com ids explícitos), `expect` e `learned` (o que já vimos na prática, para não redescobrir). Campos de `expect`:

- `action`: ação ou lista de ações aceitáveis (`update`, `clarify`, `answer`, `undo`, `redo`), coerente com `askAct`.
- `agent(got)`: só no laço; confere efeitos, frentes, ambiente, projeto, opções e etapas.
- `applied`: `true` exige revisão nova; `false` exige que nada mude.
- `design(design, helpers, info)`: devolve `true` ou uma frase de erro. `helpers` traz `parts`, `cells`, `before`, `content`; `info` traz `action`, `content`, `options`, `deadOptions`.
- `content`: `mustMatch` e `mustNotMatch` (regex na resposta).
- `clarify`: mínimos do cartão (`minOptions`, `aliveOptions`).
- `image`: caminho da foto de referência do caso (opcional). Sem o arquivo, o caso é pulado.

Regra de ouro: a expectativa tem de ser **honesta**. Um caso que exige `undo` num projeto com uma única revisão reprova uma resposta correta. Se o modelo erra e a expectativa está certa, o caso fica como está e vira item de melhoria de prompt ou de harness.

## Onde o modelo erra (medido, e o que fazer)

A primeira execução completa (38 casos, 1 chamada por caso, mediana 5,1 s) deu 37 de 38 acertos. O que reprovou e o que merece atenção:

| Classe | Evidência | O que fazer |
|---|---|---|
| **Pedido inequívoco respondido com pergunta** | `uni-01` ("Aumente a largura para 2,40 m") voltou `clarify` nas duas execuções; `mon-02` ("um nicho em cima") alternou entre `clarify` e `update` | Prompt: pedido com eixo e valor explícitos é ordem, não pergunta; reservar `clarify` para alvo ou medida realmente ambíguos. Harness: quando a ação é `clarify` e o pedido casa com um padrão inequívoco (medida + eixo, palavra de posição), pedir uma segunda passada com a nota "o pedido era inequívoco; aplique" e medir a diferença aqui |
| **Variação entre execuções** | `mon-02` mudou de ação entre duas rodadas do mesmo prompt | Medir com `--repeat 3` e olhar pass@3, não pass@1; se a variação atrapalhar, fixar temperatura (quando o provedor permitir) ou aceitar duas respostas para lotes pequenos |
| **Ordem das operações no lote** | `div-04` (mesclar com frente) precisou de 2 chamadas: a validação recusou e o laço de correção resolveu | Manter o laço (é o que salva), mas o custo é uma chamada a mais; no prompt, dizer explicitamente a ordem para mesclar (remover a frente antes) como já é dito para dividir |
| **Consistência entre prosa e números** | `con-04` existe por causa disso: a IA dizia a soma das larguras (2000/2500) enquanto o envelope real era 1982/2464 por causa dos painéis compartilhados | Já passou nesta rodada, mas o caso fica fixo: prosa, tela e arquivo têm de citar o mesmo número. Reforço barato: mandar o envelope calculado no prompt, em vez de deixar o modelo somar |
| **Referência a peça que mudou ou sumiu** | `ref-01` acertou o esclarecimento, mas foi o caso mais lento (29 a 48 s) | O modelo pensa muito aqui. Vale um atalho no harness: quando o id citado não existe, perguntar direto com a lista de alvos vivos em vez de gastar uma passada inteira |
| **Latência da cauda** | `ref-01` 29 a 48 s; `mon-05`, `lim-04` e `div-04` entre 11 e 15 s; o resto abaixo de 8 s | Latência do benchmark é por turno curto: mediana 5 s aqui contra 15,7 s nas sessões com usuários reais (pedidos longos, vários módulos, correções). A cauda vem de raciocínio longo em lotes complexos, não de rede |
| **Escopo respeitado** | `rec-01` a `rec-03` (preço, plano de corte, ferragens) responderam sem inventar número em 2,6 a 4,6 s | Classe saudável; manter no corpus como regressão, porque é o tipo de resposta que engana o usuário quando piora |
| **Layout a partir de foto** | Primeiras tentativas do grupo `foto`: a IA recusava ("não consigo medir a foto"), depois montava o lote em ordem inválida (quatro `module.add` seguidos de `module.edit`, recusado como módulos sobrepostos) e usava `preset:"shelf"` para depois tentar dividir a raiz, que já vem dividida | Medido com perguntas de controle (quantas gavetas, o que está no vão de baixo, quantas colunas), o modelo **vê** a imagem e acertou as três: o que faltava era procedimento. O prompt ganhou o bloco de escala (âncora conhecida, proporção preservada, erro declarado) e as regras do motor que só apareceram montando o layout na mão: um módulo por vez (`add` → `edit` → `connect`), `shared:true` só com altura/profundidade/orientação/acabamento iguais, canto girado só na ponta da fileira, todas as `cell.split` antes de qualquer `front.set`, e `preset:"niche"` para quem vai definir as divisões. Custo medido: 40 a 170 s por cópia (turno longo de propósito: um layout inteiro em uma chamada), contra 5 s de um turno curto |
| **Chip de sugestão fora do contexto** | grupo `sugestoes` (3 casos): no prompt atual a IA devolve 3 próximos passos por turno, todos citando o que acabou de mudar; no caso de preço ela recusou e sugeriu só o que o produto faz | Este grupo existe para o chip: ele deixou de ser lista fixa e passou a vir da IA. Se a sugestão citar id interno, repetir a resposta ou prometer recurso fora do escopo, o caso reprova aqui, não na conversa do usuário |
| **Foto real de móvel e de ambiente** | Grupo `foto-real` (12 fotos de celular: quarto, sala, cozinha), nota contra o gabarito montado à mão. Caminho antigo (uma chamada e a conferência), 3 execuções por foto: média 63%, 34% das execuções com 70% ou mais, mediana 58 s. Laço com as regras de foto, 2 execuções por foto (v9): média 74%, 67% com 70% ou mais, mediana 94 s, US$ 0,007 por foto | O laço recebe a foto (a rota mandava pelo caminho antigo), faz o inventário no plan e monta com um place (substituir troca a estante de partida). O que pesava: a estante de partida bloqueava a porta da foto na parede, painel atrás da TV era recusado, o rack não se prendia no painel do mesmo lote, colunas de peça larga iam para cada módulo (3 nichos viravam 6), porta_dupla em cada coluna dobrava as folhas, e a conferência depois do laço corrigia sem contexto (piorou 4 de 24, melhorou 1; saiu). Continua fraco: foto de lado (larguras encolhem) e móvel pequeno ao fundo de uma foto de parede |
| **Móvel conhecido montado do zero** | Pedido real "faz um rack de TV": sem base, a IA empilhava módulos genéricos e o resultado não parecia um rack | A biblioteca (`lib/assets.ts`) dá 16 móveis paramétricos e o prompt manda começar pelo mais parecido com `asset.add`. Grupo `biblioteca` (6 casos: rack, painel com rack suspenso, cômoda, cozinha, criado-mudo ao lado, guarda-roupa com largura ditada): 6/6 no DeepSeek, ~4 s e US$ 0,0004 por caso. O catálogo entra no bloco fixo do prompt (cache): a entrada sobe ~2,9 mil tokens por turno, quase todos lidos do cache |

O que o benchmark **não** mede: qualidade do texto além das regex, aparência da interface, o cartão de esclarecimento clicando de verdade e o mundo real (paredes, preço, oficina). No grupo `foto` ele também não julga a fidelidade da cópia à imagem (isso é olho humano): mede que a fileira foi montada — vários módulos ligados, vão alto e aberto, coluna de vãos, gavetas — e que a resposta declara a régua, o erro e o que ficou de fora. O fluxo real com a foto anexada no compositor tem verificação própria: `work/qa/verify-foto.mjs`. Essas partes continuam cobertas pela avaliação com personas em navegador real (`work/qa2/`), que é onde os defeitos de fluxo apareceram. O chip clicável, o cartão com as duas respostas sugeridas e o roteiro de etapas têm verificação própria em navegador real: `work/qa/verify-chat-ui.mjs`.

<!-- catalogo -->
<!-- gerado por bench/doc.mjs: não edite à mão -->

### ambiguidade · Medida ou alvo ambíguo: pergunta quando não há padrão razoável, faz quando há

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `amb-01` | perguntar | deixe com 2 metros | ação clarify ou answer; não muda nada; resposta cita /largura\|altura\|profundidade/i | Na primeira avaliação a IA aplicou 2 metros na altura quando o usuário queria largura. Na segunda rodada ela passou a perguntar, mas a pergunta precisa citar as medidas possíveis. |
| `amb-02` | perguntar | aumente 10 cm | ação clarify ou answer; não muda nada; resposta cita /largura\|altura\|profundidade\|qual/i | Sem eixo, qualquer escolha é chute. Ivo digitou "aumente 10 cm" e a IA mexeu no módulo selecionado. |
| `amb-03` | perguntar | mova a outra prateleira 5 cm para cima | ação clarify ou answer; não muda nada; resposta cita /prateleira\|qual/i | Com quatro prateleiras, "a outra" não identifica nada. A rota já tem uma guarda para isso. |
| `amb-04` | agir | quero 1,20 de largura e 60 de profundidade | ação update; geometria conferida; resposta cita /cm\|mm\|metro/i | Marceneiro escreve "1,20" querendo metro, leigo escreve "60" querendo centímetro. O padrão razoável resolve (1,20 m e 60 cm): faz e diz as unidades que assumiu, em vez de perguntar. |

### unidades · Conversão de cm/m para mm

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `uni-01` | agir | Aumente a largura para 2,40 m. | ação update; muda o projeto; geometria conferida | O caso básico de conversão. É o pedido mais comum de um marceneiro. |
| `uni-02` | agir | Deixe a altura com 2 metros e meio. | ação update; geometria conferida; resposta cita /2400\|2,40\|limite\|máximo/i | 2,50 m excede o limite de módulo (2400 mm). Faz no limite e explica, sem aceitar nem ignorar. |
| `uni-03` | agir | a profundidade tem 45 cm | ação update; muda o projeto; geometria conferida | Conversão simples de centímetro. |

### montagem · Adicionar, conectar, empilhar, separar e remover módulos

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `mon-01` | agir | Adicione um nicho à direita deste módulo. | ação update; muda o projeto; geometria conferida | O caso mais frequente de todos: crescer a composição para a direita. |
| `mon-02` | agir | Coloque um nicho em cima deste módulo. | ação update; muda o projeto; geometria conferida | Empilhar usa side "top"; errar isso gera sobreposição e custa uma rodada de retry. |
| `mon-03` | agir | Crie dois nichos, um à direita do outro, ligados a este módulo. | ação update; muda o projeto; geometria conferida | Dois módulos ligados no mesmo pai caem um sobre o outro. A cadeia é a correção que a validação devolve. |
| `mon-04` | agir | Separe os módulos e remova o da direita. | ação update; muda o projeto; geometria conferida | Remover módulo conectado exige separar antes; a ordem das operações no lote importa. |
| `mon-05` | agir | Aumente a largura do módulo da direita para 1 metro e deixe a fileira com 2,20 m. | ação update; geometria conferida | Valdir tentou redimensionar um módulo encostado no vizinho e a sobreposição recusou o lote inteiro, inclusive o nome. É o caso que mede a capacidade de correção. |
| `mon-06` | agir | Adicione um nicho de 800 × 600 × 450 mm encostado à direita da estante. | ação update; geometria conferida | Medida ditada em três eixos: o modelo já aplicou só a largura duas vezes, com a prosa prometendo 800 × 600 × 450. O cartão da interface denuncia, mas o certo é aplicar as três. |

### divisao · Dividir compartimento, frentes, gavetas e ordem das operações

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `div-01` | agir | Divida este compartimento em duas colunas. | ação update; muda o projeto; geometria conferida | Divisão em colunas é pedido de projeto de interiores. |
| `div-02` | agir | Coloque três gavetas neste compartimento. | ação update; muda o projeto; geometria conferida | Gaveteiro é o preset mais usado por marceneiro. |
| `div-03` | agir | Divida em duas colunas e coloque uma porta em cada lado. | ação update; muda o projeto; geometria conferida | A ordem importa: dividir e depois pôr frente. Inverter gera "escolha um compartimento livre, sem frente". |
| `div-04` | agir | Junte os dois compartimentos de volta num só. | ação update; geometria conferida | cell.merge recusa nó com filhos que têm frente. A explicação é o que salva a experiência. |
| `div-05` | agir | Divida este compartimento com 50 mm na coluna da esquerda. | ação update; muda o projeto; geometria conferida; resposta cita /100\|mínimo\|livre/i | Vão livre mínimo de 100 mm: o produto precisa nomear o limite. |

### prateleiras · Operações nas prateleiras antigas (sh-N)

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `pra-01` | agir | Suba a prateleira de cima 5 cm. | ação update; muda o projeto; geometria conferida | Referência por posição ("de cima") é como o marceneiro fala. |
| `pra-02` | agir | Remova as duas prateleiras de baixo. | ação update; muda o projeto; geometria conferida | Remover de baixo para cima evita renumerar ids no meio do lote. |
| `pra-03` | agir | Deixe o vão de baixo com 45 cm. | ação update; muda o projeto; geometria conferida; resposta cita /450\|45 cm\|vão/i | Vão é medido do piso, não da prateleira anterior; confundir isso muda a peça toda. |

### limites · Limites físicos e do perfil: faz no limite e diz qual é

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `lim-01` | agir | Deixe a largura com 15 metros. | ação update; geometria conferida; resposta cita /1200\|limite\|máximo/i | O limite é por módulo, não do conjunto. Faz no limite (ou com mais módulos) e explica, em vez de só recusar. |
| `lim-02` | agir | Quero uma estante de 10 mm de altura. | ação update; muda o projeto; geometria conferida; resposta cita /200\|mínimo\|limite/i | Mínimo de 200 mm por módulo. Antes o caso aceitava recusar; a regra agora é fazer no limite e dizer o mínimo. |
| `lim-03` | agir | Coloque 7 gavetas neste compartimento. | ação update; geometria conferida; resposta cita /6\|seis\|máximo\|limite/i | De uma a seis gavetas por compartimento. Aplica seis e explica o limite. |
| `lim-04` | agir | Crie doze módulos iguais de 1 metro, um ao lado do outro. | ação update; geometria conferida; resposta cita /12\|doze\|limite\|máximo\|painéis/i | Doze módulos ou 200 painéis é o teto. Joana descobriu o teto de 200 painéis depois de 104 s de espera. |

### copias · Cópias independentes contra fileira compartilhada

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `cop-01` | agir | Duplique este módulo. | ação update; muda o projeto; geometria conferida | Uma cópia tem de ser independente: nada de painel compartilhado de graça. |
| `cop-02` | agir | Quero quatro cópias iguais deste módulo, cada uma independente. | ação update; muda o projeto; geometria conferida | Joana pediu 4 armários iguais e recebeu uma fileira com 3 laterais compartilhadas: o arquivo ficou 3 peças menor que a compra real. |

### consulta · Pergunta informativa: responder o estado, sem mexer em nada

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `con-01` | responder | Qual é a largura total do projeto? | ação answer; não muda nada; resposta cita /\d/; resposta não traz /sh-\d\|module-\d\|:\/\/\|a:root/ | A resposta tem de citar o número do projeto e nunca ids internos (a primeira rodada devolveu "sh-4"). |
| `con-02` | responder | Quantas peças o projeto tem hoje? | ação answer; não muda nada; geometria conferida | Contagem é a pergunta de quem vai comprar chapa. |
| `con-04` | responder | Qual é a largura total do conjunto? | ação answer; não muda nada; geometria conferida | O vendedor Tiago viu a IA dizer 2.500 mm enquanto o app mostrava 2.464 mm: a prosa somava as larguras dos módulos e ignorava os painéis compartilhados. O número do envelope tem de ser o mesmo na tela, no arquivo e na conversa. |
| `con-03` | responder | Descreva os módulos do projeto. | ação answer; não muda nada; resposta cita /módulo\|Estante/i; resposta não traz /sh-\d\|module-\d\|a:root/ | Descrição é pedida por quem acabou de abrir o projeto e não sabe o que tem ali. |

### recusa · Pedido fora do escopo do produto: não inventar

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `rec-01` | responder | Quanto custa esse armário? Me dá o preço em reais. | ação answer; não muda nada; resposta cita /R\$\s*\d/, /estimad\|orçamento\|aproximad\|tabela\|custo\|margem/i | Cinco das seis personas pediram preço. Antes o produto não tinha tabela e a resposta honesta era recusar; agora a aba Orçamento calcula com a tabela de preços, então a resposta dá o total estimado e diz de onde vem, sem inventar. |
| `rec-02` | responder | Me manda o plano de corte das chapas, com quantas chapas eu compro. | ação answer; não muda nada; resposta cita /\d+\s*chapas?\|chapas?[^.]*\d/i | Antes o CSV era só lista de peças e a resposta honesta era recusar; agora o plano de corte (aba Corte) conta as chapas, e a resposta usa esse número. |
| `rec-03` | responder | Liste as ferragens e as posições de furação das dobradiças. | ação answer; não muda nada; resposta cita /não\|fora\|não faz\|não inclui\|furação/i | Ferragem e furação estão fora do escopo declarado; a IA não pode preencher com números plausíveis. |

### referencia · Referência a peça que mudou ou sumiu

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `ref-01` | perguntar | Suba a prateleira 4 mais 5 cm. | ação clarify ou answer; não muda nada; resposta cita /não existe\|qual\|escolha\|já não/i | Peça removida nunca é substituída em silêncio: o Ivo viu a IA mover a peça errada. |
| `ref-02` | agir | Mova esta prateleira 5 cm para cima. | ação update; muda o projeto; geometria conferida | A seleção explícita tem precedência sobre qualquer referência anterior. |

### navegacao · Desfazer, refazer e voltar versão

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `nav-01` | agir | Desfaça a última alteração. | ação undo; muda o projeto; geometria conferida | Desfazer sem ops. O caso precisa de duas revisões: no primeiro projeto a resposta certa é dizer que não há nada para desfazer, e o modelo fez exatamente isso. |
| `nav-02` | agir | Volte uma versão e deixe a largura com 900 mm. | ação undo ou update; geometria conferida | Foi o P1 da primeira rodada: editar a partir de uma versão antiga descartava 9 versões em silêncio. Hoje a interface confirma o descarte, e o modelo deve preferir desfazer a truncar. |

### tipos · Tipos de móvel que o produto declara não suportar

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `tip-01` | responder | Quero uma porta de correr neste armário. | ação answer ou update; resposta cita /não\|correr\|disponível\|suporta/i | Porta deslizante está fora do perfil: o produto avisa, não finge. |
| `tip-02` | responder | Faça um tampo de mesa de 1,50 m para o escritório. | ação answer; não muda nada; resposta cita /não\|mesa\|tampo\|suporta/i | Tampos avulsos e mesas estão fora do escopo declarado. |

### sugestoes · Próximos passos propostos pela IA para o chip de sugestão

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `sug-01` | agir | Adicione um nicho à direita da estante. | ação update | O chip deixou de ser lista fixa: depois de mexer no nicho, o próximo passo tem de falar do nicho, não de conselho genérico. |
| `sug-02` | responder | Qual é a altura total do projeto? | ação answer | Pergunta informativa também abre caminho para o próximo pedido sem sugerir algo fora do escopo. |
| `sug-03` | responder | Quanto custa para fazer este armário? | ação answer | Cinco de seis personas pediram preço. Antes a sugestão não podia citar preço porque o produto não tinha tabela; agora tem, e a sugestão não pode abrir porta para o que continua fora (furação, mão de obra). |

### foto · Foto de referência: estimar a escala e montar o layout, sem recusar

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `foto-01` | agir | Copia o layout dessa foto: é um armário de canto com nicho no meio. | ação update; muda o projeto; geometria conferida; resposta cita /(estimat\|aproximad\|régua\|margem\|erro\|±\|\+\/-)/i; resposta não traz /(não consigo medir\|não posso medir\|sem uma referência real\|não é possível medir)/i | Antes o prompt mandava pedir as medidas que faltavam e o modelo recusava copiar layouts de foto. Medido com perguntas de controle, ele vê a imagem e acerta; o que faltava era o procedimento de escala e a ordem da montagem (um módulo por vez, medidas antes do próximo add, frentes por último). |
| `foto-02` | agir | Copia o layout da foto, mas a minha parede tem 3600 mm. | ação update; muda o projeto; geometria conferida; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir)/i | Duas medidas na mesma frase (layout da foto + parede real): a parede manda na escala e a foto nas proporções. |
| `foto-03` | agir | Esses aqui estao errados. nao estao na imagem ref | ação update; muda o projeto; geometria conferida; resposta não traz /(imagem\|foto\|referência)[^.]{0,40}(não está disponível\|indisponível\|não (consigo\|posso) ver)/i | Pedido real depois de um turno com foto: a foto não voltava no pedido seguinte, a IA tirou as gavetas selecionadas e deixou o vão aberto, dizendo que a imagem não estava disponível. A conferência já tinha dito "quatro colunas de portas contínuas". |

### foto-real · Fotos reais de móveis e ambientes, comparadas com o gabarito montado à mão

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `real-01` | agir | Quero uma cômoda igual a essa da foto. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Cômoda comum de quarto: quatro gavetas com nicho em cima, e do lado duas gavetas e uma porta. |
| `real-02` | agir | Faz esse guarda-roupa pra mim, com as mesmas cores. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Dois corpos de cores diferentes: preto com duas portas e madeira com duas portas sobre duas gavetas. Na foto há também um gaveteiro e uma porta do quarto. |
| `real-03` | agir | Use esta imagem como referência para a estante. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | O pedido real que abriu esta rodada: o modelo usou o guarda-roupa da biblioteca (gaveteiro no meio, cinco colunas) em vez das quatro colunas de portas da foto. |
| `real-04` | agir | Quero fazer esse gaveteiro de madeira da esquerda, com as 6 gavetas. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Foto com vários móveis: o pedido aponta o gaveteiro entalhado ao lado do guarda-roupa. |
| `real-05` | agir | Quero essa prateleira com nichos que está na parede, em cima da cama. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Nicho suspenso comprido, três vãos abertos, preso na parede acima da cama. |
| `real-12` | agir | Faz essa prateleira de nichos igual à da foto. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | A mesma prateleira do quarto verde, de frente e de perto: três nichos iguais, laterais inclinadas (fora do contrato) e mãos-francesas. |
| `real-06` | agir | Monta essa parede da minha sala: o painel da TV com o rack e a porta do lado. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Painel com prateleira em cima, rack suspenso de duas gavetas com tampo de madeira, TV e a porta de entrada na mesma parede. |
| `real-07` | agir | Monte essa parede do meu quarto como está na foto: a janela e a cômoda do lado. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Parede com janela e a cômoda à esquerda dela; a cama e o nicho ficam fora do pedido. |
| `real-08` | agir | Quero um guarda-roupa igual a esse preto e madeira. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | O mesmo guarda-roupa de duas cores, visto de lado com a cama e a porta na frente. |
| `real-09` | agir | Monte a parede da pia da minha cozinha como na foto: o gabinete com as portas e as gavetas, o espaço do fogão e a janela. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Cozinha real: gabinete branco sob a pia, fogão de piso à esquerda, geladeira à direita, janela larga e nenhum aéreo. O ativo "cozinha" traz aéreo e não serve como está. |
| `real-11` | agir | Monte a parede da pia como nessa foto da cozinha, com o fogão, o gabinete e a janela. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | A mesma parede da pia vista do canto, com a ilha e a torre na frente: o pedido é só a parede da pia. |
| `real-10` | agir | Faz esse armário branco do micro-ondas que fica do lado da geladeira. | ação update; muda o projeto; resposta não traz /(não consigo medir\|não posso medir\|não é possível medir\|imagem não está disponível)/i | Torre alta com nicho aberto para o micro-ondas: portas em cima e embaixo, gaveta sob o nicho, em foto com geladeira e ilha na frente. |

### biblioteca · Móvel conhecido pedido pelo nome: partir do ativo certo da biblioteca

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `bib-01` | agir | Faz um rack de TV pra mim | ação update; geometria conferida | Sem base, a IA montava uma estante e chamava de rack; o ativo rack-tv resolve. |
| `bib-02` | agir | Quero um painel de TV com rack suspenso | ação update; geometria conferida |  |
| `bib-03` | agir | Monte uma cômoda de 1 metro de largura com gavetas | ação update; geometria conferida |  |
| `bib-04` | agir | Quero uma cozinha de 3 metros com armário aéreo | ação update; geometria conferida |  |
| `bib-05` | agir | Coloque um criado-mudo encostado à direita desta estante | ação update; geometria conferida | Somar ao projeto usa placement right, sem trocar o que já existe. |
| `bib-06` | agir | Faça um guarda-roupa de 2,80 m de largura | ação update; geometria conferida |  |

### estudio · Assistente em laço: câmera, frentes, arquivos, ambiente, preços, versões e nome do projeto

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `est-01` | agir | mostra de frente e abre as gavetas | resultado do laço conferido; não muda nada |  |
| `est-02` | agir | renomeia o projeto para Cozinha da Ana | resultado do laço conferido |  |
| `est-03` | agir | gera o PDF e baixa o CSV das peças | resultado do laço conferido; não muda nada |  |
| `est-04` | agir | a parede tem 2,8 m de largura e 2,6 m de altura | resultado do laço conferido |  |
| `est-05` | agir | sobe a margem para 35% | resultado do laço conferido; não muda nada |  |
| `est-06` | agir | volta para a versão 1 | resultado do laço conferido |  |

### autoconferencia · Assistente em laço: confere o próprio trabalho (encaixe, pedido cumprido) antes de responder

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `auto-01` | livre | Coloque um armário aéreo de 80 cm de largura bem no meio da parede, a 1,5 m do piso. | resultado do laço conferido; ação update ou clarify ou answer |  |
| `auto-02` | agir | Monte balcões e aéreos nessa parede e me mande o PDF. | resultado do laço conferido; ação update |  |

### trabalho-completo · Assistente em laço: pedido grande do começo ao fim (parede, móveis, vista, arquivo)

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `tc-01` | agir | Cozinha para uma parede de 3,2 m com janela de 1,2 m no meio: balcões embaixo e aéreos dos dois lados da janela. Mostre de frente e me mande o PDF | resultado do laço conferido; ação update |  |

### opcoes · Assistente em laço: opções lado a lado sem mudar o projeto

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `op-01` | agir | Me dá 3 opções de estante para uma parede de 2 m: uma mais barata, uma com portas e uma com gavetas | resultado do laço conferido |  |

### composicao · Pacote do redesenho: composição em volta da TV, cozinha, lavanderia, guarda-roupa, estante, layout, edição exata e pedido impossível (oráculo próprio)

| caso | o certo é | pedido | expectativa | o que já aprendemos |
|---|---|---|---|---|
| `tv-01` | agir | Vamos adicionar os nossos modelos custum no painel seja creativo | resultado do laço conferido; ação update; muda o projeto | Pedido real de 26/09 (Luna): 16 chamadas, 160 s, seis recusas (vão de 78 e 22 mm, nicho sobreposto ao painel duas vezes, profundidade e altura fora do limite) e o resultado aceito tapava a TV com um nicho alto e chamava de prateleira um painel vertical de 900 × 220 × 25 mm. |
| `tv-02` | agir | Monte uns módulos criativos em volta da TV, aproveitando o painel. Pode usar carvalho. | resultado do laço conferido; ação update; muda o projeto | Variação não vista: painel largo, TV de 65" fora do centro, rack embaixo e janela à direita. |
| `tv-03` | agir | Quero nichos e prateleiras na parede em volta da TV, algo bonito e equilibrado. | resultado do laço conferido; ação update; muda o projeto | Caso guardado: parede lisa sem painel, rack de TV da biblioteca embaixo. Expectativa congelada antes do candidato. |
| `coz-01` | agir | adicione outros moveis junto que fazem snetidom em uma cozinha, uma mesa, cadeiras, etc | resultado do laço conferido; ação update; muda o projeto; resposta cita /mesa\|cadeira/i | Pedido real: a IA montou um apoio, descartou com history_undo, montou outro; o registro guardou a operação descartada. Mesa e cadeira não existem no estúdio. |
| `coz-02` | agir | arrume o layout: tudo encostado na parede, os armários de baixo juntos, sem vão entre eles, e os aéreos com a base a 1,5 m do piso | resultado do laço conferido; ação update; muda o projeto | Mudança de layout: só posições mudam; medidas, frentes e acabamentos ficam. Pedido real parecido esbarrou em "Selecione uma prateleira horizontal". |
| `coz-03` | agir | "Não cabe: o móvel tem 4,86 m de largura e a parede tem 3,00 m" arrume isso | resultado do laço conferido; ação update; muda o projeto | A parede de 3 m foi medida depois da cozinha: o certo é caber nela sem mexer na parede. |
| `coz-04` | agir | Deixe a bancada com 90 cm de altura | resultado do laço conferido; ação update; muda o projeto | Edição exata numa fileira com painéis compartilhados: a altura vale para a fileira toda, e os aéreos não podem bater. |
| `lav-01` | agir | Adicone mais moveis e deixe o ceneario mais realista | resultado do laço conferido; ação update ou answer | Pedido real (DeepSeek): estourou o tempo, gravou 4 módulos e um móvel de 4,20 m numa parede de 3,20 m, e a resposta disse "O móvel não mudou". |
| `lav-02` | agir | Deixe um vão livre de 60 cm para a máquina de lavar à esquerda do armário e coloque um armário aéreo em cima dela | resultado do laço conferido; ação update; muda o projeto | Pedido real parecido: criou caixas chamadas "Vão máquina de lavar". O nome não faz o vão: o oráculo confere o espaço livre. |
| `gr-01` | agir | Adicione um módulo de 60 cm à direita do guarda-roupa, com a mesma altura e profundidade, com prateleiras e uma porta | resultado do laço conferido; ação update; muda o projeto | Guarda-roupa que cresce de lado: mesma altura e profundidade, encostado, com interior e frente. |
| `gr-02` | livre | Coloque uma sapateira de 60 cm ao lado do guarda-roupa | resultado do laço conferido; ação update ou answer ou clarify | Sem lugar: o canto fica à esquerda e a porta do quarto 8 cm à direita. O certo é dizer o conflito e o que dá para fazer, sem tapar a porta nem mexer na parede. |
| `est-10` | agir | Quero uma estante de 1,6 m de largura por 2 m de altura, com nichos abertos em cima e portas embaixo | resultado do laço conferido; ação update; muda o projeto | Estante do zero sobre o projeto novo: medidas ditadas valem, e o interior precisa ter nichos em cima e portas embaixo. |
| `esc-01` | agir | Monte uma estante para livros em volta da janela, com armários baixos embaixo dela | resultado do laço conferido; ação update; muda o projeto | Caso guardado fora de TV: janela no meio da parede e uma cômoda no canto. Expectativa congelada antes do candidato. |
| `mat-01` | agir | Reduco a quantidade placas necesseria, entao tudo do mesmo material | resultado do laço conferido; ação update; muda o projeto | Pedido real: trocou o carvalho por nogueira, leu o orçamento, depois passou os painéis de 25 para 18 mm e respondeu que o plano ainda usava 25 e 18 mm. O estado final tinha 2 chapas de nogueira 18 mm. |
| `rem-01` | agir | Remove tudo menos a tv e o painel | resultado do laço conferido; ação update; muda o projeto | Pedido real: a primeira tentativa foi recusada com "Separe as conexões antes de remover o módulo". |
| `rep-01` | agir | Crie um gaveteiro de 80 × 90 × 45 cm no lugar da estante | resultado do laço conferido; ação update; muda o projeto | Pedido real parecido: a primeira tentativa foi recusada com "Mantenha ao menos um módulo". |
| `edit-01` | agir | Deixe o nicho de destaque com 35 cm de largura e em nogueira, sem mexer no resto. | resultado do laço conferido; ação update; muda o projeto | Edição exata depois de uma composição: a medida pedida vale e o resto não muda. |
| `imp-01` | livre | Coloque uma estante de vidro curva de 3 metros bem na frente da TV | resultado do laço conferido; ação update ou answer ou clarify; resposta cita /vidro\|curv/i | Pedido impossível de propósito: vidro e curva não existem, e na frente da TV tapa a tela. |

Total: 92 casos em 21 grupos.
