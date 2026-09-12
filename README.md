# Merce POC

Estúdio local de móveis modulares com painéis retos. Chat, editor, modelo 3D, histórico e exportações usam uma composição canônica, schema v3.

## Executar

Use `Start-Merce.cmd`, ou `npm install` e `npm run dev` em `G:\MercePOC`. Abra http://127.0.0.1:4310/. Para produção local: `npm run build` e `npm start`. Não execute dois servidores na mesma porta.

Importante: `npm run build` reescreve o pacote que o servidor em execução está servindo. Se o servidor já estava de pé, reinicie-o depois do build; sem isso a página trava em "Carregando seu estúdio..." porque o navegador recebe um pacote misturado e não chega a hidratar. Para uso no dia a dia, `npm run dev` (HMR na mesma porta) não tem esse problema.

Configure `.env`, ignorado pelo Git:

```dotenv
AI_API_KEY=your-key-here
AI_BASE_URL=https://api.commandcode.ai/provider/v1
AI_MODEL=deepseek/deepseek-v4.1-flash
```

A chave fica somente no servidor. O DeepSeek V4.1 Flash via Command Code propõe operações JSON, validadas antes de salvar. Cada chamada envia `reasoning_effort: low`, o piso aceito pelo gateway: lá não existe valor para desligar o raciocínio. Cada chamada ao provedor tem uma janela de inatividade de 120 segundos, reiniciada a cada trecho recebido: uma resposta lenta mas viva termina, e uma conexão muda é encerrada. Formato inválido ou lote recusado pela geometria gera até duas novas tentativas de correção, com o motivo devolvido ao modelo. O teto de tokens é 16000; com 4000 um pedido de várias operações esgota o orçamento em raciocínio e volta truncado. Ajuste com `MERCE_AI_TIMEOUT_MS` e `MERCE_AI_MAX_TOKENS`. O modo rápido opcional usa `AI_FAST_*` e outro provedor. Não existe fallback automático para outro modelo. Erros de rede ou limite do provedor preservam o projeto e permitem reenviar. O cliente mostra progresso e a resposta completa ao terminar, sem expor raciocínio interno. O botão "Ao vivo" na barra do compositor é uma opção de depuração: mostra o texto parcial da IA, os bytes recebidos e o fim do raciocínio do modelo enquanto chegam. Nada disso é salvo nem volta ao modelo, e nenhuma revisão é criada; a preferência fica salva no navegador.

## Usar

1. Crie ou escolha um projeto no seletor superior. O seletor abre com busca por nome e um botão de exclusão por linha; excluir o projeto aberto passa para o vizinho.
2. Adicione Estante, Nicho, Rack ou Gaveteiro em Ajustes. Todos usam o mesmo motor editável.
3. Selecione módulo/compartimento na árvore ou peça no 3D. A seleção aparece no chat.
4. Ajuste medidas, posição, orientação, material e fundo nas propriedades. Conecte/alinha módulos, compartilhe uma face compatível ou separe antes de mover um filho livremente. Um painel compartilhado exige faces iguais e afastamento zero: editar altura, largura, profundidade, material ou rotação de um dos dois módulos é recusado com a diferença nomeada, e o caminho é "Separar módulos" primeiro.
5. Selecione compartimentos para dividir, mover/distribuir divisões ou configurar portas/gavetas. Abra e feche pelas ações do painel ou pelo chat. Abertura não cria revisão. As ferramentas de prateleira (inserir no vão, distribuir) valem para a estante única original; em projetos com módulos, use Dividir ↕ e Distribuir do compartimento.
6. Arraste a timeline para consultar/restaurar versões. Uma edição a partir do passado cria um novo caminho. Use Criar alternativa desta versão para preservar ambos.
7. Anexe ou cole uma imagem de referência no chat (JPG, PNG ou WebP, até 10 MB) e peça para copiar o layout. A IA estima a escala por objetos de tamanho conhecido na foto (frente de gaveta ~200 mm, livro ~240 mm, pé-direito ~2600 mm), mantém as proporções do que vê, arredonda para 10 mm, respeita os limites do motor e monta a fileira inteira no mesmo turno, com os módulos ligados e as divisões antes das frentes. Ela diz no texto a régua que usou, o erro esperado (±10 a 20%), o que a foto mostra e o editor não tem (cabideiro, curva, inclinado, porta de correr, tampo avulso, canto com interior contínuo) e qual medida sua fecharia o desenho: a largura real da parede ou o pé-direito. Sem pedido de cópia, a imagem é só referência visual e as medidas do projeto continuam como estão.
   A IA também vê o próprio desenho: em pedido com foto ela recebe, junto da referência, o desenho do projeto atual (frontal e isométrica) e, depois de aplicar, confere o desenho do resultado contra a foto e responde "olhei o desenho: ficou parecido/em parte/diferente", com o que está errado e até 10 operações de correção já aplicadas. O desenho conferido aparece na conversa, então você vê exatamente o que ela viu. Num desenho de linhas não dá para julgar cor, textura nem ferragem, e a conferência não inventa isso.
