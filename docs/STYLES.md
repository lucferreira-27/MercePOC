# Estilos, peças e materiais: como acrescentar

Este guia é para quem vai somar um estilo novo, uma peça nova (pé ou base, puxador, frente) ou um material novo ao Merce. O plano que criou tudo isso está em `docs/plans/styles-plan.md`.

## Como funciona

- **O módulo guarda o acabamento, explícito.** Cada módulo tem `look` (`lib/look.ts`): base (`legs`, `legMaterialId`), puxador (`handle`, `handleMaterialId`), frente (`front`, `insertMaterialId`), tampo sobreposto (`top`), moldura no topo (`cornice`), contorno de aço (`frame`), fundo de outra cor (`backMaterialId`) e LED (`led`). O gerador (`lib/composition.ts`) e as ferragens (`lib/fittings.ts`) leem só isso.
- **O estilo é uma receita que escreve o `look`.** `applyStyle` (`lib/styles.ts`) grava base, puxador, frente, tampo, detalhes e cores em cada módulo e guarda o envelope: a caixa cede a altura que o pé, o tampo ou a moldura ganham. O projeto guarda só o nome do estilo (`Composition.style`), como rótulo. Por isso mudar a definição de um estilo não muda nenhum projeto salvo, o histórico nem o orçamento dele.
- **Peça de corte é diferente de ferragem.** O que a marcenaria corta (chapa, maciço, pedra, vidro, palhinha, tampo, avental, moldura) sai de `generateComposition().parts` e entra na lista de corte e na conferência de colisão. O que vem pronto ou é soldado (pé, estrutura de aço, cavalete, rodízio, puxador, LED, gancho) sai de `fittingsOf(d)`, com forma, lugar e quantidade para o orçamento, e nunca entra no plano de corte.
- **Uma regra para cada coisa.** Base, puxador, frente e tampo são os mesmos para rack, guarda-roupa, cozinha ou mesa. Receita (`lib/assets.ts`) não desenha pé nem puxador: monta a estrutura e o estilo veste.

## Acrescentar um estilo

1. **Id.** Some o id em `STYLE_IDS` (`lib/look.ts`). O esquema do projeto, a operação `style.apply`, o `asset.add`, a galeria e o painel leem dali.
2. **Definição.** Some a entrada em `STYLES` (`lib/styles.ts`), copiando a forma de uma que já existe:
   - `name` (como aparece no chip), `label` (como entra numa frase: "no estilo anos 60") e `summary` (uma linha, vai para a galeria, o cartão de mudança e a boas-vindas).
   - `keywords`: as palavras que a pessoa usa, em português, com as formas no feminino ("rústico", "rústica"). Não repita palavra de outro estilo: `styleFrom` pega o primeiro que bater.
   - `palette`: `body` e `front` (chapas), `panel` (painel de parede), `ledge` (prateleira de parede) e `accent` (a cor da amostra no chip).
   - `base`: o que vale para todo papel (frente, puxador e acabamento dele, contorno de aço…).
   - `roles`: o que muda por papel do módulo. `low` (rack, aparador, cômoda, criado-mudo), `counter` (base de cozinha: fundo de 52 cm ou mais na altura de bancada), `tall` (estante, guarda-roupa), `wall` (aéreo, suspenso) e `table` (mesa e estrutura aberta). Cada papel diz a base (`legs` com tipo, altura e acabamento), o tampo (`top`), a moldura (`cornice`), o fundo de outra cor (`back`) e o LED.
   - `panel.front`: lisa ou ripada, para o painel de parede.
   - Opcionais: `proportions` (fator na altura e na largura padrão dos móveis novos, como o anos 60 baixo e comprido) e `airy` (estante sem portas).
3. **Receita que muda a estrutura** (só quando o estilo pede). A receita recebe `p.style` e pode trocar a frente: o guarda-roupa minimalista é de correr com basculante no maleiro, o aparador anos 60 é de correr. Móvel que não combina com todo estilo declara `styles` no ativo; a galeria só mostra o móvel nos estilos que ele aceita.
4. **Testes.** `tests/styles.test.ts` monta todo ativo em todo estilo nas medidas do intervalo, confere que reestilizar guarda o envelope e que os estilos diferem em pelo menos dois traços (base, puxador, frente, corpo, frente das gavetas). Some as palavras do estilo novo ao teste "palavras da pessoa levam ao estilo".
5. **Conferir na tela.** Com o servidor isolado (`.claude/launch.json`, configuração "estilos", porta 4316), `work/estilos/seed-styles.mjs` cria um projeto por móvel e estilo pela API, `matrix.mjs` fotografa, `crop.mjs` e `grid.mjs` montam a grade com o nome de cada estilo. Olhe cada imagem antes de abrir o PR (`AGENTS.md`).
6. **A IA aprende sozinha.** O prompt (`lib/agent/prompt.ts`) monta a lista de estilos de `styleCatalogForPrompt()`, com o id, o nome e as quatro primeiras palavras de cada um. Para conferir a escolha, some casos ao grupo `estilos` do bench (`bench/style-cases.mjs`) e rode `npm run bench -- --agent --group estilos`.

