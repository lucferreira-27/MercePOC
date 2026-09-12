import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * O pedido veio da própria origem que o navegador está usando?
 *
 * As rotas de escrita recusam origem diferente para um site de fora não mexer
 * no projeto. Comparar com `new URL(req.url).origin` sozinho quebra atrás de
 * túnel ou proxy: o servidor vê `http://127.0.0.1:4310` enquanto o navegador
 * está em `https://algo.trycloudflare.com`, e o app respondia "Origem
 * inválida" em toda escrita. O host do cabeçalho (`host`, ou `x-forwarded-host`
 * quando há proxy) é a mesma origem que o navegador enxerga.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const encaminhado = (req.headers.get('x-forwarded-host') ?? '').split(',')[0].trim();
  const proprio = encaminhado || req.headers.get('host') || new URL(req.url).host;
  return host === proprio || origin === new URL(req.url).origin;
}
