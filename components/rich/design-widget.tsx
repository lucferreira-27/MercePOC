'use client';
import { useCallback, useRef } from 'react';
import { ArrowDown, Box, Boxes, DoorOpen, FlipHorizontal2, History, Layers, Maximize2, Minus, Orbit, Plus, Ruler, Scan, Square } from 'lucide-react';
import { money } from '@/lib/quote';
import type { WidgetBlock } from '@/lib/rich';
import { PlanThumb } from '../plan-thumb';
import { useRich } from './rich-context';
import { BlockStatus, WidgetHead } from './widget-parts';
import { GoneCard } from './cut-widget';

const cm = (mm: number) => (Math.round(mm) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const VIEWS = [
  { id: 'perspective', label: 'Perspectiva', icon: <Box size={14} /> },
  { id: 'front', label: 'Frente', icon: <Square size={14} /> },
  { id: 'side', label: 'Lado', icon: <FlipHorizontal2 size={14} /> },
  { id: 'top', label: 'Topo', icon: <ArrowDown size={14} /> },
] as const;

/**
 * O móvel da resposta. No modo só conversa o cartão mais novo leva a cena 3D
 * de verdade (a mesma do modo dividido, mudada de lugar): dá para girar,
 * escolher peças, abrir frentes e trocar a vista ali mesmo. Os cartões
 * antigos mostram o desenho da versão deles.
 */
export function DesignWidget({ block }: { block: WidgetBlock }) {
  const rich = useRich();
  const current = rich.isLive(block);
  const index = current ? rich.current.index : rich.revisionIndex(block.revisionId);
  const scene = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLButtonElement>(null);
  const setActive = rich.scene.setActive;
  const placeScene = rich.sceneSlot;
  // Ref de callback próprio: a página guarda o lugar da cena e a move para cá.
  const slot = useCallback((el: HTMLDivElement | null) => placeScene(el), [placeScene]);
  // A cena é um portal da página: os eventos dela sobem pela árvore do React
  // até a página, não até este cartão. Ouvintes nativos no DOM pegam o clique
  // dentro da cena (liga a roda) e a saída do cursor (desliga).
  const liveArea = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const on = () => setActive(true);
      const off = () => setActive(false);
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerleave', off);
      return () => {
        el.removeEventListener('pointerdown', on);
        el.removeEventListener('pointerleave', off);
      };
    },
    [setActive],
  );
  if (index < 0 || block.snapshot.widget !== 'design') return <GoneCard block={block} />;
  const size = rich.sizeAt(index);
  const total = current ? rich.quoteAt(index).total : block.snapshot.total;
  const s = block.snapshot;
  const facts = current ? { modules: rich.modulesAt(index), parts: rich.partsAt(index) } : { modules: s.modules, parts: s.parts };
  const live = current && rich.mode === 'chat';
  const summary = `${cm(size[0])} × ${cm(size[1])} × ${cm(size[2])} cm · ${facts.modules} ${facts.modules === 1 ? 'módulo' : 'módulos'} · ${facts.parts} peças · ${money(total)}`;
  if (live) {
    const c = rich.scene;
    return (
      <article className="rich-card design-widget live" data-block={block.id} aria-label={`Móvel da versão ${rich.current.number}, em 3D`}>
        <WidgetHead icon={<Box size={15} />} title={rich.projectName} sub={summary} status={<BlockStatus block={block} />} />
        <div className={'dw-live' + (c.active ? ' active' : '')} ref={liveArea}>
          {/* Lugar da cena: sem filhos do React, a página põe o contêiner aqui. */}
          <div className="dw-slot" ref={slot} />
          {!c.active && (
            <span className="dw-live-hint" aria-hidden="true">
              <Orbit size={12} /> Arraste para girar · clique para usar a roda
            </span>
          )}
        </div>
        <div className="dw-tools" role="toolbar" aria-label="Controles da cena">
          <fieldset className="dw-seg" aria-label="Vista">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={c.view === v.id ? 'on' : ''}
                aria-pressed={c.view === v.id}
                title={v.label}
                aria-label={v.label}
                onClick={() => c.setView(v.id)}
              >
                {v.icon}
              </button>
            ))}
          </fieldset>
          <fieldset className="dw-seg" aria-label="Zoom">
            <button type="button" title="Afastar" aria-label="Afastar" onClick={() => c.zoom('out')}>
              <Minus size={14} />
            </button>
            <button type="button" title="Enquadrar" aria-label="Enquadrar o móvel" onClick={c.frame}>
              <Scan size={14} />
            </button>
            <button type="button" title="Aproximar" aria-label="Aproximar" onClick={() => c.zoom('in')}>
              <Plus size={14} />
            </button>
          </fieldset>
          <fieldset className="dw-seg" aria-label="Mostrar">
            <button type="button" className={c.dims ? 'on' : ''} aria-pressed={c.dims} title="Cotas" aria-label="Cotas" onClick={c.toggleDims}>
              <Ruler size={14} />
            </button>
            <button type="button" className={c.exploded ? 'on' : ''} aria-pressed={c.exploded} title="Explodir" aria-label="Explodir" onClick={c.toggleExplode}>
              <Layers size={14} />
            </button>
            <button
              type="button"
              className={c.fronts ? 'on' : ''}
              aria-pressed={c.fronts}
              disabled={!c.canFronts}
              title={c.canFronts ? 'Abrir e fechar portas e gavetas' : 'Sem portas ou gavetas'}
              aria-label="Abrir e fechar frentes"
              onClick={c.toggleFronts}
            >
              <DoorOpen size={14} />
            </button>
          </fieldset>
          <span className="dw-tools-end">
            <button ref={editor} type="button" className="rc-action" onClick={() => rich.open({ kind: 'project' }, editor.current)}>
              <Boxes size={14} /> Módulos
            </button>
            <button ref={scene} type="button" className="rc-action" title="Abrir a cena em tela grande, com todas as ferramentas" onClick={() => rich.open({ kind: 'scene' }, scene.current)}>
              <Maximize2 size={14} /> Tela cheia
            </button>
          </span>
        </div>
      </article>
    );
  }
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