## Acrescentar uma peça

### Pé ou base

1. `LEG_TYPES` e `LEGS` (`lib/look.ts`): nome, faixa de altura quando vai em caixa (`box`), se serve de base de mesa (`table`), categorias de material que aceita e o acabamento padrão.
2. Lugar: `LEG_LAYOUT` (`lib/fittings.ts`) com o recuo e a seção do pé nas caixas; numa mesa, `tableBase` e `LEG_SECTION` (`lib/tables.ts`).
3. Forma na cena: um `case` em `fittingShape` (`lib/scene-fittings.ts`). No desenho (`render_look`, PDF, miniaturas), `drawnBoxes` (`lib/fittings.ts`) divide a ferragem nas caixas que ela tem de verdade; um pé reto não precisa de nada.
4. Preço: `HARDWARE` (`lib/quote.ts`) com a chave `leg-<tipo>`, por unidade. Estrutura soldada (tipo `stand`) é cobrada por metro de tubo, com a serralheria.
5. O editor (`components/look-editor.tsx`) lista as bases sozinho; confira a frase de recusa em `lookIssues` ou `tableIssues`.

### Puxador

1. `HANDLE_TYPES` e `HANDLES` (`lib/look.ts`): nome e categorias de material.
2. Onde fica e o tamanho: `handlePlacement` e `handleSize` (`lib/fittings.ts`). A mesma conta serve à cena, ao desenho e ao orçamento.
3. Forma: `handleShape` (`lib/scene-fittings.ts`). Usinado (cava, recorte) conta como usinagem da frente no orçamento.
4. Preço: `HARDWARE` com a chave `handle-<tipo>`.

### Estilo de frente

1. `FRONT_STYLES` e `FRONTS` (`lib/look.ts`): nome e, nas frentes de quadro, as categorias do miolo (`inserts`), o miolo padrão e o nome dele. `panelOnly` deixa a frente só para o painel de parede.
2. Superfície: `frontFace` (`lib/composition.ts`) decide a `Face` da peça; a geometria na medida real fica em `faceGeometry` (`lib/scene-faces.ts`) e o desenho em `faceOverlays` (`lib/fittings.ts`).
3. Frente de quadro gera o miolo como peça de corte (`insertOf`), que abre junto com a porta.
4. Preço: a usinagem por frente já cobre moldura, ripado e quadro.

## Acrescentar um material

1. `materials` (`lib/furniture.ts`): id, nome, cor, espessura, `finish` (como a superfície aparece) e `category`: `sheet` (chapa, pelo plano de corte), `solid` (maciço, por m³), `metal` (por m² de chapa ou metro de tubo), `glass`, `stone` e `fiber` (por m²). O preço vem no campo `price`, na unidade da categoria (`CATEGORY_INFO`).
2. Onde ele pode ir sai da categoria: corpo e frente são de chapa, pé e tampo aceitam as categorias de cada tipo, o miolo da frente de quadro as do estilo de frente. A validação diz o motivo da recusa em frase.
3. Superfície especial (pedra com veio, palhinha, tela, vidro canelado): `surfaceKind` e as texturas em `lib/scene-materials.ts`. Metal só vira tela no miolo; tampo e quadro de aço são chapa cheia.
4. Sobra de corte por categoria: `WASTE` (`lib/quote.ts`).
5. A IA vê o material novo sozinha: `materialsForPrompt()` monta a linha por categoria.

## O que sempre conferir

- `npm test`, `npm run lint` e `npx tsc --noEmit`.
- `tests/migration-v4.test.ts`: projeto antigo abre igual. Se ele falhar, a mudança mexeu no desenho de projeto salvo; isso só pode ser de propósito.
- Capturas do app rodando nos dois temas antes do commit e no PR (`AGENTS.md`).
