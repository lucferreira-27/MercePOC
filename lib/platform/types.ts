/**
 * O que muda entre rodar no Node (esta máquina, `npm run dev` e o
 * G:\MercePOC-prod) e na Cloudflare (Worker + Durable Object). O resto do app
 * importa `#platform`, que aponta para `node.ts` por padrão; o build da
 * Cloudflare troca o alias para `worker.ts` (vite.config.ts, modo cloudflare).
 */
export type SqlValue = string | number | null | Uint8Array;

/** SQLite síncrono: `node:sqlite` no Node, `ctx.storage.sql` no Durable Object. */
export type Sql = {
  all<T>(query: string, ...params: SqlValue[]): T[];
  get<T>(query: string, ...params: SqlValue[]): T | undefined;
  run(query: string, ...params: SqlValue[]): { changes: number };
};

/** Imagem guardada: os bytes e o tipo com que ela volta para o navegador e a IA. */
export type StoredImage = { bytes: Uint8Array; type: string };

/** Destino das linhas do registro de um pedido; `file` diz onde ler depois. */
export type TraceSink = { file: string; append(line: string): void };
