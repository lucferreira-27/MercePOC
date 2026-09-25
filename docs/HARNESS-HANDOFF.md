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
- Resultado: BENCH_RESULTADO

## Pendências conhecidas
- **Atalhos perdidos do roteador:** 8 de 57 pedidos de tela vão para o laço (custam alguns segundos, não erram).
- **Opções e ambiente:** o sub-laço recebe o aviso de encaixe, mas às vezes monta uma opção que não cabe; o cartão mostra "Não cabe no ambiente".
- **Peitoril baixo inventado:** numa rodada a IA marcou a janela abaixo de 1 m e o balcão desviou dela. `row_build` está certo; `agent-live.mjs` imprime os obstáculos para conferir.
- **Vista de frente com gavetas abertas:** em projeção frontal a gaveta aberta não aparece; a resposta diz que abriu e está certa.

## Atenção
- Um pedido por estado do Jev: indireção ("o item i") erra com confiança alta. Perguntas atômicas sobre um texto só funcionam; comparar duas listas não.
- O servidor de dev precisa reiniciar para ver mudanças de env (`TYPESAFE_API_KEY`).
- O vinext aceita um servidor de dev por pasta: com outra sessão na 4310, as duas dividem os mesmos dados.
