# Merce POC

Estúdio local para criar e editar uma estante aberta por conversa, com modelo 3D, parâmetros, peças e histórico sincronizados.

## Abrir

No Windows, execute `Start-Merce.cmd`. A aplicação abre em http://127.0.0.1:4310/.

Alternativamente, com Node.js 24:

```powershell
cd G:\MercePOC
npm install
npm run build
npm start
```

Para desenvolvimento: `npm run dev`. Não rode desenvolvimento e produção simultaneamente na porta 4310.

## Configuração da IA

A chave fornecida está somente no `.env`, ignorado pelo Git. Não use prefixos `VITE_` ou `NEXT_PUBLIC_` para segredos.

```dotenv
MERGE_GATEWAY_API_KEY=your-key-here
MERGE_GATEWAY_BASE_URL=https://api-gateway.merge.dev/v1
MERGE_GATEWAY_MODEL=zai/glm-5.3-flash
```

As chamadas saem exclusivamente do servidor para Merge Gateway. O modelo transmite uma decisão JSON como texto, com validação Zod da operação e dos parâmetros. Se receber uma resposta malformada, há até duas novas tentativas de formatação, sempre com o mesmo modelo. Nenhuma resposta inválida é aplicada. Não há fallback para outro modelo nem respostas simuladas. Timeout de cada chamada: 60 segundos. Erros de rede preservam o estado e deixam o texto disponível para reenviar.

A rota de JSON garantido de GLM estava indisponível no gateway durante a implementação. Por isso o contrato usa JSON validado localmente em vez de depender de `response_format`. A rota de execução fica sob o roteamento do Merge Gateway.

## Usar

1. Abra a estante inicial ou crie um projeto em Novo.
2. Peça, por exemplo, “Aumente a largura para um metro”, “Deixe branca” ou “Vão inferior livre de 45 cm”.
3. Arraste o 3D para orbitar, use a roda para zoom, selecione uma peça por clique ou na aba Peças.
4. Ajuste campos em milímetros e clique em Aplicar medidas. Materiais são aplicados imediatamente.
5. Use o botão de imagem para anexar uma foto de referência (JPG, PNG ou WebP até 10 MB). Também é possível colar uma imagem no campo de mensagem. A imagem é normalizada para WebP, aparece no histórico e é enviada ao GLM como referência visual. Ela não substitui as medidas exatas do projeto.
6. Arraste o slider Histórico na base do modelo, ou clique em uma versão no painel Histórico, para pré-visualizar e restaurar uma revisão. Soltar o slider salva apenas a posição do cursor; uma nova edição depois de voltar cria um novo caminho e remove o trecho futuro.
7. Desfaça/refaça pela barra do modelo ou pelo chat.
8. Exporte no menu superior. O projeto e suas revisões são salvos automaticamente no SQLite local. Escolha projetos salvos no seletor superior. O nome pode ser alterado no painel de ajustes.

## Saídas

- CSV UTF-8 com BOM e separador `;`: peças individuais, quantidade, dimensões, material e quatro bordas.
- JSON Cortecloud experimental: adaptador para a estrutura pública de importação de peças, sem usinagem. A vinculação de materiais ocorre no Cortecloud. **Ainda não validado numa conta real.** Conferir C/L, C1/C2/L1/L2, material e convenção de desconto da fita antes de produzir.
- JSON do projeto: snapshot com parâmetros, peças e revisões para inspeção/backup. Nesta versão a reabertura é feita pelo SQLite; importação de backup pela interface ainda não está implementada.
- Impressão/PDF: vista frontal esquemática com dimensões gerais e tabela de peças. Use o diálogo de impressão do navegador. Não é um desenho de montagem completo.

## Modelo construtivo e limites

Template `open_bookcase_v1`, medidas externas L × A × P, todas em mm. Chapa de 18 mm, fundo sobreposto de 6 mm, laterais inteiras, tampo/base entre laterais. Corpo tem profundidade externa menos fundo. Prateleiras têm folga lateral total de 2 mm e recuo traseiro de 10 mm.

