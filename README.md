# Merce

Estúdio local de móveis modulares com painéis retos. Chat, editor, modelo 3D, histórico, orçamento, plano de corte e exportações usam uma composição canônica, schema v3.

## O que há de novo na v2

A v1 levava da conversa ao 3D. A v2 leva da ideia ao móvel orçado e pronto para cortar, com a IA como copiloto e não como único caminho.

- **Visual novo, claro e escuro.** Tokens de cor em `app/globals.css`, paleta de ateliê, tema do sistema ou escolhido no botão da barra superior. Conversa e painel lateral recolhem (`[` e `]`) e a cena ocupa o espaço.
- **Cena 3D mais real.** Veio de madeira e laminado procedurais, luz de estúdio, sombra suave e chão que some nas bordas. Selecionar uma peça faz ela brilhar sem perder o acabamento.
- **Ambiente no 3D.** Parede, laterais, rodapé, porta, janela, tomada e coluna desenhados com a mesma conta do veredito de encaixe; obstáculo que cruza o móvel fica vermelho. O cabeçalho da cena diz se cabe.
- **Cotas de volta.** Largura, altura e profundidade gerais, largura de cada módulo e espaço livre até a parede e o teto.
- **Nove acabamentos.** Branco fosco, areia, carvalho natural, freijó, nogueira, verde sálvia, azul petróleo, grafite e preto fosco, escolhidos por amostra. A IA entende os nomes ("troque para nogueira").
- **Orçamento.** Chapas contadas pelo plano de corte, fita de borda, dobradiças pela altura da folha, corrediças, puxadores, mão de obra e margem. Tabela de preços editável, salva no navegador, e botão para copiar o orçamento. A IA responde "quanto custa" com os mesmos números.
- **Plano de corte.** Encaixe em guilhotina por material e espessura, com disco, refilo e veio travado no comprimento da chapa, desenhado chapa a chapa, com aproveitamento e CSV de posições.
- **Biblioteca de móveis.** 16 móveis prontos e paramétricos, por cômodo: rack de TV com pés palito, painel com rack suspenso, rack com torres, estante, aparador, guarda-roupa, cômoda, criado-mudo, cabeceira com criados suspensos, cozinha linear, balcão, armário aéreo, gabinete de banheiro, armário de escritório, sapateira e armário de lavanderia. Cada um é montado pelo motor com o mesmo contrato do chat e aceita largura, altura, profundidade, acabamentos e pés dentro do próprio intervalo. Abra em **Novo** (projeto novo, com ambiente de exemplo) ou pela **Biblioteca de móveis** no painel (encosta à esquerda ou à direita do que já existe). A IA também parte deles: "faz um rack de TV" vira o ativo `rack-tv` com a operação `asset.add`, e montar do zero continua possível.
- **Painel de parede e pés.** Módulo `panel` para painel de TV e cabeceira (uma chapa de até 2,70 × 1,80 m), pés que levantam a caixa (50 a 300 mm, desenhados no 3D, na prancha e na imagem que a IA confere) e módulo suspenso preso na parede, que o veredito de encaixe aceita sem apoio no piso.
- **Parede sempre.** Sem ambiente informado, a cena mostra uma parede de referência com pé-direito comum para dar escala. O ambiente ganhou TV na parede e a posição do móvel ao longo dela, e a câmera enquadra o móvel e o que está perto (porta, TV, tomada), não o quarto inteiro.
- **Mudanças como diff.** Cada resposta que mexe no projeto mostra um bloco compacto de **Edição**, como o diff de um editor: `+` entrou, `−` saiu, `~` mudou, com a contagem, a barrinha de proporção e as peças que entraram, saíram e mudaram. Passar o mouse numa linha acende as peças dela no 3D; clicar abre o detalhe. Ao terminar o turno, a cena **toca as operações uma a uma**, com a linha da vez acesa na conversa, e deixa o resultado com o diff à vista: verde entrou, âmbar mudou, fantasma vermelho saiu. **Rever** repete quando quiser; `Esc` fecha.
- **Paleta de comandos.** `Ctrl+K` busca qualquer ação; uma frase que não é comando vira pedido para a IA.
- **Conversa refeita.** Enquanto a IA trabalha, um cartão mostra o passo real (enviado, pensando, escrevendo, conferindo medidas, comparando com a foto, salvando), o relógio, os dados que chegam do provedor, os tokens e o custo subindo; o 3D mostra o mesmo passo. O botão **Parar** interrompe a resposta sem mexer no projeto e deixa o pedido pronto para repetir. Cada resposta traz no rodapé modelo, tempo, tokens, custo, copiar e a versão. As sugestões ficam em chips logo acima do campo, e a conversa vazia oferece três começos: modelo pronto, descrever ou copiar de uma foto.
- **Modelos e custo.** O seletor do compositor troca entre DeepSeek V4.1 Flash (padrão), **GPT-6 Luna com raciocínio baixo**, MiMo V2.6 Flash (o mais barato, mais lento) e Qwen 3.8 27B (rápido), com o preço de cada um à vista. O selo no topo da conversa soma o custo estimado da conversa, por modelo, e o total desta aba em todos os projetos. O gateway conta os tokens (entrada, cache, saída, raciocínio); o preço vem da tabela em `lib/models.ts` e pode ser ajustado no `.env` com `MERCE_PRICE_*`.
- **Foto e impressão.** Foto PNG da vista com cotas e legenda. Imprimir gera um documento com a foto da vista, orçamento, peças agrupadas e as chapas do plano de corte.

