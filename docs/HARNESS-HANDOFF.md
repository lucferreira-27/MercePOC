# Harness do assistente: onde parou

Plano aprovado: `C:\Users\lucfe\.claude\plans\let-make-the-artetura-glowing-marshmallow.md`.

- **Branch:** `claude/harness-agente`, a partir de `main` depois do PR #7.
- **Estado:** as fases do plano estão feitas. O assistente em laço é o padrão. `.claude/launch.json` é só para o servidor de dev e não vai para o repositório.

## Como ligar e desligar
- **Padrão:** o assistente em laço. Ctrl+K → "Usar o assistente antigo (uma resposta só)" grava `localStorage merce-agent=0`; `MERCE_AGENT=0` no servidor desliga para quem não mandar `agent`.
- **Pela API:** `agent: true | false` na requisição.
- **Jev:** liga com `TYPESAFE_API_KEY` no ambiente; `MERCE_JEV=0` desliga. Sem Jev, o roteador cai sempre no laço e a conferência é só de código.

## O que existe
- **Laço com ferramentas nativas** (`lib/agent/`): `model.ts` (chamada em fluxo), `loop.ts`, `context.ts` (rascunho, uma versão por pedido), `tools.ts` (30 ferramentas), `prompt.ts`, `snapshot.ts`, `turn.ts` (`runAgentTurn`).
  - Operação chamada como ferramenta vira `design_apply`; no limite de etapas, uma última chamada só com `finish`; o plano dá bônus de etapas.
  - Queda passageira do provedor ("conexão interrompida", 429, 5xx): a etapa tenta de novo uma vez.
- **Roteador Jev** (`router.ts`, `thresholds.ts`, `jev.ts`): caminho direto sem LLM, pergunta de eixo (cita largura, altura e profundidade), orçamento de etapas por intenção.
  - Portas de saída atômicas `g_*`, mais `g_criar` com limiar próprio (`ROUTE.createMin`): "faça uma cozinha ... e mande o PDF" não atalha mais para só vista e PDF.
  - `npm run bench:router`: 49/57 (86%), 0 atalhos errados.
- **Conferência antes do `finish`** (no máximo 2 reparos):
  - `checkWork`: encaixe no ambiente e frentes que batem, só o que piorou no pedido.
  - `CLAIMS` (resposta): o Jev só lê a resposta, uma pergunta por ação (arquivo, vista, abrir, renomear, versão, móvel, material); o código confere com as ferramentas e com `describeDesignChanges`.
  - `WANTS` (pedido cumprido): o Jev lê só o pedido, perguntado no começo do turno em paralelo (arquivo, vista, abrir, aéreos, gavetas); o código olha ferramentas e o design final (e as opções montadas). Sem frente nenhuma, "abrir" não cobra reparo.
  - `npm run bench:claims`: 17/17 (o trabalho pela metade é pego pelo `WANTS`).
- **Macro `row_build`**: fileira ao longo da parede, divide em módulos, painel compartilhado, prende a parede, desvia de janela, porta e coluna.
- **Opções** (`options_make`): 2 ou 3 variantes, cada uma num sub-laço curto (`OPTION_TOOLS`, 4 etapas, sem reparo) sobre uma cópia do rascunho, em paralelo. Números do código (`optionCard`: total, chapas, peças, frentes, medidas, encaixe). O projeto não muda.
  - Página: `components/option-cards.tsx`. "Aplicar" vira versão (`update`), "Salvar como alternativa" faz `fork` e aplica no projeto novo; a opção igual ao projeto aberto aparece "Em uso".
  - Ao vivo: 3 opções em 38 s, 9 chamadas, US$ 0,007.
- **`render_look`**: o desenho do rascunho (frontal e isométrico) vai para a IA numa mensagem logo depois dos resultados. O prompt pede para usar em pedido com foto, depois do layout.
- **Página:** etapas ao vivo, rascunho na cena, despachante de efeitos (vista, aba, toggles, preços, exportar), estado `ui` na requisição. Efeitos pendentes rodam fora do ciclo do React (o PDF usa `flushSync`).
- **Estado para a IA:** `prateleiras` (sh-N com a altura) no snapshot e a operação `move` exata no prompt; cópia é independente (`shared:false`).

