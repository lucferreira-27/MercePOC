import { DurableObject } from 'cloudflare:workers';
import handler from 'vinext/server/fetch-handler';
import { bindStorage } from '../lib/platform/worker';
import { gate } from './auth';

/**
 * Entrada do Merce na Cloudflare.
 *
 * O Worker só confere a senha e passa o pedido adiante: no plano gratuito ele
 * tem 10 ms de CPU por pedido, pouco para um turno da IA. Quem responde é um
 * Durable Object único (`Studio`), que tem 30 s de CPU por pedido e um SQLite
 * próprio e síncrono. Ele roda o app inteiro do vinext (páginas e /api), com
 * o banco ligado ao `lib/platform/worker.ts`: o `lib/store.ts` é o mesmo do Node.
 */
type Env = {
  STUDIO: DurableObjectNamespace<Studio>;
  ASSETS: Fetcher;
  MERCE_PASSWORD?: string;
};

export class Studio extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    bindStorage(ctx.storage.sql);
  }

  async fetch(request: Request) {
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    return handler.fetch(request, this.env, ctx);
  }
}

export default {
  async fetch(request, env) {
    const stop = await gate(request, env.MERCE_PASSWORD);
    if (stop) return stop;
    // Um projeto só, uma pessoa: um objeto só, sempre o mesmo.
    return env.STUDIO.get(env.STUDIO.idFromName('studio')).fetch(request);
  },
} satisfies ExportedHandler<Env>;