A v1 está na tag `v1`.

## Executar

Use `Start-Merce.cmd`, ou `npm install` e `npm run dev` em `G:\MercePOC`. Abra http://127.0.0.1:4310/. Para produção local: `npm run build` e `npm start`. Não execute dois servidores na mesma porta.

Para mostrar o estúdio para outras pessoas, um túnel rápido do Cloudflare serve: `cloudflared tunnel --url http://127.0.0.1:4310 --http-host-header 127.0.0.1:4310` publica um endereço `https://algo.trycloudflare.com` enquanto o processo estiver vivo. O `--http-host-header` não é enfeite: sem ele o servidor de desenvolvimento recebe `Host: algo.trycloudflare.com`, responde 403 "Blocked request. This host ... is not allowed" e nada chega ao app, nem leitura nem escrita. Com ele o app aceita escrita pelo domínio público porque a checagem de origem compara com o host do pedido (`x-forwarded-host`), não com o endereço interno. Atenção: o endereço é público, não tem senha, dá acesso de leitura e escrita a todos os projetos da base local e cada turno de conversa gasta créditos do provedor configurado no `.env`; compartilhe só com quem deve ver e encerre o túnel depois.

Importante: `npm run build` reescreve o pacote que o servidor em execução está servindo. Se o servidor já estava de pé, reinicie-o depois do build; sem isso a página trava em "Carregando seu estúdio..." porque o navegador recebe um pacote misturado e não chega a hidratar. Para uso no dia a dia, `npm run dev` (HMR na mesma porta) não tem esse problema.

Configure `.env`, ignorado pelo Git:

```dotenv
AI_API_KEY=your-key-here
AI_BASE_URL=https://api.commandcode.ai/provider/v1
AI_MODEL=deepseek/deepseek-v4.1-flash
```

A chave fica somente no servidor. O DeepSeek V4.1 Flash via Command Code propõe operações JSON, validadas antes de salvar. Cada chamada envia `reasoning_effort: low`, o piso aceito pelo gateway: lá não existe valor para desligar o raciocínio. Cada chamada ao provedor tem uma janela de inatividade de 120 segundos, reiniciada a cada trecho recebido: uma resposta lenta mas viva termina, e uma conexão muda é encerrada. Formato inválido ou lote recusado pela geometria gera até duas novas tentativas de correção, com o motivo devolvido ao modelo. O teto de tokens é 16000; com 4000 um pedido de várias operações esgota o orçamento em raciocínio e volta truncado. Ajuste com `MERCE_AI_TIMEOUT_MS` e `MERCE_AI_MAX_TOKENS`. O modo rápido opcional usa `AI_FAST_*` e outro provedor. Não existe fallback automático para outro modelo. Erros de rede ou limite do provedor preservam o projeto e permitem reenviar. O cliente mostra progresso e a resposta completa ao terminar, sem expor raciocínio interno. O botão "Ao vivo" na barra do compositor é uma opção de depuração: mostra o texto parcial da IA, os bytes recebidos e o fim do raciocínio do modelo enquanto chegam. Nada disso é salvo nem volta ao modelo, e nenhuma revisão é criada; a preferência fica salva no navegador.

## Usar

