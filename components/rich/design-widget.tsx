'use client';
import { useRef } from 'react';
import { Box, Boxes, History, Orbit } from 'lucide-react';
import { money } from '@/lib/quote';
import type { WidgetBlock } from '@/lib/rich';
import { PlanThumb } from '../plan-thumb';
import { useRich } from './rich-context';
import { BlockStatus, WidgetHead } from './widget-parts';
import { GoneCard } from './cut-widget';

const cm = (mm: number) => (Math.round(mm) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * O móvel da resposta: desenho da versão, medidas e preço. No modo só
 * conversa é por aqui que se vê o que mudou; "Ver em 3D" abre a cena viva.
 */
export function DesignWidget({ block }: { block: WidgetBlock }) {
  const rich = useRich();
  const current = rich.isLive(block);
  const index = current ? rich.current.index : rich.revisionIndex(block.revisionId);
  const scene = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLButtonElement>(null);
  if (index < 0 || block.snapshot.widget !== 'design') return <GoneCard block={block} />;
  const size = rich.sizeAt(index);
  const total = current ? rich.quoteAt(index).total : block.snapshot.total;
  const s = block.snapshot;
  const facts = current ? { modules: rich.modulesAt(index), parts: rich.partsAt(index) } : { modules: s.modules, parts: s.parts };
  return (
    <article className={'rich-card design-widget' + (current ? '' : ' old')} data-block={block.id} aria-label={`Móvel da versão ${current ? rich.current.number : block.revision}`}>
      <WidgetHead icon={<Box size={15} />} title={rich.projectName} status={<BlockStatus block={block} />} />
      <div className="dw-body">
        <button
          ref={scene}
          type="button"
          className="dw-art"
          aria-label={current ? 'Ver o móvel em 3D' : `Desenho da versão ${block.revision}`}
          disabled={!current}
          onClick={() => rich.open({ kind: 'scene' }, scene.current)}
        >
          <PlanThumb parts={rich.drawingAt(index)} width={300} height={180} />
          {current && (
            <span className="dw-hint" aria-hidden="true">
              <Orbit size={13} /> 3D
            </span>
          )}
        </button>
        <dl className="dw-facts">
          <div>
            <dt>Medidas (L × A × P)</dt>
            <dd>
              {cm(size[0])} × {cm(size[1])} × {cm(size[2])} cm
            </dd>
          </div>
          <div>
            <dt>Composição</dt>
            <dd>
              {facts.modules} {facts.modules === 1 ? 'módulo' : 'módulos'} · {facts.parts} peças
            </dd>
          </div>
          <div>
            <dt>Estimativa</dt>
            <dd>{money(total)}</dd>
          </div>
        </dl>
      </div>
      <footer className="rc-actions">
        {current ? (
          <>
            <button type="button" className="rc-action primary" onClick={() => rich.open({ kind: 'scene' }, scene.current)}>
              <Orbit size={14} /> Ver em 3D
            </button>
            <button ref={editor} type="button" className="rc-action" onClick={() => rich.open({ kind: 'project' }, editor.current)}>
              <Boxes size={14} /> Editar módulos
            </button>
          </>
        ) : (
          <button type="button" className="rc-action" disabled={rich.busy} onClick={() => rich.seek(index)}>
            <History size={14} /> Voltar para a v{block.revision}
          </button>
        )}
      </footer>
    </article>
  );
}