Desde o schema v2 cada prateleira interna tem id estável (`sh-N`) e elevação própria (piso até a face inferior). A quantidade deriva da coleção; o rótulo “Prateleira 1, 2…” é a ordem vertical e muda após mover/adicionar/remover. Vãos livres são calculados das faces das peças, com espessuras descontadas. Modelo 3D, cotas, lista de peças, CSV e Cortecloud derivam da mesma representação; o chat e o Three.js não guardam posições paralelas.

Revisões antigas (schema v1) são convertidas de forma determinística e idempotente na leitura: a geometria é gerada com as regras antigas e cada `shelf-N` vira `sh-N` na mesma elevação. Destaques antigos `shelf-N` continuam resolvendo para `sh-N`.

- Largura 300..1200, altura 400..2400, profundidade 200..600.
- 0..8 prateleiras internas. Cada vão livre precisa de pelo menos 100 mm.
- Operações de prateleira (chat e painel Peças usam a mesma camada `lib/design.ts`): mover com deslocamento preservando distâncias; definir vão abaixo; distribuir igualmente; inserir no centro de um vão; remover internas; redimensionar (na altura, os vãos mantêm a proporção do espaço livre total, descontadas as espessuras).
- Toda operação é atômica e validada (sem interpenetração, ordem ou saída do corpo; base/tampo/laterais/fundo nunca se movem). Pedidos inválidos explicam o impedimento com medidas; operações sem efeito não criam revisão.
- A IA propõe operações estruturadas (`move/gap/distribute/add/remove/resize`); nunca envia coordenadas de mesh, peças de corte ou CSV. O servidor resolve a geometria e valida.
- Cada mensagem do chat registra a revisão vigente (`vN` no relatório). Alternativas (“Criar alternativa desta versão”) copiam o histórico até a revisão exibida — inclusive prévia — com id próprio, nome editável e vínculo de origem; só mensagens vinculadas até ela são copiadas, e o original é preservado.
- O overlay “Cotas” mostra as alturas livres dos vãos (mm), destacando os dois vãos adjacentes à prateleira selecionada. É derivado da revisão exibida, sem medidas interpoladas durante animações.
- A exportação Cortecloud continua sendo lista de peças: não comunica posições de montagem nem furação. Mudar só a altura de uma prateleira não altera suas dimensões de corte. O JSON do projeto identifica `schemaVersion: 2`.
- Três acabamentos de MDF: branco, carvalho e grafite. A visualização usa cores, sem textura fotográfica.

- `lib/furniture.ts`: materiais, peças canônicas e regras legadas v1 (migração).
- `lib/design.ts`: schema v2, migração, operações de prateleira e exportadores.
- `lib/gateway.ts`: integração Merge Gateway e contrato de operações.
- `lib/store.ts`: SQLite, revisões, vínculo mensagem↔revisão, alternativa e concorrência otimista.
- `app/api/projects/route.ts`: leitura, criação, ops (`op`), alternativa (`fork`), nome e desfazer/refazer.
- `app/api/images/route.ts` e `lib/images.ts`: normalização, armazenamento local e entrega das referências visuais.
- `app/api/chat/route.ts`: interpretação e aplicação atômica de operações.
- `components/furniture-view.tsx`: Three.js, câmera, seleção, vista explodida e overlay de cotas.
- `app/page.tsx`: interface React (painel de prateleiras, cotas, histórico e alternativas).
- `hooks/use-project-tools.ts`: ferramentas WebMCP opcionais, se o navegador suportar. Não verificadas em um contexto WebMCP compatível.

Stack: React 19, TypeScript, Vinext/Vite, Three.js, Zod, SQLite nativo do Node. Adaptado do scaffold Sites para execução Node local, sem publicação ou infraestrutura Cloudflare. A chave e os dados ficam fora do bundle público. O servidor escuta somente em loopback. Esta POC não tem autenticação multiusuário e não deve ser exposta publicamente como está.

## Dados e backup

