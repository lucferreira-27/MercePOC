'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Maximize2, RotateCw, Scissors } from 'lucide-react';
import type { CutPlan, CutSheet, Placement } from '@/lib/cutplan';
import type { WidgetBlock } from '@/lib/rich';
import { CutSheetDrawing, mmText, pieceTone, shortName } from '../cut-sheet-drawing';
import { useRich } from './rich-context';
import { BlockStatus, WIDGET_ICON, WidgetHead } from './widget-parts';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const m2 = (mm2: number) => (mm2 / 1e6).toFixed(2).replace('.', ',');
/** Peças da chapa no cartão; o resto fica na aba (ou na janela grande). */
const LIST_ROWS = 5;

/**
 * Plano de corte dentro da resposta: a chapa em foco desenhada em escala,
 * as setas para as outras, as peças com número e medida de corte. Passar o
 * mouse acende no móvel, clicar escolhe a peça (a seleção vale para o
 * próximo pedido). Ampliar abre o plano inteiro, o mesmo da aba Corte.
 */
export function CutWidget({ block }: { block: WidgetBlock }) {
  const rich = useRich();
  // O cartão mais novo de corte acompanha o projeto; os de antes mostram a versão deles.
  const current = rich.isLive(block);
  const index = current ? rich.current.index : rich.revisionIndex(block.revisionId);
  const plan: CutPlan | null = useMemo(() => (index >= 0 ? rich.planAt(index) : null), [rich, index]);
  const snap = block.snapshot.widget === 'cut' ? block.snapshot : null;
  const opener = useRef<HTMLButtonElement>(null);
  const start = Math.max(0, Math.min((block.sheet ?? 1) - 1, (plan?.sheets.length ?? 1) - 1));
  const [at, setAt] = useState(start);
  const [hover, setHover] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!plan || !snap) return <GoneCard block={block} />;
  const sheet: CutSheet | undefined = plan.sheets[Math.min(at, plan.sheets.length - 1)];
  const used = plan.sheets.reduce((a, s) => a + s.usedArea, 0);
  const efficiency = plan.sheets.length ? used / (plan.sheets.length * plan.spec.length * plan.spec.width) : 0;
  const spare = plan.sheets.reduce((a, s) => a + s.offcuts.reduce((b, o) => b + o.w * o.h, 0), 0);
  const pieces = plan.sheets.reduce((a, s) => a + s.placements.length, 0);
  // Peça de versão antiga não está no móvel de agora: o cartão só mostra.
  const live = current;
  const focusPiece = (id: string | null) => {
    setHover(id);
    if (live) rich.focusParts(id ? { ids: [id], mode: 'piece' } : null);
  };
  const pick = (p: Placement, extend: boolean) => live && rich.selectParts([p.id], extend);
  const rows = sheet ? (showAll ? sheet.placements : sheet.placements.slice(0, LIST_ROWS)) : [];
  const ofMaterial = sheet ? plan.sheets.filter((s) => s.key === sheet.key).length : 0;
  const go = (d: number) => setAt((v) => Math.max(0, Math.min(plan.sheets.length - 1, v + d)));
  return (
    <article className="rich-card cut-widget" data-block={block.id} aria-label={`Plano de corte da versão ${block.revision}`}>
      <WidgetHead icon={<Scissors size={15} />} title="Plano de corte" status={<BlockStatus block={block} />} />
      <dl className="rc-stats">
        <div>
          <dt>Chapas</dt>
          <dd>{plan.sheets.length}</dd>
        </div>
        <div>
          <dt>Peças</dt>
          <dd>{pieces}</dd>
        </div>
        <div>
          <dt>Usado</dt>
          <dd>{pct(efficiency)}</dd>
        </div>
        <div>
          <dt>Sobra útil</dt>
          <dd>{m2(spare)} m²</dd>
        </div>
      </dl>
      {current && block.revisionId !== rich.current.id && snap.sheets !== plan.sheets.length && (
        <p className="rc-note">
          Quando o cartão saiu (v{block.revision}) eram {snap.sheets} chapas.
        </p>
      )}
      {sheet ? (
        <>
          <div className="cw-sheet" onMouseEnter={() => live && rich.focusParts({ ids: sheet.placements.map((p) => p.id), mode: 'sheet' })} onMouseLeave={() => live && !hover && rich.focusParts(null)}>
            <CutSheetDrawing
              spec={plan.spec}
              sheet={sheet}
              label="dims"
              offcuts
              selected={live ? rich.selected : []}
              hovered={hover}
              onPiece={live ? pick : undefined}
              onHover={focusPiece}
              title={`Chapa ${at + 1} de ${plan.sheets.length}: ${sheet.material} ${sheet.thickness} mm, ${sheet.placements.length} peças, ${pct(sheet.efficiency)} usada`}
            />
          </div>
          <div className="cw-nav">
            <button type="button" className="icon-button" aria-label="Chapa anterior" disabled={at === 0} onClick={() => go(-1)}>
              <ChevronLeft size={16} />
            </button>
            <div className="cw-nav-text" aria-live="polite">
              <i className={'swatch-dot' + (sheet.grain ? ' wood' : '')} style={{ '--swatch': pieceTone(sheet.materialId) } as React.CSSProperties} />
              <strong>
                Chapa {at + 1} de {plan.sheets.length}
              </strong>
              <span>
                {sheet.material} {sheet.thickness} mm{ofMaterial > 1 ? ` · ${sheet.index}/${ofMaterial}` : ''} · {sheet.placements.length} peças · {pct(sheet.efficiency)}
              </span>
            </div>
            <button type="button" className="icon-button" aria-label="Próxima chapa" disabled={at >= plan.sheets.length - 1} onClick={() => go(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <ol className="cw-list" aria-label={`Peças da chapa ${at + 1}`}>
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={'cw-row' + (rich.selected.includes(p.id) && live ? ' on' : '') + (hover === p.id ? ' hot' : '')}
                  disabled={!live}
                  aria-pressed={live ? rich.selected.includes(p.id) : undefined}
                  title={live ? 'Escolher a peça (Shift soma). O próximo pedido fala dela.' : 'Peça de uma versão anterior'}
                  onMouseEnter={() => focusPiece(p.id)}
                  onMouseLeave={() => focusPiece(null)}
                  onFocus={() => focusPiece(p.id)}
                  onBlur={() => focusPiece(null)}
                  onClick={(e) => pick(p, e.shiftKey)}
                >
                  <span className="cw-num">{p.n}</span>
                  <span className="cw-name">{shortName(p.name)}</span>
                  {p.rotated && (
                    <span className="cw-rot" title="Girada na chapa">
                      <RotateCw size={11} />
                    </span>
                  )}
                  <span className="cw-dim">
                    {mmText(p.w)} × {mmText(p.h)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {sheet.placements.length > LIST_ROWS && (
            <button type="button" className="link-button rc-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Mostrar menos' : `Mais ${sheet.placements.length - LIST_ROWS} peças nesta chapa`}
            </button>
          )}
        </>
      ) : (
        <p className="rc-note">Nenhuma peça de chapa nesta versão (só maciço, vidro, pedra ou metal).</p>
      )}
      <footer className="rc-actions">
        <button ref={opener} type="button" className="rc-action primary" onClick={() => rich.open({ kind: 'cut', sheet: at + 1 }, opener.current)}>
          <Maximize2 size={14} /> {rich.mode === 'split' ? 'Abrir no Corte' : 'Abrir o plano de corte'}
        </button>
        <button type="button" className="rc-action" onClick={() => rich.downloadCutCsv(index)}>
          <Download size={14} /> CSV
        </button>
        {!current && index >= 0 && (
          <button type="button" className="rc-action" disabled={rich.busy} onClick={() => rich.seek(index)}>
            Ver a v{block.revision}
          </button>
        )}
      </footer>
    </article>
  );
}

/** Versão do cartão saiu do caminho: só os números de quando ele nasceu. */
export function GoneCard({ block }: { block: WidgetBlock }) {
  const s = block.snapshot;
  const what = { cut: 'Plano de corte', quote: 'Orçamento', design: 'Móvel' }[block.widget];
  return (
    <article className="rich-card gone" data-block={block.id} aria-label={`${what} de uma versão descartada`}>
      <WidgetHead icon={WIDGET_ICON[block.widget]} title={what} status={<BlockStatus block={block} />} />
      <p className="rc-note">
        A versão {block.revision} foi descartada ao editar a partir de uma versão anterior. Ficaram os números de quando o cartão saiu:
      </p>
      <p className="rc-gone-facts">
        {s.widget === 'cut' && `${s.sheets} chapas, ${s.parts} peças, ${pct(s.efficiency)} usado.`}
        {s.widget === 'quote' && `Total ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.total)}, ${s.lines} itens.`}
        {s.widget === 'design' && `${Math.round(s.size[0] / 10)} × ${Math.round(s.size[1] / 10)} × ${Math.round(s.size[2] / 10)} cm, ${s.modules} módulos, ${s.parts} peças.`}
      </p>
    </article>
  );
}
