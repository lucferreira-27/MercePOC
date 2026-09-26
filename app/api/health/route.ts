import { availableModels } from '@/lib/gateway';
import { DEFAULT_MODEL, modelInfo, reasoningEffort } from '@/lib/models';
export function GET() {
  return Response.json({
    configured: !!process.env.AI_API_KEY,
    /** Modelo de quem não escolheu e o esforço que vai de fato (MERCE_REASONING_EFFORT troca). */
    defaultModel: DEFAULT_MODEL,
    defaultEffort: reasoningEffort(modelInfo(DEFAULT_MODEL)) ?? null,
    model: process.env.AI_MODEL || 'deepseek/deepseek-v4.1-flash',
    /** Modelos com credencial neste servidor: o seletor desativa os outros. */
    models: availableModels(),
  });
}