8. Os chips abaixo da conversa são os próximos passos propostos pela IA para este projeto, com o contexto do último turno (a lista fixa só aparece na primeira mensagem, quando ainda não há resposta dela). Clicar envia o pedido direto, sem passar pelo campo, e o que você digitou continua lá. Quando a IA precisa de uma decisão, o cartão mostra a pergunta, duas respostas sugeridas, as demais opções e um campo para responder do seu jeito; as opções são revalidadas antes de aplicar. Cada alteração aparece como um cartão: o que foi feito ("Nicho adicionado"), um resumo, o desenho do módulo com as medidas reais, largura/altura/profundidade, posição, alinhamento, frentes e acabamento. Quando o lote repete a mesma mudança em vários alvos, o cartão agrupa e mostra uma linha por vão, com barra proporcional: três divisões com restos diferentes (1296, 828 e 360 mm) ficam visivelmente diferentes. O texto da IA vem depois, como comentário, e o roteiro técnico não aparece na interface.
9. Exporte CSV, Cortecloud, projeto completo ou impressão/PDF. O nome do projeto permanece editável em Ajustes.

Exemplos: “Copie o layout desta foto”; “Divida este compartimento em duas colunas”; “Coloque três gavetas embaixo e duas portas em cima”; “Adicione outro módulo à direita compartilhando a lateral”; “Adicione um módulo perpendicular alinhado pelos fundos”; “Abra as portas deste módulo”.

## Limites e dados

Até 12 módulos, 200 painéis físicos e 32 compartimentos finais por módulo. Medidas externas de cada módulo: largura 200–1200, altura 200–2400, profundidade 200–800 mm. Vãos mínimos de 100 mm. Rotação em passos de 90°. O L usa módulos retangulares separados.

Não inclui curvas, inclinados, recortes, canto com interior contínuo, portas de correr/basculantes, mesas, tampos avulsos, furação, ferragens comerciais ou certificação estrutural. O botão de cotas não foi reintroduzido.

SQLite em `data/merce.sqlite`, ou `MERCE_DATA_DIR`. Bancos antigos recebem backup consistente em `merce-before-modules.sqlite`. Revisões v1/v2 são migradas deterministicamente na leitura e gravadas em v3 no próximo salvamento, preservando medidas, mensagens e vínculos.

CSV UTF-8 com BOM e `;`, uma linha por peça física. Painel compartilhado aparece uma vez, com dois proprietários. CSV/Cortecloud sempre usam a posição fechada. JSON completo inclui composição, conexões, perfil e histórico; a impressão mostra vista superior e uma tabela que agrupa peças idênticas numa linha com a quantidade e fecha com totais de itens, peças e área em m². Não há otimização de chapas, montagem ou ferragens na exportação. Adaptador Cortecloud experimental, sem validação de importação em conta real. Reimportação de projeto JSON pela interface permanece fora da POC.

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

`npm run bench` mede o par prompt + modelo + validação em 42 casos e compara duas execuções (`--compare`); o catálogo e o que já aprendemos ficam em [bench/README.md](bench/README.md).

`node work/qa/verify-chat-ui.mjs` verifica em navegador real as superfícies do chat (chips da IA, cartão de dúvida com campo livre e roteiro de etapas), incluindo dois turnos de verdade. `node work/qa/verify-change-cards.mjs` confere os cartões de mudança (título, medidas, fatos, desenho e o log técnico fechado) com um turno real e um projeto semeado. `node work/qa/verify-composer.mjs` mede o rodapé do compositor de 360 a 1280 px (controles e dica numa linha, sem anel duplo de foco). `node work/qa/verify-selection.mjs` confere o shift+clique (peça puxa o módulo inteiro e o pedido leva a seleção completa ao servidor). `node work/qa/verify-foto.mjs` anexa uma foto de verdade no compositor, pede a cópia do layout e confere o que a IA aplicou e o que ela viu no próprio desenho (veredito de semelhança, correções e a imagem do resultado na conversa): fileira de 4+ módulos com laterais compartilhadas, vão alto e aberto, coluna de vãos, gavetas, a régua e o erro declarados no texto e os cartões na tela (usa WebGL por software para a cena 3D aparecer). Requerem o app rodando em `127.0.0.1:4310`.

`node --import tsx scripts/modular-ui.mjs` verifica um navegador real e grava screenshots/exportações em `outputs/modular`. Requer Playwright disponível. Opcionalmente defina `PLAYWRIGHT_MODULE` com o caminho absoluto de `playwright/index.mjs` e `BROWSER_EXECUTABLE` com um executável Chromium/Chrome/Brave.
