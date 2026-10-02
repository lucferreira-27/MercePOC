# Merce na Cloudflare

O app publicado fica em **https://merce.lucferreira14.workers.dev**, no plano
gratuito da Cloudflare, protegido por senha. O Node continua igual: `npm run
dev`, `npm run build` e o `G:\MercePOC-prod` não usam nada daqui.

## Como funciona

```
navegador ──► Worker (worker/index.ts)
               │  confere a senha (worker/auth.ts)
               ▼
             Durable Object "Studio"
               │  roda o app inteiro do vinext (páginas e /api)
               ▼
             SQLite do próprio objeto: projetos, fotos e registros dos turnos
```

- **Por que um Durable Object.** No plano gratuito um Worker tem 10 ms de CPU
  por pedido, pouco para um turno da IA. O Durable Object tem 30 s de CPU por
  pedido e um SQLite síncrono, igual ao `node:sqlite`. Por isso o
  `lib/store.ts` é o mesmo nas duas plataformas.
- **`#platform`.** O que muda entre Node e Cloudflare mora em
  `lib/platform/node.ts` e `lib/platform/worker.ts`. O código importa
  `#platform`: o `package.json` aponta para o Node e o `vite.config.ts`, no
  modo `cloudflare`, troca para o Worker.
- **Fotos.** Não há `sharp` no Worker. O navegador reduz a foto para 1600 px
  em JPEG antes de enviar (`lib/shrink-image.ts`) e o Worker guarda os bytes
  no SQLite, em pedaços de 1 MB. A vista do projeto que a IA recebe é
  rasterizada pelo resvg (WASM) em vez do `sharp`.
- **Registros.** Cada turno é gravado no SQLite, como no `data/logs` do Node.
  Com a sessão aberta, `/api/traces` lista os 50 últimos e
  `/api/traces?name=<nome>` devolve o JSONL.
- **Configuração do Wrangler** em `cloudflare/wrangler.jsonc`, fora da raiz:
  com um `wrangler.jsonc` na raiz o vinext recusa o build do Node.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run cf:deploy` | Monta para a Cloudflare e publica. |
| `npm run cf:secrets` | Envia as chaves do `.env` e pede a senha do app. `-- --keep` mantém a senha atual. |
| `npm run cf:preview` | Monta e roda o Worker na máquina, em http://127.0.0.1:4311 (sem senha, lê o `.env`). |
| `npm run cf:logs` | Mostra ao vivo os logs do Worker publicado. |

Projetos e fotos ficam a cada deploy: moram no Durable Object, não no pacote.

## Deploy automático

O GitHub Actions (`.github/workflows/deploy.yml`) publica sozinho:

- **Push no `dev`:** roda lint, tipos e testes. Nada é publicado.
- **Push no `main`:** roda o mesmo e, se passar, `npm run cf:deploy`, depois
  confere que `/login` responde 200. O selo no README e o ambiente
  `production` na lateral do repositório mostram o último resultado.
- **Na mão:** aba Actions → Cloudflare → *Run workflow*. Ou, da máquina,
  `npm run cf:deploy` como antes.

O workflow precisa do segredo `CLOUDFLARE_API_TOKEN` no repositório (token
criado no painel da Cloudflare com o modelo *Edit Cloudflare Workers*). As
chaves da IA e a senha do app não passam pelo GitHub: continuam nos segredos
do Worker (`npm run cf:secrets`) e valem para todo deploy.

## Limites do plano gratuito

- 100.000 pedidos por dia e 5 GB de armazenamento.
- 50 chamadas externas por pedido. Um turno faz no máximo cerca de 10
  chamadas à IA (medido nos registros), longe do limite.
- 30 s de CPU por pedido no Durable Object. Esperar a IA não conta.

## Dados

O banco da Cloudflare começa vazio. Os projetos desta máquina continuam em
`data/merce.sqlite` e não sobem sozinhos.
