'use client';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { opSchema } from '@/lib/studio';
type Context = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations?: object;
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useProjectTools(
  read: () => unknown,
  edit: (input: unknown) => Promise<unknown>,
) {
  const callbacks = useRef({ read, edit });
  useEffect(() => {
    callbacks.current = { read, edit };
  }, [read, edit]);
  useEffect(() => {
    const ctx = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!ctx?.registerTool) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const tools = [
      {
        name: 'read_furniture_project',
        description: 'Lê os parâmetros e peças do projeto aberto.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => callbacks.current.read(),
      },
      {
        name: 'update_furniture_parameters',
        description:
          'Edita módulos, compartimentos, frentes e conexões, valida e salva uma revisão.',
        inputSchema: z.toJSONSchema(opSchema),
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => callbacks.current.edit(input),
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(ctx.registerTool(tool, options)).catch(() => {});
      } catch {}
    }
    return () => controller.abort();
  }, []);
}