## Bench
- `npm run bench -- --agent` roda os casos pelo `runAgentTurn` e traduz o resultado para as ações antigas. `--record` grava as respostas do modelo (pela conversa, para sub-laços em paralelo) e do Jev (pelas perguntas); `--offline` repete sem rede.
- Grupos só do laço (`agentOnly`): `estudio`, `autoconferencia`, `trabalho-completo`, `opcoes`, com `expect.agent(got)` sobre efeitos, frentes, ambiente, projeto e opções.
- Casos atualizados ao produto de hoje (orçamento, corte): `rec-01`, `rec-02`, `sug-03`; `lim-03` conta só frentes de gaveta; `nav-02` aceita desfazer e mudar no mesmo pedido.
- Resultado (DeepSeek, 25/09, `bench/results/legado.json` e `agente-final.json`, fora do git):
  - Legado: 48/51 (94%), mediana 5,5 s, US$ 0,001 por caso.
  - Laço: 59/61 (97%); nos 51 casos comuns passou a acertar `lim-03`, `rec-01`, `rec-02` e errou `div-03` (instável: acertou nas outras 3 rodadas). Mediana 13 s, p90 78 s, US$ 0,003 por caso. `op-01` falhou pela expectativa (medir a parede vira versão), já corrigida.
  - Offline com as gravações de `bench/fixtures/agent`: 61/61.
  - O laço é mais lento que o legado (várias chamadas por pedido); o orçamento de tempo (`MAX_MS` 150 s no laço, 60 s por opção) segura a cauda.

## Modelo, provedor e esforço (medido em 25/09)
- **Campeão hoje:** DeepSeek V4.1 Flash com raciocínio ligado, no Command Code (59/61, US$ 0,003 por caso, mediana 13 s, p90 78 s).
- **Esforço no DeepSeek:** a doc da DeepSeek tem desligado, `low`, `high` (padrão) e `max`. Na prática `low` ≈ `high` nos três proxies testados (Command Code, OpenCode Zen, NanoGPT fixado na DeepSeek). `xhigh` e `max` no Command Code gastam 3× e estouram o tempo do laço: nunca usar.
- **Desligar o raciocínio:** o Command Code recusa `none` e ignora `thinking: disabled`. No Zen, `reasoning_effort: "none"` desliga e mantém a visão (55/61, mediana 7,9 s). No NanoGPT, sem esforço = desligado; fixar o provedor (`X-Provider: deepseek`), senão cai em provedor sem visão.
- **GPT-6 Luna:** o esforço importa muito (`low` 4/10 nos casos difíceis, `high` 9/10). Luna `high` completo: 55/61, mediana 11 s; falha pedindo esclarecimento em vez de fazer. No Zen, Luna só existe em `/responses` (o laço fala `/chat/completions`).
- **Zen:** limite de ~20 pedidos/min no DeepSeek (429 vira 503); o custo depende do cache (48% a 93% entre rodadas; fora do cache custa 50× mais).
- Tudo no painel: `npm run bench:dash -- --serve`.

## Perguntar ou fazer, reserva e provedor (26/09)
- **Rótulo por caso** (`askAct` em `bench/cases.mjs`): agir, perguntar, responder ou livre. Pedido acima do limite é agir (faz no limite e diz). O painel separa "perguntou em vez de fazer" e "fez em vez de perguntar" e reavalia as rodadas antigas com a regra nova.
- **Portão do perguntar** (`lib/agent/ask-gate.ts`): o Jev diz o que a pergunta quer saber e o código decide; uma vez por pedido. Offline (`npm run bench:askact`, 168 perguntas reais): pega 110/111 a mais, barra 0/50 legítimas. Ao vivo (11 casos × 3): Luna high 58% → 80%, perguntas a mais 9 → 0; DeepSeek sem ganho (81% → 78%, ruído): barrado no limite, ele explica em vez de fazer (div-05, lim-02).
- **Jev**, medido em 768 turnos: o roteador acerta os 48 atalhos (0,3 s contra 13,7 s); CLAIMS e WANTS dispararam 4 vezes, todas alarme falso aparente. Pendente decidir se desligam.
- **Modelos:** DeepSeek V4.1 Flash `low` é o padrão; GPT-6 Luna `high` é a reserva. Duas falhas do provedor seguidas na mesma etapa passam o resto do pedido para a Luna (`MERCE_FALLBACK_MODEL=none` desliga); o caminho antigo (foto) tenta a reserva uma vez.
- **Command Code trava:** chamada boa leva ~30 s; algumas ficam mudas (a partir de 30 s de silêncio é queda) ou mandam bytes sem terminar (uma durou 568 s). O laço corta: 60 s até o primeiro byte, 30 s de silêncio (`MERCE_AI_STALL_MS`), 90 s por chamada (`MERCE_AI_CALL_MS`), e o prazo do pedido (150 s, +90 s com plano) corta a chamada em curso.
- **Pedido real "adicione mais móveis e deixe o cenário mais realista"** (lavanderia): antes travava ~5 min sem fazer nada (fileira em cima do armário, recusada 3 vezes). Depois das correções (fileira desvia de móvel existente, obstáculo vai para o lugar livre ou volta com os trechos livres, tomada atrás de móvel é nota, sem arquivo não pedido, resposta até 700 caracteres): em 5 repetições, 3 completas e 2 pela metade, 2,5 a 4 min, sem travar e sem resposta errada. O que sobra é a IA mexendo na porta e na janela em vez dos móveis.

