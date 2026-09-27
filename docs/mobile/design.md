# Merce no celular e no tablet: auditoria e direção

Estado: auditoria e direção de design prontas. Implementação ainda não começou.
Branch: `feat/app-movel` (a partir de `dev`).

## Auditoria (o que existe hoje)

Abaixo de 960 px o estúdio empilha cena (64vh), conversa (78vh) e inspetor (78vh)
numa página que rola. No celular (375 × 812) a barra de ferramentas da cena cobre
o topo do 3D, as cotas se sobrepõem, a linha do tempo ocupa um quarto da cena e
a conversa só aparece rolando a página.

Capacidades do desktop que precisam de equivalente:

| Área | Recursos |
|---|---|
| Conversa | pedir, anexar ou colar foto, sugestões, cartão de progresso, Parar, Edição (ChangeSet) com Rever e toque na linha, dúvidas com opções, opções A/B (aplicar ou alternativa), tentar de novo, editar e copiar mensagem, limpar e restaurar conversa, modelo, custo, "Ao vivo" |
| Cena | orbitar, zoom, 4 vistas, enquadrar, cotas, ambiente, explodir, abrir frentes, girar, foto PNG, selecionar peça, arrastar móvel, MovePad, pôr/arrastar obstáculos e paredes, alças da parede, revisão das mudanças |
| Projeto | árvore de módulos, propriedades, compartimentos, frentes, conectar, biblioteca |
| Ambiente | parede, pé-direito, obstáculos, paredes |
| Orçamento, Corte, Peças | preços editáveis, "ver no móvel", chapas com foco na peça, lista agrupada |
| Versões | linha do tempo com prévia, lista, restaurar, criar alternativa, desfazer/refazer |
| Projetos | trocar, buscar, excluir, novo (galeria), renomear, exportar (6 formatos), tema, paleta de comandos |

Achados técnicos:

- `FurnitureView` já redimensiona por `ResizeObserver` e o OrbitControls já faz
  toque (um dedo gira, dois aproximam/deslocam). Uma instância só pode mudar de
  caixa (tela cheia ↔ janela flutuante) sem remontar.
- Pôr obstáculo/parede: no toque, o primeiro toque já grava no lugar tocado, sem
  prévia. Precisa de "toque move a prévia" + botão "Pôr aqui" (`state.confirmPlacing`).
- `@media (hover: none) .msg-user-actions { opacity: 1 }` vem antes da regra base
  com `opacity: 0` e perde: no toque os botões editar/copiar ficam invisíveis.
- Campos com fonte < 16 px fazem o iOS dar zoom ao focar.
- A meta viewport é só `width=device-width, initial-scale=1`: falta
  `viewport-fit=cover` (áreas seguras) e `interactive-widget=resizes-content`
  (teclado). O vinext aceita `export const viewport` (shims/metadata.js).

## Direção: "o móvel sempre à vista"

Uma cena só, vários espaços de trabalho em tela cheia. Na aba Cena o 3D ocupa
a tela; nos outros espaços ele vira uma **janela viva flutuante** (PiP) no canto,
que acompanha a IA montando, o editor mudando medidas e o corte acendendo peças.
Tocar na janela abre a cena; arrastar leva a janela a outro canto; ela pode ser
recolhida numa aba na borda.

### Navegação

- Celular em pé: barra inferior com 4 destinos. **Cena**, **Conversa**
  (indicador da IA trabalhando e contagem de novas), **Montar** (segmentado
  Móvel · Ambiente), **Números** (Orçamento · Corte · Peças).
- Celular deitado e tablet: o mesmo menu como trilho à esquerda.
- Barra superior: nome do projeto (abre a folha Projeto), medidas e total,
  desfazer e refazer, chip da versão.
- Espaços ficam montados depois da primeira visita: rolagem, formulários e
  rascunho não se perdem ao trocar.
- "Olhar no móvel" (linha da Edição, Rever, ver no móvel do orçamento, pôr
  obstáculo) leva à Cena com um chip de volta ("‹ Orçamento"). O botão voltar do
  sistema faz o mesmo e fecha folhas (pilha própria sobre `history.pushState`).

### Telas

- **Cena**: 3D sangrado sob a barra translúcida. Chips de estado (cabe/não cabe,
  versão antiga, IA trabalhando). Doca inferior: vistas, Enquadrar, bandeja de
  ferramentas (cotas, ambiente, explodir, frentes, girar, foto). Tocar numa peça
  abre o **cartão da seleção**: nome, medidas, material e Editar · Mover (mostra o
  MovePad) · Pedir à IA · Abrir frente. Revisão das mudanças como barra inferior
  com o texto do passo.
- **Viagem no tempo** (chip da versão): a cena em tela cheia com uma fita de
  versões deslizável; cada versão aparece ao vivo (`historyPreview`), com
  Voltar para esta versão, Criar alternativa e Cancelar.
- **Conversa**: mensagens em tela cheia, compositor fixo sobre o teclado (a barra
  inferior some com o teclado), sugestões numa linha rolável, campos de 16 px.
- **Montar** e **Números**: painéis existentes em largura cheia; no tablet,
  largura de leitura e grades mais ricas (chapas em 2 colunas).
- **Folha Projeto**: projeto atual (renomear), Novo, Biblioteca, Exportar (lista
  grande), tema, buscar ações, lista de projetos com busca e exclusão
  (extrair `ProjectList` de `ProjectPicker`).
- Galeria, paleta, confirmação de alternativa: folhas em tela cheia no celular,
  diálogos centrados no tablet.

### Implementação planejada

1. `data-shell="app"` decidido por `matchMedia`: `(max-width: 959px), (max-height: 499px), (pointer: coarse) and (hover: none) and (max-width: 1400px)`;
   script no `<head>` como o do tema, para o esqueleto não piscar.
2. Uma árvore JSX só em `app/page.tsx`: no modo app, classes e elementos extras
   (navegação, folhas, janela da cena); `.viewport` nunca muda de posição na
   árvore, então a cena não remonta. CSS novo em `app/app-shell.css`, tudo sob
   `.studio.app`: o desktop não muda.
3. `FurnitureView`: prop para esconder o MovePad fora do "Mover", prévia por
   toque com "Pôr aqui", cotas escondidas na janela flutuante.
4. `--vvh` pelo `visualViewport` para teclado no iOS; áreas seguras com `env()`.
5. Verificação por capturas: 375 × 667, 430 × 932, 768 × 1024, 1024 × 768,
   1180 × 820, celular deitado; vazio e cheio, prévia ativa, folhas, teclado; e o
   desktop em 1440 × 900 igual ao de antes.
