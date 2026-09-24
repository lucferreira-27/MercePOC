import { availableModels } from '@/lib/gateway';
export function GET() {
  return Response.json({
    configured: !!process.env.AI_API_KEY,
    model: process.env.AI_MODEL || 'deepseek/deepseek-v4.1-flash',
    /** Modelos com credencial neste servidor: o seletor desativa os outros. */
    models: availableModels(),
  });
}