1. Crie um projeto em **Novo**: em branco ou a partir de um modelo. O seletor superior abre projetos existentes, com busca por nome e exclusão por linha; excluir o projeto aberto passa para o vizinho.
2. Adicione Estante, Nicho, Rack ou Gaveteiro na aba **Projeto**, ou um móvel inteiro pela **Biblioteca de móveis**. Todos usam o mesmo motor editável.
3. Selecione módulo/compartimento na árvore ou peça no 3D. A seleção aparece no chat e brilha na cena.
4. Ajuste medidas, posição, orientação, acabamento e fundo nas propriedades. Conecte/alinhe módulos, compartilhe uma face compatível ou separe antes de mover um filho livremente. Um painel compartilhado exige faces iguais e afastamento zero: editar altura, largura, profundidade, acabamento ou rotação de um dos dois módulos é recusado com a diferença nomeada, e o caminho é "Separar módulos" primeiro.
5. Selecione compartimentos para dividir, mover/distribuir divisões ou configurar portas/gavetas, com acabamento próprio na frente. Abra e feche pelas ações do painel, pelo chat ou todas de uma vez (botão da cena ou `O`). Abertura não cria revisão. As ferramentas de prateleira (inserir no vão, distribuir) valem para a estante única original; em projetos com módulos, use Dividir ↕ e Distribuir do compartimento.
6. Arraste a linha do tempo para consultar/restaurar versões. Orçamento e plano de corte acompanham a versão exibida. Uma edição a partir do passado cria um novo caminho. Use Criar alternativa desta versão, em **Versões**, para preservar ambos.
7. Informe o **Ambiente** (parede, pé-direito, profundidade, rodapé e obstáculos) para ver o quarto no 3D, as folgas nas cotas e o veredito de encaixe.
8. Anexe ou cole uma imagem de referência no chat (JPG, PNG ou WebP, até 10 MB) e peça para copiar o layout. A IA estima a escala por objetos de tamanho conhecido na foto (frente de gaveta ~200 mm, livro ~240 mm, pé-direito ~2600 mm), mantém as proporções do que vê, arredonda para 10 mm, respeita os limites do motor e monta a fileira inteira no mesmo turno, com os módulos ligados e as divisões antes das frentes. Ela diz no texto a régua que usou, o erro esperado (±10 a 20%), o que a foto mostra e o editor não tem (cabideiro, curva, inclinado, porta de correr, tampo avulso, canto com interior contínuo) e qual medida sua fecharia o desenho: a largura real da parede ou o pé-direito. Sem pedido de cópia, a imagem é só referência visual e as medidas do projeto continuam como estão.
   A IA também vê o próprio desenho: em pedido com foto ela recebe, junto da referência, o desenho do projeto atual (frontal e isométrica) e, depois de aplicar, confere o desenho do resultado contra a foto e responde "olhei o desenho: ficou parecido/em parte/diferente", com o que está errado e até 10 operações de correção já aplicadas. O desenho conferido aparece na conversa, então você vê exatamente o que ela viu. Num desenho de linhas não dá para julgar cor, textura nem ferragem, e a conferência não inventa isso.
9. Os chips abaixo da conversa são os próximos passos propostos pela IA para este projeto, com o contexto do último turno (a lista fixa só aparece quando ainda não há resposta dela). Clicar envia o pedido direto, sem passar pelo campo, e o que você digitou continua lá. Quando a IA precisa de uma decisão, o cartão mostra a pergunta, duas respostas sugeridas, as demais opções e um campo para responder do seu jeito; as opções são revalidadas antes de aplicar. Cada alteração aparece no bloco de **Edição** da resposta, uma linha por mudança com o sinal (`+`, `−`, `~`); clicar numa linha abre medidas, posição, frentes e acabamento, e um lote que repete a mesma mudança em vários vãos vira uma linha só, com uma barra proporcional por vão no detalhe. O texto da IA vem depois, como comentário.
10. Veja o custo em **Orçamento** e as chapas em **Corte**. Ajuste a tabela de preços uma vez; ela vale para todos os projetos deste navegador.
11. Em **Exportar**: foto da vista (PNG), imprimir/PDF, lista de peças (CSV), plano de corte (CSV), Cortecloud e projeto completo (JSON). O nome do projeto se edita clicando no título acima do 3D.

Exemplos: “Faz um rack de TV de 2 m em nogueira”; “Quero um painel de TV com rack suspenso”; “Coloque um criado-mudo à direita”; “Copie o layout desta foto”; “Divida este compartimento em duas colunas”; “Coloque três gavetas embaixo e duas portas em cima”; “Troque as frentes para nogueira”; “Adicione outro módulo à direita compartilhando a lateral”; “Quanto custa e quantas chapas usa?”; “Abra as portas deste módulo”.

### Atalhos

