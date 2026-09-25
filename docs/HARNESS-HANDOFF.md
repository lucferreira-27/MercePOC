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

## Pendências conhecidas
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
