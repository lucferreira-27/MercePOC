# Cartões e arquivos na conversa

A resposta da IA pode levar, além do texto, **blocos estruturados**: cartões do estúdio e arquivos gerados. A mensagem guarda os blocos (`Message.blocks`, em `lib/store.ts`); o cliente desenha cada um pelo registro em `components/rich`. Nada é deduzido do texto da IA.

## Os tipos

`lib/rich.ts` define tudo que cliente e servidor compartilham:

- `WidgetBlock`: um cartão (`cut`, `quote`, `design`), a versão em que nasceu (`revisionId`, `revision`), o foco pedido (`sheet` no corte, `focus` com as linhas do orçamento) e um `snapshot` com os números daquele momento.
- `FileBlock`: um arquivo (`format`), o estado (`pending`, `ready`, `failed`), a metadata do arquivo guardado (`FileMeta`), a versão de origem, a geração (`generation`) e o arquivo anterior que ele substitui (`supersedes`).
- `FILE_FORMATS`: cada formato diz quem gera (`server`, `client` ou `upload`), a família do cartão (`pdf`, `image`, `spreadsheet`, `document`, `audio`, `video`), a extensão e o MIME.

## De onde vêm

- **IA** (`lib/agent`): `card_show` pede um cartão, `quote_edit` ajusta o orçamento (e pede o cartão), `export_file` pede um arquivo, `ui_tab` de orçamento ou corte também põe o cartão. No fim do turno, `lib/agent/blocks.ts` monta os blocos da versão gravada; o cartão do móvel entra sozinho quando o turno mudou o que se vê.
- **Cartão** (`POST /api/files` com `action: 'generate'`): "Gerar PDF" cria uma mensagem nova com o arquivo, da versão vigente.
- **Página**: foto e vídeo (`made: 'client'`) nascem pendentes; o navegador grava (`lib/turntable.ts`) e envia o arquivo cru para `POST /api/files?id=…&messageId=…&blockId=…`. Multipart grande não serve: o vinext o trata como formulário de server action e recusa acima de 1 MB.

Os bytes ficam em `data/files` (Node) ou nas tabelas `files` e `file_chunks` do Durable Object (Cloudflare), por `putFile`/`readFileBytes` em `lib/platform`. `GET /api/files?id=` devolve o arquivo (`&download=1` para baixar, `&meta=1` só a metadata).

## Atual, histórico e rascunho

- O cartão **mais novo de cada tipo** acompanha o projeto (mostra a versão vigente); os anteriores do mesmo tipo mostram a versão deles, como **histórico**, ou os números do snapshot quando a versão saiu do caminho.
- **Arquivo é fotografia**: nunca muda. Gerar de novo o mesmo formato cria a geração seguinte e o cartão antigo mostra "Substituído".
- O orçamento editado à mão fica num **rascunho** da página (por projeto, guardado no navegador) até "Salvar", que grava a versão com `Revision.quote` (ajustes por linha e itens à parte, em `lib/quote.ts`). Cartão, aba e janela grande editam o mesmo rascunho (`lib/quote-draft.ts`).

## Pôr um cartão novo

1. Acrescente o tipo em `WIDGET_KINDS` e o snapshot em `lib/rich.ts`.
2. Monte o snapshot em `widgetBlock` (`lib/agent/blocks.ts`) e deixe a IA pedir o cartão (um `card_show` com a opção nova, ou uma ferramenta que chame `ctx.card`).
3. Escreva o componente em `components/rich/` lendo os dados por `useRich()` (o mesmo cálculo das abas) e registre-o em `WIDGETS` (`rich-blocks.tsx`).
4. Se ele abre um editor, acrescente o alvo em `PanelTarget` e o corpo em `panelView` (`app/page.tsx`).

## Pôr um formato de arquivo novo

1. Acrescente em `FILE_FORMATS` (e em `EXPORT_KINDS`, se a IA puder pedir).
2. Formato do servidor: gere os bytes em `exportFile` (`lib/exports.ts`). Formato do navegador: grave em `fulfillFile` (`app/page.tsx`) e aceite o MIME em `upload` (`app/api/files/route.ts`).
3. O cartão e a prévia já seguem a família (`kind`); só uma família nova pede código em `file-card.tsx` e `file-preview.tsx`.
