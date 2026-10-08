import { randomUUID } from 'node:crypto';
import { revisionFacts } from '../exports';
import { makeFileBlock } from '../files';
import type { Prices, Quote } from '../quote';
import type { CutSnapshot, DesignSnapshot, FileBlock, QuoteSnapshot, RichBlock, WidgetBlock, WidgetKind } from '../rich';
import type { Project, Revision } from '../store';

/**
 * Cartões e arquivos da resposta, montados da versão que o pedido gravou.
 * O snapshot guarda os números daquele momento: o cartão continua legível
 * como histórico depois que o projeto muda (ou a versão sai do caminho).
 */
export function quoteSnapshot(q: Quote): QuoteSnapshot {
  return {
    widget: 'quote',
    total: q.total,
    cost: q.cost,
    margin: q.marginValue,
    lines: q.lines.length,
    adjusted: q.adjusted,
    top: [...q.lines]
      .sort((a, b) => b.total - a.total)
      .slice(0, 4)
      .map((l) => ({ label: l.label, qty: l.qty, unit: l.unit, total: l.total })),
  };
}

export function cutSnapshot(q: Quote): CutSnapshot {
  const plan = q.plan;
  const used = plan.sheets.reduce((a, s) => a + s.usedArea, 0);
  return {
    widget: 'cut',
    sheets: plan.sheets.length,
    parts: plan.sheets.reduce((a, s) => a + s.placements.length, 0),
    efficiency: plan.sheets.length ? used / (plan.sheets.length * plan.spec.length * plan.spec.width) : 0,
    groups: plan.groups.map((g) => ({ material: g.material, thickness: g.thickness, sheets: g.sheets })),
  };
}

export function widgetBlock(rev: Revision, prices: Prices, widget: WidgetKind, extra: { sheet?: number; focus?: string[] } = {}): WidgetBlock {
  const facts = revisionFacts(rev, prices);
  const snapshot =
    widget === 'quote'
      ? quoteSnapshot(facts.quote)
      : widget === 'cut'
        ? cutSnapshot(facts.quote)
        : ({ widget: 'design', size: facts.size, modules: facts.modules, parts: facts.parts.length, total: facts.quote.total } satisfies DesignSnapshot);
  return {
    kind: 'widget',
    id: randomUUID(),
    widget,
    revisionId: rev.id,
    revision: rev.number,
    ...(extra.sheet ? { sheet: extra.sheet } : {}),
    ...(extra.focus?.length ? { focus: extra.focus } : {}),
    snapshot,
  };
}

/**
 * Blocos da resposta: o móvel (quando a versão nova mudou o que se vê), os
 * cartões pedidos e os arquivos. Formato que só a página sabe fazer (foto,
 * vídeo) nasce pendente.
 */
export async function turnBlocks(
  p: Project,
  prices: Prices,
  cards: { widget: WidgetKind; sheet?: number; focus?: string[] }[],
  exports: readonly string[],
  showDesign: boolean,
): Promise<RichBlock[]> {
  const rev = p.revisions[p.cursor];
  const wanted = showDesign && !cards.some((c) => c.widget === 'design') ? [{ widget: 'design' as const }, ...cards] : cards;
  const blocks: RichBlock[] = wanted.map((c) => widgetBlock(rev, prices, c.widget, c));
  const files: FileBlock[] = [];
  for (const format of exports) {
    const block = await makeFileBlock(p, format as FileBlock['format'], prices, p.cursor, files);
    files.push(block);
  }
  return [...blocks, ...files];
}
