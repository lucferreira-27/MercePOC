import { listTraces, readTrace } from '#platform';
/**
 * Registros dos turnos (lib/trace.ts). Sem `name`: os 50 mais recentes. Com
 * `name` (`AAAA-MM-DD/HHMMSS-pedido`): o JSONL inteiro. Na Cloudflare é o
 * único jeito de ler o registro, que mora no SQLite do Durable Object.
 */
export function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name');
  if (!name) return Response.json(listTraces(50));
  const body = readTrace(name);
  if (body === null) return new Response('Registro não encontrado.', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
