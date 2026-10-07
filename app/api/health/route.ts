import { availableModels, serverDefaultModel } from '@/lib/gateway';
import { modelInfo, reasoningEffort } from '@/lib/models';
export function GET() {
  return Response.json({
    configured: availableModels().length > 0,
    /** Modelo de quem não escolheu e o esforço que vai de fato (MERCE_REASONING_EFFORT troca). */
    defaultModel: serverDefaultModel(),
    defaultEffort: reasoningEffort(modelInfo(serverDefaultModel())) ?? null,
    model: process.env.AI_MODEL || 'deepseek/deepseek-v4.1-flash',
    /** Modelos com credencial neste servidor: o seletor desativa os outros. */
    models: availableModels(),
  });
}