## Redesenho: peças por relação e fim conferido (26/09, branch `codex/model-friendly-design`)
Relatório completo, com números e limites: `docs/plans/redesign-report.md`.
- **Padrão:** GPT-6 Luna com raciocínio alto (`DEFAULT_MODEL` em `lib/models.ts`). Escolha explícita em `merce-model-choice`; "deepseek" na chave antiga era o padrão antigo gravado.
- **A parede vista pelo app** (`lib/agent/scene.ts`): fixos com a regra de cada um (TV: nada na frente nem a menos de 30 mm; porta, janela, coluna: não cobrir; tomada: pode ficar atrás), o que ocupa (x do canto, y do piso, profundidade) e onde cabe, por faixa e na frente de cada painel. Vai no estado (`parede`) e é a mesma conta do place, do modify e da conferência.
- **`place`** (`lib/agent/place.ts`): peça nova ao lado, acima ou abaixo de módulo, obstáculo ou outra peça do lote, ou num x/y. O app acha superfície (painel ou parede), profundidade, acabamento (do vizinho), interior e liga ao módulo em que encosta. Medida dita é exata (conflito volta com o que cabe de cada lado e os trechos livres); medida ausente encolhe até o espaço. Peça larga vira fileira com painel compartilhado; `tipo vao` reserva o espaço de um aparelho (vira obstáculo `other` com a ref como id); `tipo prateleira` é a prateleira de parede.
- **`modify`** (`lib/agent/modify.ts`): remover (conexões saem junto), mover por relação, medidas que valem para a fileira compartilhada (`altura_total` com pés), interior novo. `module.remove` do motor também tira as conexões; trocar o único módulo num lote não passa por projeto vazio.
- **Interior por linhas** (`lib/agent/interior.ts`): o app faz a conta dos vãos (alturas pedidas viram proporção quando não fecham); `porta_inteira` cobre um vão dividido (novidade do motor: porta sobre prateleiras).
- **Prateleira de parede:** módulo `kind: 'ledge'` (15 a 60 mm de espessura na altura, 150 a 600 de fundo, até 2700 de largura), sem compartimento, pés ou conexão.
- **Fim do pedido:** a conferência do app roda em todo caminho (finish, texto sem ferramenta, etapas ou tempo esgotados). Tempo acabou com rascunho válido: fica como parcial; inválido: volta ao começo. Operações separadas em gravadas, desfeitas e recusadas. O finish confere números (chapas, espessura, total) contra o estado final, objetivo (menos chapas ou custo), remoção não dita e mudança afirmada sem mudança. Falha no meio grava pedido, etapas, causa e o que foi descartado (`report.failure`).
- **TV:** `fitReport` com `tv-blocked` (painel atrás pode, o que avança na frente ou encosta não); a parede fica presa quando o pedido mexe no móvel e algo do começo fica; a cena 3D e o desenho do render_look usam a mesma conta (TV no painel que a segura, tela vermelha quando tapada).
- **Bench:** grupo `composicao` com oráculo próprio (`bench/oracle.mjs`), cenas em `bench/scenes`, `--fixtures` e `bench/compare-redesign.mjs`. Base: worktree em `a55d021` com gravações em `bench/fixtures/agent-baseline`.

## Pendências conhecidas
- **CLAIMS e WANTS:** medir com mais turnos ou desligar (só alarme falso em 768 turnos).
- **Offline:** `lim-01` e `lim-02` falham com as gravações antigas (a regra nova manda fazer); gravar de novo com o portão ligado (`npm run bench -- --agent --record`, ~US$ 0,20).
- **Foto no laço:** com duas imagens por etapa o modelo pensa ~40 s por chamada e estoura o tempo antes do layout inteiro. Foto segue pelo caminho antigo (rota e bench); voltar para o laço pede um modelo mais rápido com imagem ou mandar a foto só na primeira etapa.
- **Latência:** mediana 13 s contra 5,5 s do legado; `div-03`, `tip-01` e os de referência às vezes passam de 1 minuto por chamadas lentas do provedor.
- **Atalhos perdidos do roteador:** 8 de 57 pedidos de tela vão para o laço (custam alguns segundos, não erram).
- **Opções e ambiente:** o sub-laço recebe o aviso de encaixe, mas às vezes monta uma opção que não cabe; o cartão mostra "Não cabe no ambiente".
- **Peitoril baixo inventado:** numa rodada a IA marcou a janela abaixo de 1 m e o balcão desviou dela. `row_build` está certo; `agent-live.mjs` imprime os obstáculos para conferir.
- **Vista de frente com gavetas abertas:** em projeção frontal a gaveta aberta não aparece; a resposta diz que abriu e está certa.

## Atenção
- Um pedido por estado do Jev: indireção ("o item i") erra com confiança alta. Perguntas atômicas sobre um texto só funcionam; comparar duas listas não.
- O servidor de dev precisa reiniciar para ver mudanças de env (`TYPESAFE_API_KEY`).
- O vinext aceita um servidor de dev por pasta: com outra sessão na 4310, as duas dividem os mesmos dados.
