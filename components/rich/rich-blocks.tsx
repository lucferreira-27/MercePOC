'use client';
import type { FileBlock, RichBlock, WidgetBlock, WidgetKind } from '@/lib/rich';
import { CutWidget } from './cut-widget';
import { DesignWidget } from './design-widget';
import { FileCard } from './file-card';
import { QuoteWidget } from './quote-widget';
import { useRich } from './rich-context';

/**
 * Registro dos cartões: tipo do bloco → componente. Um cartão novo entra
 * aqui (e o tipo em lib/rich.ts); a conversa não muda. Arquivos usam um
 * cartão só, que se adapta pela família (PDF, imagem, planilha…).
 */
const WIDGETS: Record<WidgetKind, (p: { block: WidgetBlock }) => React.ReactNode> = {
  cut: CutWidget,
  quote: QuoteWidget,
  design: DesignWidget,
};

export function RichBlocks({ blocks, messageId }: { blocks: readonly RichBlock[]; messageId: string }) {
  const rich = useRich();
  // No modo dividido a cena está ao lado: o cartão do móvel seria repetido.
  const shown = blocks.filter((b) => !(b.kind === 'widget' && b.widget === 'design' && rich.mode === 'split'));
  if (!shown.length) return null;
  const files = shown.filter((b): b is FileBlock => b.kind === 'file');
  const widgets = shown.filter((b): b is WidgetBlock => b.kind === 'widget');
  return (
    <div className="rich-blocks">
      {widgets.map((b) => {
        const Widget = WIDGETS[b.widget];
        return Widget ? <Widget key={b.id} block={b} /> : null;
      })}
      {files.length > 0 && (
        <ul className="file-cards" aria-label={files.length === 1 ? 'Arquivo anexado' : `${files.length} arquivos anexados`}>
          {files.map((b) => (
            <li key={b.id}>
              <FileCard block={b} messageId={messageId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
