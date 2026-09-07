'use client';
import { useEffect, useRef } from 'react';
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
          'Altera parâmetros da estante aberta, valida e salva uma revisão.',
        inputSchema: {
          type: 'object',
          properties: {
            width: { type: 'number', minimum: 300, maximum: 1200 },
            height: { type: 'number', minimum: 400, maximum: 2400 },
            depth: { type: 'number', minimum: 200, maximum: 600 },
            shelfCount: { type: 'integer', minimum: 0, maximum: 8 },
            materialId: { type: 'string', enum: ['white', 'oak', 'graphite'] },
            bottomOpening: { type: ['number', 'null'] },
          },
          additionalProperties: false,
        },
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
