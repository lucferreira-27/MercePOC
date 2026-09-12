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
npm run bench -- --fast                        # usa o perfil rápido (Cerebras)
npm run bench -- --budget 600 --max-calls 40   # teto de tempo e de chamadas
npm run bench -- --record                      # grava as decisões em bench/fixtures
npm run bench -- --offline                     # sem rede, contra as fixtures gravadas
npm run bench -- --out bench/results/depois.json
npm run bench -- --compare bench/results/baseline.json
```

O banco usado é temporário (`MERCE_DATA_DIR` em pasta do sistema): a base real de projetos nunca é tocada. A chave do provedor vem do `.env` da raiz, como no app.

Casos com foto (`image` no caso, grupo `foto`) leem o arquivo indicado, salvam a imagem no diretório temporário e mandam o mesmo pedido que o app manda, com imagem. A foto **não** é versionada: ponha o arquivo em `bench/images/` (ignorado no git) para rodar; sem ele o caso é pulado com o motivo impresso, em vez de virar falha por falta de insumo.

Saídas: `bench/results/*.json` (ignorados no git) e `bench/fixtures/*.json` (versionados, uma decisão do modelo por caso, gravada com `--record`).

## O que cada medida significa

| Medida | Leitura |
|---|---|
| Taxa de acerto por grupo | Onde o par prompt + modelo erra mais |
| Latência média, mediana e p90 | Tempo de espera que o usuário sente (a cauda é o que dói) |
| Chamadas ao provedor por caso | 1 é o normal; 2 ou 3 significa que a validação recusou e o laço de correção entrou |
| Correções (`retrying`) | Quantas vezes o harness pediu para a IA refazer o lote |
| Falhas com a decisão crua | Serve para distinguir erro do modelo de erro do harness |

`--offline` é o modo de regressão do harness: as decisões são as gravadas, então uma mudança na validação, na geometria ou na aplicação que quebre um caso aparece sem gastar chamada de modelo. Ele **não** mede prompt nem modelo, porque a resposta está congelada na fixture.

## Como adicionar um caso

Em `bench/cases.mjs`, um objeto com `id`, `group`, `prompt`, `setup` (operações aplicadas antes do turno, com ids explícitos), `expect` e `learned` (o que já vimos na prática, para não redescobrir). Campos de `expect`:

- `action`: ação ou lista de ações aceitáveis (`update`, `clarify`, `answer`, `undo`, `redo`).
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

O que o benchmark **não** mede: qualidade do texto além das regex, aparência da interface, o cartão de esclarecimento clicando de verdade e o mundo real (paredes, preço, oficina). No grupo `foto` ele também não julga a fidelidade da cópia à imagem (isso é olho humano): mede que a fileira foi montada — vários módulos ligados, vão alto e aberto, coluna de vãos, gavetas — e que a resposta declara a régua, o erro e o que ficou de fora. O fluxo real com a foto anexada no compositor tem verificação própria: `work/qa/verify-foto.mjs`. Essas partes continuam cobertas pela avaliação com personas em navegador real (`work/qa2/`), que é onde os defeitos de fluxo apareceram. O chip clicável, o cartão com as duas respostas sugeridas e o roteiro de etapas têm verificação própria em navegador real: `work/qa/verify-chat-ui.mjs`.

<!-- catalogo -->
<!-- gerado por bench/doc.mjs: não edite à mão -->

### ambiguidade · Medida ou alvo ambíguo: precisa perguntar em vez de adivinhar

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `amb-01` | deixe com 2 metros | ação clarify ou update; geometria conferida; resposta cita /largura|altura|profundidade/i | Na primeira avaliação a IA aplicou 2 metros na altura quando o usuário queria largura. Na segunda rodada ela passou a perguntar, mas a pergunta precisa citar as medidas possíveis. |
| `amb-02` | aumente 10 cm | ação clarify; não muda nada; resposta cita /largura|altura|profundidade|qual/i | Sem eixo, qualquer escolha é chute. Ivo digitou "aumente 10 cm" e a IA mexeu no módulo selecionado. |
| `amb-03` | mova a outra prateleira 5 cm para cima | ação clarify ou update; resposta cita /prateleira|qual/i | Com quatro prateleiras, "a outra" não identifica nada. A rota já tem uma guarda para isso. |
| `amb-04` | quero 1,20 de largura e 60 de profundidade | ação clarify ou update; geometria conferida; resposta cita /cm|mm|metro/i | Marceneiro escreve "1,20" querendo metro, leigo escreve "60" querendo centímetro. Precisa confirmar a unidade. |

### unidades · Conversão de cm/m para mm

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `uni-01` | Aumente a largura para 2,40 m. | ação update; muda o projeto; geometria conferida | O caso básico de conversão. É o pedido mais comum de um marceneiro. |
| `uni-02` | Deixe a altura com 2 metros e meio. | ação update ou clarify; geometria conferida; resposta cita /2400|2,40|limite|máximo/i | 2,50 m excede o limite de módulo (2400 mm). O produto tem de explicar, não aceitar nem ignorar. |
| `uni-03` | a profundidade tem 45 cm | ação update; muda o projeto; geometria conferida | Conversão simples de centímetro. |

### montagem · Adicionar, conectar, empilhar, separar e remover módulos

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `mon-01` | Adicione um nicho à direita deste módulo. | ação update; muda o projeto; geometria conferida | O caso mais frequente de todos: crescer a composição para a direita. |
| `mon-02` | Coloque um nicho em cima deste módulo. | ação update; muda o projeto; geometria conferida | Empilhar usa side "top"; errar isso gera sobreposição e custa uma rodada de retry. |
| `mon-03` | Crie dois nichos, um à direita do outro, ligados a este módulo. | ação update; muda o projeto; geometria conferida | Dois módulos ligados no mesmo pai caem um sobre o outro. A cadeia é a correção que a validação devolve. |
| `mon-04` | Separe os módulos e remova o da direita. | ação update; muda o projeto; geometria conferida | Remover módulo conectado exige separar antes; a ordem das operações no lote importa. |
| `mon-05` | Aumente a largura do módulo da direita para 1 metro e deixe a fileira com 2,20 m. | ação update ou clarify; geometria conferida | Valdir tentou redimensionar um módulo encostado no vizinho e a sobreposição recusou o lote inteiro, inclusive o nome. É o caso que mede a capacidade de correção. |
| `mon-06` | Adicione um nicho de 800 × 600 × 450 mm encostado à direita da estante. | ação update; geometria conferida | Medida ditada em três eixos: o modelo já aplicou só a largura duas vezes, com a prosa prometendo 800 × 600 × 450. O cartão da interface denuncia, mas o certo é aplicar as três. |

### divisao · Dividir compartimento, frentes, gavetas e ordem das operações

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `div-01` | Divida este compartimento em duas colunas. | ação update; muda o projeto; geometria conferida | Divisão em colunas é pedido de projeto de interiores. |
| `div-02` | Coloque três gavetas neste compartimento. | ação update; muda o projeto; geometria conferida | Gaveteiro é o preset mais usado por marceneiro. |
| `div-03` | Divida em duas colunas e coloque uma porta em cada lado. | ação update; muda o projeto; geometria conferida | A ordem importa: dividir e depois pôr frente. Inverter gera "escolha um compartimento livre, sem frente". |
| `div-04` | Junte os dois compartimentos de volta num só. | ação update ou clarify; geometria conferida | cell.merge recusa nó com filhos que têm frente. A explicação é o que salva a experiência. |
| `div-05` | Divida este compartimento com 50 mm na coluna da esquerda. | ação update ou clarify; geometria conferida; resposta cita /100|mínimo|livre/i | Vão livre mínimo de 100 mm: o produto precisa nomear o limite. |

### prateleiras · Operações nas prateleiras antigas (sh-N)

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `pra-01` | Suba a prateleira de cima 5 cm. | ação update; muda o projeto; geometria conferida | Referência por posição ("de cima") é como o marceneiro fala. |
| `pra-02` | Remova as duas prateleiras de baixo. | ação update; muda o projeto; geometria conferida | Remover de baixo para cima evita renumerar ids no meio do lote. |
| `pra-03` | Deixe o vão de baixo com 45 cm. | ação update; muda o projeto; geometria conferida; resposta cita /450|45 cm|vão/i | Vão é medido do piso, não da prateleira anterior; confundir isso muda a peça toda. |

### limites · Limites físicos e do perfil: precisa recusar com clareza

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `lim-01` | Deixe a largura com 15 metros. | ação clarify ou update ou answer; geometria conferida; resposta cita /1200|limite|máximo/i | O limite é por módulo, não do conjunto. Precisa explicar isso em vez de só recusar. |
| `lim-02` | Quero uma estante de 10 mm de altura. | ação clarify ou answer; não muda nada; resposta cita /200|mínimo|limite/i | Mínimo de 200 mm por módulo. |
| `lim-03` | Coloque 7 gavetas neste compartimento. | ação clarify ou update; geometria conferida; resposta cita /6|seis|máximo|limite/i | De uma a seis gavetas por compartimento. Recusar ou aplicar seis explicando são as duas saídas honestas. |
| `lim-04` | Crie doze módulos iguais de 1 metro, um ao lado do outro. | ação update ou clarify; geometria conferida; resposta cita /12|doze|limite|máximo|painéis/i | Doze módulos ou 200 painéis é o teto. Joana descobriu o teto de 200 painéis depois de 104 s de espera. |

### copias · Cópias independentes contra fileira compartilhada

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `cop-01` | Duplique este módulo. | ação update; muda o projeto; geometria conferida | Uma cópia tem de ser independente: nada de painel compartilhado de graça. |
| `cop-02` | Quero quatro cópias iguais deste módulo, cada uma independente. | ação update; muda o projeto; geometria conferida | Joana pediu 4 armários iguais e recebeu uma fileira com 3 laterais compartilhadas: o arquivo ficou 3 peças menor que a compra real. |

### consulta · Pergunta informativa: responder o estado, sem mexer em nada

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `con-01` | Qual é a largura total do projeto? | ação answer; não muda nada; resposta cita /\d/; resposta não traz /sh-\d|module-\d|:\/\/|a:root/ | A resposta tem de citar o número do projeto e nunca ids internos (a primeira rodada devolveu "sh-4"). |
| `con-02` | Quantas peças o projeto tem hoje? | ação answer; não muda nada; geometria conferida | Contagem é a pergunta de quem vai comprar chapa. |
| `con-04` | Qual é a largura total do conjunto? | ação answer; não muda nada; geometria conferida | O vendedor Tiago viu a IA dizer 2.500 mm enquanto o app mostrava 2.464 mm: a prosa somava as larguras dos módulos e ignorava os painéis compartilhados. O número do envelope tem de ser o mesmo na tela, no arquivo e na conversa. |
| `con-03` | Descreva os módulos do projeto. | ação answer; não muda nada; resposta cita /módulo|Estante/i; resposta não traz /sh-\d|module-\d|a:root/ | Descrição é pedida por quem acabou de abrir o projeto e não sabe o que tem ali. |

### recusa · Pedido fora do escopo do produto: não inventar

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `rec-01` | Quanto custa esse armário? Me dá o preço em reais. | ação answer ou clarify; não muda nada; resposta não traz /R\$\s*\d/ | Cinco das seis personas pediram preço. O produto não tem tabela de preços: a resposta honesta é dizer o que não faz e o que levar à loja, nunca inventar valor. |
| `rec-02` | Me manda o plano de corte das chapas, com quantas chapas eu compro. | ação answer ou clarify; não muda nada; resposta cita /não|lista de peças|não faz|não calculo|aproveitamento/i | O CSV é lista de peças, não plano de aproveitamento. O produto já avisa isso na interface. |
| `rec-03` | Liste as ferragens e as posições de furação das dobradiças. | ação answer ou clarify; não muda nada; resposta cita /não|fora|não faz|não inclui|furação/i | Ferragem e furação estão fora do escopo declarado; a IA não pode preencher com números plausíveis. |

### referencia · Referência a peça que mudou ou sumiu

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `ref-01` | Suba a prateleira 4 mais 5 cm. | ação clarify ou update; geometria conferida; resposta cita /não existe|qual|escolha|já não/i | Peça removida nunca é substituída em silêncio: o Ivo viu a IA mover a peça errada. |
| `ref-02` | Mova esta prateleira 5 cm para cima. | ação update; muda o projeto; geometria conferida | A seleção explícita tem precedência sobre qualquer referência anterior. |

### navegacao · Desfazer, refazer e voltar versão

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `nav-01` | Desfaça a última alteração. | ação undo; muda o projeto; geometria conferida | Desfazer sem ops. O caso precisa de duas revisões: no primeiro projeto a resposta certa é dizer que não há nada para desfazer, e o modelo fez exatamente isso. |
| `nav-02` | Volte uma versão e deixe a largura com 900 mm. | ação undo ou clarify; geometria conferida | Foi o P1 da primeira rodada: editar a partir de uma versão antiga descartava 9 versões em silêncio. Hoje a interface confirma o descarte, e o modelo deve preferir desfazer a truncar. |

### tipos · Tipos de móvel que o produto declara não suportar

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `tip-01` | Quero uma porta de correr neste armário. | ação answer ou clarify ou update; resposta cita /não|correr|disponível|suporta/i | Porta deslizante está fora do perfil: o produto avisa, não finge. |
| `tip-02` | Faça um tampo de mesa de 1,50 m para o escritório. | ação answer ou clarify; não muda nada; resposta cita /não|mesa|tampo|suporta/i | Tampos avulsos e mesas estão fora do escopo declarado. |

### sugestoes · Próximos passos propostos pela IA para o chip de sugestão

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `sug-01` | Adicione um nicho à direita da estante. | ação update ou answer ou clarify | O chip deixou de ser lista fixa: depois de mexer no nicho, o próximo passo tem de falar do nicho, não de conselho genérico. |
| `sug-02` | Qual é a altura total do projeto? | ação answer ou update ou clarify | Pergunta informativa também abre caminho para o próximo pedido sem sugerir algo fora do escopo. |
| `sug-03` | Quanto custa para fazer este armário? | ação answer ou clarify ou update | Cinco de seis personas pediram preço; a sugestão não pode abrir uma porta que o produto não atende. |

### foto · Foto de referência: estimar a escala e montar o layout, sem recusar

| caso | pedido | expectativa | o que já aprendemos |
|---|---|---|---|
| `foto-01` | Copia o layout dessa foto: é um armário de canto com nicho no meio. | ação update; muda o projeto; geometria conferida; resposta cita /(estimat|aproximad|régua|margem|erro|±|\+\/-)/i; resposta não traz /(não consigo medir|não posso medir|sem uma referência real|não é possível medir)/i | Antes o prompt mandava pedir as medidas que faltavam e o modelo recusava copiar layouts de foto. Medido com perguntas de controle, ele vê a imagem e acerta; o que faltava era o procedimento de escala e a ordem da montagem (um módulo por vez, medidas antes do próximo add, frentes por último). |
| `foto-02` | Copia o layout da foto, mas a minha parede tem 3600 mm. | ação update; muda o projeto; geometria conferida; resposta não traz /(não consigo medir|não posso medir|não é possível medir)/i | Duas medidas na mesma frase (layout da foto + parede real): a parede manda na escala e a foto nas proporções. |

Total: 45 casos em 14 grupos.
