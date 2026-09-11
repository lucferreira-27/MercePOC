# Merce POC

Estúdio local de móveis modulares com painéis retos. Chat, editor, modelo 3D, histórico e exportações usam uma composição canônica, schema v3.

## Executar

Use `Start-Merce.cmd`, ou `npm install` e `npm run dev` em `G:\MercePOC`. Abra http://127.0.0.1:4310/. Para produção local: `npm run build` e `npm start`. Não execute dois servidores na mesma porta.

Configure `.env`, ignorado pelo Git:

```dotenv
AI_API_KEY=your-key-here
AI_BASE_URL=https://api.commandcode.ai/provider/v1
AI_MODEL=deepseek/deepseek-v4.1-flash
```

A chave fica somente no servidor. O DeepSeek V4.1 Flash via Command Code propõe operações JSON, validadas antes de salvar. Cada chamada envia `reasoning_effort: low`, o piso aceito pelo gateway: lá não existe valor para desligar o raciocínio. Cada chamada ao provedor tem uma janela de inatividade de 120 segundos, reiniciada a cada trecho recebido: uma resposta lenta mas viva termina, e uma conexão muda é encerrada. Formato inválido gera até duas novas tentativas. O teto de tokens é 16000; com 4000 um pedido de várias operações esgota o orçamento em raciocínio e volta truncado. Ajuste com `MERCE_AI_TIMEOUT_MS` e `MERCE_AI_MAX_TOKENS`. O modo rápido opcional usa `AI_FAST_*` e outro provedor. Não existe fallback automático para outro modelo. Erros de rede ou limite do provedor preservam o projeto e permitem reenviar. O cliente mostra progresso e a resposta completa ao terminar, sem expor raciocínio interno.

## Usar

1. Crie ou escolha um projeto no seletor superior. O seletor abre com busca por nome e um botão de exclusão por linha; excluir o projeto aberto passa para o vizinho.
2. Adicione Estante, Nicho, Rack ou Gaveteiro em Ajustes. Todos usam o mesmo motor editável.
3. Selecione módulo/compartimento na árvore ou peça no 3D. A seleção aparece no chat.
4. Ajuste medidas, posição, orientação, material e fundo nas propriedades. Conecte/alinha módulos, compartilhe uma face compatível ou separe antes de mover um filho livremente. Um painel compartilhado exige faces iguais e afastamento zero: editar altura, largura, profundidade, material ou rotação de um dos dois módulos é recusado com a diferença nomeada, e o caminho é "Separar módulos" primeiro.
5. Selecione compartimentos para dividir, mover/distribuir divisões ou configurar portas/gavetas. Abra e feche pelas ações do painel ou pelo chat. Abertura não cria revisão. As ferramentas de prateleira (inserir no vão, distribuir) valem para a estante única original; em projetos com módulos, use Dividir ↕ e Distribuir do compartimento.
6. Arraste a timeline para consultar/restaurar versões. Uma edição a partir do passado cria um novo caminho. Use Criar alternativa desta versão para preservar ambos.
7. Anexe ou cole uma imagem de referência no chat. JPG, PNG ou WebP, até 10 MB. Dimensões precisam ser informadas ou confirmadas.
8. Exporte CSV, Cortecloud, projeto completo ou impressão/PDF. O nome do projeto permanece editável em Ajustes.

Exemplos: “Divida este compartimento em duas colunas”; “Coloque três gavetas embaixo e duas portas em cima”; “Adicione outro módulo à direita compartilhando a lateral”; “Adicione um módulo perpendicular alinhado pelos fundos”; “Abra as portas deste módulo”.

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

`node --import tsx scripts/modular-ui.mjs` verifica um navegador real e grava screenshots/exportações em `outputs/modular`. Requer Playwright disponível. Opcionalmente defina `PLAYWRIGHT_MODULE` com o caminho absoluto de `playwright/index.mjs` e `BROWSER_EXECUTABLE` com um executável Chromium/Chrome/Brave.
