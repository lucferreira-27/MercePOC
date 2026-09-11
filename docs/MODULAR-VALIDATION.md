# Validação da entrega modular

Data: 8 de setembro de 2026. Base Git: `5737848`, após `02f258c`. Alterações locais existentes em `app/page.tsx` e as capturas `.turn-failed.png`/`.turn-retry.png` foram preservadas. Não foi feito commit.

## Verificações

| Verificação | Resultado |
|---|---|
| Testes automatizados | 70 passaram, zero falhas |
| Lint | Passou, incluindo o editor modular novo |
| TypeScript | Passou |
| Build de produção | Passou |
| Navegador desktop | 1600 × 1000, capturas reais |
| Navegador estreito | 390 × 844, sem overflow horizontal |
| Erros de JavaScript no navegador | Nenhum na sequência de verificação |
| GLM 5.3 Flash via Merge Gateway | Sequência completa concluída |

O build mantém o aviso informativo do Vinext sobre classificação estática de algumas rotas. SQLite mantém o aviso experimental do Node. Nenhum impediu os testes ou o build.

## Cobertura

- Migração v1/v2 preservando dimensões e posições de cada painel, IDs resolvíveis, mensagens e revisões; backup SQLite com `integrity_check` válido.
- Todos os presets; compartilhamento lateral e tampo/base sem peça duplicada; separação sem colisão; redimensionamento conectado válido/inválido e pedido composto atômico.
- Divisões horizontais/verticais, vãos mínimos, distribuição descontando espessuras, redimensionamento proporcional e rejeição de mesclagem incompatível.
- Medidas de portas, caixas e frentes de gaveta; colisão em L; posição de abertura independente das exportações.
- Animação pelo pivô e posição final exata, inclusive módulo girado; histórico, alternativas, persistência e deduplicação.
- Timeline com uma, poucas e 25 revisões, rótulos curtos/longos, extremos do slider e prévia ativa sem mudar altura da barra.
- Abertura de porta/gaveta pelo painel, árvore/seleção sincronizada, layout estreito, alternativa com nome longo e redução de movimento.
- Regressões existentes de imagens, SSE/progresso, referências, recuperação de erro e operações antigas.

## Demonstração real pelo chat

Projeto: **Aceite modular · GLM**. ID `126c85c1-bc5a-466f-a3f4-218bb70b30f3`.

1. Remover as quatro prateleiras antigas, renomear o módulo e ajustar para 800 × 900 × 450 mm.
2. Adicionar Base direita com as mesmas medidas, compartilhando a lateral.
3. Dividir Base esquerda com 400 mm livres abaixo, adicionar três gavetas embaixo e duas portas em cima.
4. Adicionar Retorno de 600 × 900 × 450 mm, girado em 90°, conectado à direita com alinhamento pelos fundos e afastamento de 50 mm.
5. Abrir portas e gavetas por ação de visualização, sem nova revisão.
6. Desfazer pelo chat, refazer e criar alternativa com composição completa. Reenvio de requestId confirmado não duplicou a revisão.

Resultado: três módulos, 35 painéis físicos e uma lateral compartilhada com dois proprietários. Alternativa: `0576330e-3798-43e6-996c-23d086163b0d`.

Durante a execução houve respostas 429 e uma 503 do provedor upstream. Os pedidos foram retomados, preservando o projeto; a sequência terminou com sucesso. A primeira tentativa de remoção recebeu uma referência inválida e foi rejeitada integralmente. Os exemplos do contrato foram corrigidos antes da sequência aprovada. Não foram usadas respostas simuladas no aceite real.

## Evidências e reprodução

`work/modular-live.json` guarda mensagens, operações efetivamente aplicadas, tempos e projeto do aceite. `outputs/modular` contém:

- `desktop-aceite-glm.png`: composição criada pelo GLM e conversa real.
- `desktop-composicao.png`, `desktop-gaveta-aberta.png`, `desktop-porta-aberta.png`.
- `desktop-historico-inicio.png`, `desktop-historico-fim.png`, `desktop-muitas-inicio.png`, `desktop-muitas-fim.png`, `desktop-previa-ativa.png`.
- `estreito-composicao.png`, `estreito-alternativa.png`, `estreito-uma-versao.png`, `estreito-muitas-versoes.png`, `estreito-reduced-motion.png`.
- `aceite-glm-pecas.csv`, `aceite-glm-cortecloud.json`, `aceite-glm-projeto.json`.
- `ui-results.json`: resumo da execução de navegador.

Reproduzir: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:live`. Para screenshots: `node --import tsx scripts/modular-ui.mjs`, com Playwright disponível. Os scripts criam projetos de teste identificados, sem apagar projetos do usuário. `work` e `outputs` são ignorados pelo Git.

## Limitações restantes

Esta é uma POC geométrica. Não dimensiona cargas, estabilidade ou fixações; não seleciona ferragens comerciais, furações ou usinagens; não otimiza chapas e não envia pedidos. A análise de movimento é amostrada, não uma simulação física certificada. O adaptador Cortecloud ainda requer validação de importação em uma conta real. Reimportação de JSON pela interface não foi adicionada. O botão de cotas continua ausente.