| Tecla | Ação |
|---|---|
| `Ctrl+K` | Paleta de comandos |
| `/` | Escrever para a IA |
| `1` `2` `3` `4` | Perspectiva, frontal, lateral, topo |
| `F` · `+` · `-` | Enquadrar, aproximar, afastar |
| `D` · `R` · `E` · `O` | Cotas, ambiente, explodir, abrir/fechar frentes |
| `[` · `]` | Recolher conversa, recolher painel |
| `Ctrl+Z` · `Ctrl+Y` | Desfazer, refazer |
| `Esc` | Limpar seleção, cancelar prévia do histórico, fechar a revisão das mudanças |

## Limites e dados

Até 12 módulos, 200 painéis físicos e 32 compartimentos finais por módulo. Medidas externas de cada módulo: largura 200–1200, altura 200–2400, profundidade 200–800 mm. Vãos mínimos de 100 mm. Rotação em passos de 90°. O L usa módulos retangulares separados.

Não inclui curvas, inclinados, recortes, canto com interior contínuo, portas de correr/basculantes, mesas, tampos avulsos, furação, ferragens comerciais ou certificação estrutural.

SQLite em `data/merce.sqlite`, ou `MERCE_DATA_DIR`. Bancos antigos recebem backup consistente em `merce-before-modules.sqlite`. Revisões v1/v2 são migradas deterministicamente na leitura e gravadas em v3 no próximo salvamento, preservando medidas, mensagens e vínculos.

CSV UTF-8 com BOM e `;`, uma linha por peça física. Painel compartilhado aparece uma vez, com dois proprietários. CSV/Cortecloud sempre usam a posição fechada. JSON completo inclui composição, conexões, perfil e histórico; a impressão mostra vista superior e uma tabela que agrupa peças idênticas numa linha com a quantidade e fecha com totais de itens, peças e área em m². O plano de corte é um encaixe em guilhotina honesto, não o ótimo matemático; a exportação não traz montagem nem furação. O orçamento é estimativa com preços de partida em reais (chapa 2750 × 1840 mm). Adaptador Cortecloud experimental, sem validação de importação em conta real. Reimportação de projeto JSON pela interface permanece fora da POC.

Consulte [regras e arquitetura](docs/MODULAR.md) e [resultados da validação](docs/MODULAR-VALIDATION.md).

## Verificar

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run test:live
```

`test:live` usa o GLM configurado e cria uma demonstração. Resultado: `work/modular-live.json`. Para retomar após um limite temporário: `$env:RESUME_MODULAR='1'; npm run test:live`.

`npm run bench` mede o par prompt + modelo + validação em 51 casos, soma o custo de cada caso e compara duas execuções (`--compare`); `--model deepseek|luna|mimo|qwen-fast` escolhe o modelo; o catálogo e o que já aprendemos ficam em [bench/README.md](bench/README.md).

`node work/qa/verify-chat-ui.mjs` verifica em navegador real as superfícies do chat (chips da IA, cartão de dúvida com campo livre e roteiro de etapas), incluindo dois turnos de verdade. `node work/qa/verify-change-cards.mjs` confere os cartões de mudança (título, medidas, fatos, desenho e o log técnico fechado) com um turno real e um projeto semeado. `node work/qa/verify-composer.mjs` mede o rodapé do compositor de 360 a 1280 px (controles e dica numa linha, sem anel duplo de foco). `node work/qa/verify-selection.mjs` confere o shift+clique (peça puxa o módulo inteiro e o pedido leva a seleção completa ao servidor). `node work/qa/verify-boot.mjs` abre o estúdio do zero (hidratação, cena 3D, painel de ajustes) e verifica também o caminho de falha: sem hidratar, o aviso de "recarregue a página" aparece sozinho. `node work/qa/verify-foto.mjs` anexa uma foto de verdade no compositor, pede a cópia do layout e confere o que a IA aplicou e o que ela viu no próprio desenho (veredito de semelhança, correções e a imagem do resultado na conversa): fileira de 4+ módulos com laterais compartilhadas, vão alto e aberto, coluna de vãos, gavetas, a régua e o erro declarados no texto e os cartões na tela (usa WebGL por software para a cena 3D aparecer). Requerem o app rodando em `127.0.0.1:4310`.

`node --import tsx scripts/modular-ui.mjs` verifica um navegador real e grava screenshots/exportações em `outputs/modular`. Requer Playwright disponível. Opcionalmente defina `PLAYWRIGHT_MODULE` com o caminho absoluto de `playwright/index.mjs` e `BROWSER_EXECUTABLE` com um executável Chromium/Chrome/Brave.