Projetos em `data/merce.sqlite`, com WAL. Antes de qualquer migração persistente, faça backup consistente: pare o servidor antes de copiar, ou use `VACUUM INTO`/`sqlite3 .backup` com o servidor parado. Não apague nem recrie o banco. A conversão v1→v2 é preguiçosa e em memória; o banco só passa a conter v2 quando o projeto é salvo novamente. Não apague o diretório `data` para atualizar o código. `MERCE_DATA_DIR` permite selecionar outro diretório no servidor. Os testes unitários usam um diretório temporário isolado.

## Verificar

```powershell
npm test
npm run typecheck
npm run lint
npm run build
# Com a aplicação rodando, faz chamadas reais e consome a API:
npm run test:live
```

Os testes verificam dimensões de referência, ausência de interpenetração, consistência 3D/exportação, validação, persistência, conflitos e histórico. O smoke test exercita 20 mensagens reais e salva o resultado em `work/live-smoke.json`; ele cria um projeto de teste. Para continuar após uma indisponibilidade de rede, execute `$env:RESUME_SMOKE='1'; npm run test:live` e depois remova essa variável antes de iniciar outra sequência.

Lint cobre código da aplicação, sem alterar componentes gerados não utilizados. Há uma supressão pontual do analisador React Compiler por erro interno na análise de callbacks Base UI; React Compiler não é usado no build. Não foi executada uma sessão de QA visual automatizada em navegador.

## Referências

- Merge Gateway: https://docs.merge.dev/merge-gateway/api-overview
- Tool calling: https://docs.merge.dev/merge-gateway/capabilities/tool-calling
- Cortecloud JSON: https://cortecloud.com/api-docs/guias/json_import/
- Vídeo de referência: https://www.youtube.com/watch?v=igROP_nUUQ0

## Resultado da validação nesta entrega

- Build de produção, TypeScript e lint da aplicação passaram.
- 9 testes automatizados passaram, incluindo varredura de combinações dimensionais.
- 20 cenários com GLM 5.3 Flash real passaram. A sequência foi retomada após um timeout do gateway, preservando o projeto.
- Releitura do SQLite, rejeição de versão desatualizada, origem externa e parâmetros inválidos passaram.
- Varredura do bundle público não encontrou a chave de API.
- Importação numa conta Cortecloud e QA visual automatizado continuam não verificados.

## Acompanhamento do chat

Por padrão, a interface não exibe texto parcial nem o resumo da abordagem durante a espera. Mostra a etapa atual, tempo decorrido e uma animação discreta de atividade, sem inventar uma porcentagem. O botão “Ver etapas” expande o histórico de processamento. A resposta aparece inteira quando a validação e o salvamento terminam; o resumo da abordagem e as diferenças ficam recolhidos nos detalhes da mensagem.

A interface envia `X-Chat-Preview: hidden`, e o servidor suprime os eventos de texto parcial. O SSE permanece para progresso e conclusão. Outros clientes podem receber texto omitindo esse cabeçalho. Erros de conexão não são tratados como sucesso, e o bloqueio de pedidos simultâneos permanece até a conclusão ou cancelamento.

## Transições do modelo 3D

A cena Three.js permanece montada entre edições. Cada peça mantém sua identidade e interpola tamanho, posição e cor durante 750 ms com aceleração/desaceleração suaves. Novas prateleiras entram gradualmente, as removidas desaparecem, e a vista explodida também anima. Edições durante uma transição partem da posição visual corrente. As medidas do projeto e os arquivos de exportação continuam exatos; a interpolação é apenas visual.

A câmera preserva a orientação durante mudanças de material e seleção e ajusta o enquadramento suavemente quando as dimensões mudam. Uma interação manual interrompe a animação da câmera. `prefers-reduced-motion` desativa os movimentos da cena e as animações decorativas.

`lib/furniture-motion.ts` concentra as transições. Os testes verificam reutilização de objetos, estados intermediários, valores finais, edições interrompidas, entrada/saída de peças, liberação de recursos e movimento reduzido. A suíte agora tem 20 testes. Não foi feita QA visual automatizada em navegador.
