import { cleanAdjust, type QuoteAdjust, type QuoteExtra, type QuoteLine } from './quote';

/**
 * Edição do orçamento à mão em rascunho: as mesmas operações no cartão da
 * conversa, na janela grande e na aba. Tudo devolve um ajuste novo (nunca
 * muda o que recebeu); gravar transforma o rascunho em versão.
 */
export function setRemoved(adj: QuoteAdjust | undefined, key: string, removed: boolean): QuoteAdjust | undefined {
  const lines = { ...adj?.lines };
  const { removed: _drop, ...rest } = lines[key] ?? {};
  lines[key] = removed ? { ...rest, removed: true } : rest;
  return cleanAdjust({ ...adj, lines });
}

/** Quantidade à mão; `undefined` volta à conta do app. */
export function setQty(adj: QuoteAdjust | undefined, line: Pick<QuoteLine, 'key' | 'extra' | 'computedQty' | 'qty'>, qty: number | undefined): QuoteAdjust | undefined {
  if (line.extra) return updateExtra(adj, line.extra, { qty: qty ?? 0 });
  const key = line.key!;
  const lines = { ...adj?.lines };
  const { qty: _drop, ...rest } = lines[key] ?? {};
  const computed = line.computedQty ?? line.qty;
  lines[key] = qty === undefined || qty === computed ? rest : { ...rest, qty };
  return cleanAdjust({ ...adj, lines });
}

export function addExtra(adj: QuoteAdjust | undefined, extra: Omit<QuoteExtra, 'id'>): QuoteAdjust | undefined {
  const extras = [...(adj?.extras ?? [])];
  const base =
    extra.label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'item';
  let id = base;
  for (let i = 2; extras.some((e) => e.id === id); i++) id = `${base}-${i}`;
  extras.push({ ...extra, id });
  return cleanAdjust({ ...adj, extras });
}

export function updateExtra(adj: QuoteAdjust | undefined, id: string, patch: Partial<Omit<QuoteExtra, 'id'>>): QuoteAdjust | undefined {
  return cleanAdjust({ ...adj, extras: (adj?.extras ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}

export function removeExtra(adj: QuoteAdjust | undefined, id: string): QuoteAdjust | undefined {
  return cleanAdjust({ ...adj, extras: (adj?.extras ?? []).filter((e) => e.id !== id) });
}

/** Quantas coisas o rascunho muda em relação ao gravado (linhas e itens à parte). */
export function draftChanges(saved: QuoteAdjust | undefined, draft: QuoteAdjust | undefined) {
  const a = cleanAdjust(saved),
    b = cleanAdjust(draft);
  const keys = new Set([...Object.keys(a?.lines ?? {}), ...Object.keys(b?.lines ?? {})]);
  let n = 0;
  for (const k of keys) if (JSON.stringify(a?.lines?.[k] ?? {}) !== JSON.stringify(b?.lines?.[k] ?? {})) n++;
  const ids = new Set([...(a?.extras ?? []).map((e) => e.id), ...(b?.extras ?? []).map((e) => e.id)]);
  for (const id of ids)
    if (JSON.stringify(a?.extras?.find((e) => e.id === id) ?? null) !== JSON.stringify(b?.extras?.find((e) => e.id === id) ?? null)) n++;
  return n;
}

/** Rótulo da versão que o rascunho grava: "Orçamento: tirou Montagem; Puxador 3 un; + Frete". */
export function draftLabel(saved: QuoteAdjust | undefined, draft: QuoteAdjust | undefined, labelOf: (key: string) => string) {
  const a = cleanAdjust(saved),
    b = cleanAdjust(draft);
  const parts: string[] = [];
  const keys = new Set([...Object.keys(a?.lines ?? {}), ...Object.keys(b?.lines ?? {})]);
  for (const k of keys) {
    const was = a?.lines?.[k] ?? {},
      now = b?.lines?.[k] ?? {};
    const name = labelOf(k);
    if (!was.removed && now.removed) parts.push(`tirou ${name}`);
    else if (was.removed && !now.removed) parts.push(`voltou ${name}`);
    if (was.qty !== now.qty) parts.push(now.qty === undefined ? `${name} pela conta` : `${name} ${now.qty}`);
  }
  for (const e of b?.extras ?? []) {
    const before = a?.extras?.find((v) => v.id === e.id);
    if (!before) parts.push(`+ ${e.label}`);
    else if (JSON.stringify(before) !== JSON.stringify(e)) parts.push(`${e.label} ${e.qty} ${e.unit}`);
  }
  for (const e of a?.extras ?? []) if (!b?.extras?.some((v) => v.id === e.id)) parts.push(`− ${e.label}`);
  const text = parts.join('; ') || 'ajustes';
  return `Orçamento: ${text}`.slice(0, 90);
}
