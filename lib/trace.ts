import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Registro completo de um pedido ao assistente, uma linha JSON por evento:
 * o pedido, cada chamada ao modelo (mensagens novas, resposta, raciocínio,
 * chamadas de ferramenta com argumentos), cada resultado de ferramenta sem
 * corte, erros, novas tentativas e como o pedido terminou. O relatório da
 * conversa guarda só os rótulos das etapas; sem isto, "por que a IA desfez?"
 * não tinha resposta depois do fato.
 *
 * Fica em `<MERCE_DATA_DIR ou data>/logs/<dia>/<hora>-<requestId>.jsonl`, fora
 * do git. MERCE_TRACE=off desliga. Pastas de dias com mais de
 * MERCE_TRACE_DAYS (padrão 30) são apagadas uma vez por processo.
 */
export type Trace = {
  /** Arquivo do registro; null quando desligado. */
  file: string | null;
  write: (event: string, data?: Record<string, unknown>) => void;
};

export const NO_TRACE: Trace = { file: null, write: () => {} };

let pruned = false;

function logsDir() {
  return join(process.env.MERCE_DATA_DIR || join(process.cwd(), 'data'), 'logs');
}

function prune(dir: string) {
  if (pruned) return;
  pruned = true;
  const days = Number(process.env.MERCE_TRACE_DAYS) || 30;
  const oldest = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  try {
    for (const name of readdirSync(dir))
      if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < oldest) rmSync(join(dir, name), { recursive: true, force: true });
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
  const dir = join(logsDir(), now.toISOString().slice(0, 10));
  const safe = requestId.replace(/[^\w-]/g, '').slice(0, 64) || 'pedido';
  const file = join(dir, `${now.toISOString().slice(11, 19).replaceAll(':', '')}-${safe}.jsonl`);
  try {
    mkdirSync(dir, { recursive: true });
    prune(logsDir());
  } catch {
    return NO_TRACE;
  }
  let broken = false;
  const write = (event: string, data: Record<string, unknown> = {}) => {
    if (broken) return;
    try {
      // Síncrono de propósito: a linha fica no disco mesmo se o processo cair
      // logo depois, que é justamente quando o registro importa.
      appendFileSync(
        file,
        `${JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - started, event, ...(stripImages(data) as object) })}\n`,
      );
    } catch {
      // Disco cheio ou pasta apagada: o pedido segue, sem registro.
      broken = true;
    }
  };
  write('trace.open', { requestId, ...meta });
  return { file, write };
}
