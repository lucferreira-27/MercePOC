import { pruneTraces, traceSink } from '#platform';

/**
 * Registro completo de um pedido ao assistente, uma linha JSON por evento:
 * o pedido, cada chamada ao modelo (mensagens novas, resposta, raciocínio,
 * chamadas de ferramenta com argumentos), cada resultado de ferramenta sem
 * corte, erros, novas tentativas e como o pedido terminou. O relatório da
 * conversa guarda só os rótulos das etapas; sem isto, "por que a IA desfez?"
 * não tinha resposta depois do fato.
 *
 * No Node fica em `<MERCE_DATA_DIR ou data>/logs/<dia>/<hora>-<requestId>.jsonl`,
 * fora do git. Na Cloudflare vai para o SQLite do Durable Object e sai por
 * `/api/traces`. MERCE_TRACE=off desliga. Registros de dias com mais de
 * MERCE_TRACE_DAYS (padrão 30) são apagados uma vez por processo.
 */
export type Trace = {
  /** Onde ler o registro; null quando desligado. */
  file: string | null;
  write: (event: string, data?: Record<string, unknown>) => void;
};

export const NO_TRACE: Trace = { file: null, write: () => {} };

let pruned = false;

function prune() {
  if (pruned) return;
  pruned = true;
  const days = Number(process.env.MERCE_TRACE_DAYS) || 30;
  try {
    pruneTraces(new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10));
  } catch {}
}

/** Imagem em data URL vira só o tamanho: o registro é para ler, não para guardar fotos. */
export function stripImages(value: unknown): unknown {
  if (typeof value === 'string')
    return value.startsWith('data:image/') ? `[imagem ${Math.round(value.length / 1024)} KB]` : value;
  if (Array.isArray(value)) return value.map(stripImages);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripImages(v)]));
  return value;
}

export function openTrace(requestId: string, meta: Record<string, unknown> = {}): Trace {
  if (process.env.MERCE_TRACE === 'off') return NO_TRACE;
  const started = Date.now();
  const now = new Date(started);
  const safe = requestId.replace(/[^\w-]/g, '').slice(0, 64) || 'pedido';
  let sink;
  try {
    sink = traceSink(`${now.toISOString().slice(0, 10)}/${now.toISOString().slice(11, 19).replaceAll(':', '')}-${safe}`);
    prune();
  } catch {
    return NO_TRACE;
  }
  if (!sink) return NO_TRACE;
  const out = sink;
  let broken = false;
  const write = (event: string, data: Record<string, unknown> = {}) => {
    if (broken) return;
    try {
      out.append(
        `${JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - started, event, ...(stripImages(data) as object) })}\n`,
      );
    } catch {
      // Disco cheio ou pasta apagada: o pedido segue, sem registro.
      broken = true;
    }
  };
  write('trace.open', { requestId, ...meta });
  return { file: out.file, write };
}
