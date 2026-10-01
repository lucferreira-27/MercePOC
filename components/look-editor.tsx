'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { FinishPicker } from './finish-picker';
import type { ModularOp, Module } from '@/lib/composition';
import { categoryOf, type MaterialCategory, type MaterialId } from '@/lib/furniture';
import { EDGE_PROFILES, FRONT_STYLES, FRONTS, HANDLE_TYPES, HANDLES, LEG_TYPES, LEGS, TOP_LIMITS, type FrontStyle, type HandleType, type LegType, type LookPatch } from '@/lib/look';
import { DEFAULT_TABLE_BASE, TABLE_BASES, tableTop } from '@/lib/tables';

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Altura de partida de cada base quando a pessoa troca o tipo. */
const LEG_HEIGHT: Partial<Record<LegType, number>> = { palito: 150, tapered: 180, splayed: 200, block: 80, bun: 70, hairpin: 200, tube: 150, pipe: 150, sled: 200, frame: 200, plinth: 100, skirt: 80, casters: 80 };
const EDGE_NAME = { square: 'Reta', rounded: 'Boleada', chamfer: 'Chanfrada' } as const;
const TOP_CATEGORIES: MaterialCategory[] = ['sheet', 'solid', 'stone', 'glass', 'metal'];

/**
 * Acabamento do módulo: base, puxador, frente, tampo sobreposto,
 * moldura, contorno de aço, fundo de outra cor e LED. Aplica um `module.edit`
 * com o remendo do `look` (e a altura dos pés), pela mesma validação de
 * qualquer edição: a recusa aparece aqui, em frase. Mesa: base de mesa, tampo
 * (sempre), puxador e frente das gavetas, sem o que é de caixa.
 */
export function LookEditor({ module: m, busy, error, onApply }: { module: Module; busy: boolean; error: string; onApply: (op: ModularOp) => void }) {
  const look = m.look ?? {};
  const table = m.kind === 'table';
  // Puxador, base e frente de gaveta: caixa e mesa.
  const box = !m.kind || table;
  const tableTopNow = table ? tableTop(m) : null;
  const [legs, setLegs] = useState<LegType | ''>(look.legs ?? (table ? DEFAULT_TABLE_BASE : m.feet ? 'palito' : ''));
  const [feet, setFeet] = useState(m.feet ?? 0);
  const [handle, setHandle] = useState<HandleType>(look.handle ?? 'bar');
  const [front, setFront] = useState<FrontStyle>(look.front ?? 'flat');
  const [top, setTop] = useState(!!look.top || table);
  const [frame, setFrame] = useState(!!look.frame);
  const [back, setBack] = useState(!!look.backMaterialId);
  const legSpec = legs ? LEGS[legs] : null;
  const handleCats = HANDLES[handle].materials;
  const inserts = FRONTS[front].inserts;
  return (
    <form
      className="look-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const text = (k: string) => {
          const v = data.get(k);
          return typeof v === 'string' && v ? v : null;
        };
        const num = (k: string) => Number(data.get(k));
        const patch: LookPatch = { front, ...(table ? {} : { led: data.get('led') === 'on' || null }) };
        if (box) {
          patch.legs = legs || null;
          patch.legMaterialId = legs && legSpec?.materials ? (text('legMaterial') as MaterialId | null) : null;
          patch.handle = handle === 'bar' ? null : handle;
          patch.handleMaterialId = handleCats ? (text('handleMaterial') as MaterialId | null) : null;
          patch.insertMaterialId = inserts ? (text('insertMaterial') as MaterialId | null) : null;
          patch.top = top
            ? {
                materialId: (text('topMaterial') ?? 'oak-solid') as MaterialId,
                thickness: num('topThickness'),
                overhang: num('topOverhang'),
                edge: (text('topEdge') ?? 'square') as (typeof EDGE_PROFILES)[number],
              }
            : null;
          if (!table) {
            patch.cornice = data.get('cornice') === 'on' || null;
            patch.frame = frame || null;
            patch.frameMaterialId = frame ? (text('frameMaterial') as MaterialId | null) : null;
            patch.backMaterialId = back ? (text('backMaterial') as MaterialId | null) : null;
          }
        }
        if (patch.front === 'flat') patch.front = null;
        onApply({ kind: 'module.edit', id: m.id, ...(box && !table ? { feet: legs ? feet : 0 } : {}), look: patch });
      }}
    >
      {box && (
        <>
          <div className="look-base">
            <label>
              Base
              <select
                value={legs}
                onChange={(e) => {
                  const next = e.target.value as LegType | '';
                  setLegs(next);
                  const range = next ? LEGS[next].box : null;
                  if (range && (feet < range[0] || feet > range[1])) setFeet(LEG_HEIGHT[next as LegType] ?? range[0]);
                }}
              >
                {!table && <option value="">Sem pés (no piso)</option>}
                {(table ? TABLE_BASES : LEG_TYPES.filter((t) => LEGS[t].box)).map((t) => (
                  <option key={t} value={t}>
                    {capital(LEGS[t].name)}
                  </option>
                ))}
              </select>
            </label>
            {!table && legSpec?.box && (
              <label>
                Altura da base (mm)
                <input type="number" name="feet" min={legSpec.box[0]} max={legSpec.box[1]} step={5} value={feet} onChange={(e) => setFeet(Number(e.target.value))} title={`${legSpec.name}: ${legSpec.box[0]} a ${legSpec.box[1]} mm`} />
              </label>
            )}
          </div>
          {legSpec?.materials && (
            <div className="finish-field">
              <span>Acabamento da base</span>
              <FinishPicker key={legs} name="legMaterial" defaultValue={look.legMaterialId ?? legSpec.defaultMaterial ?? m.materialId} categories={[...legSpec.materials]} />
            </div>
          )}
          <label>
            Puxador
            <select value={handle} onChange={(e) => setHandle(e.target.value as HandleType)}>
              {HANDLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {capital(HANDLES[t].name)}
                </option>
              ))}
            </select>
          </label>
          {handleCats && (
            <div className="finish-field">
              <span>Acabamento do puxador</span>
              <FinishPicker key={handle} name="handleMaterial" defaultValue={look.handleMaterialId ?? 'steel-brushed'} categories={[...handleCats]} />
            </div>
          )}
        </>
      )}
      {m.kind !== 'ledge' && (
      <label>
        Frente
        <select value={front} onChange={(e) => setFront(e.target.value as FrontStyle)}>
          {FRONT_STYLES.filter((t) => (table ? t === 'flat' || t === 'shaker' || t === 'slatted' : box ? !FRONTS[t].panelOnly : t === 'flat' || t === 'slatted' || t === 'perforated')).map((t) => (
            <option key={t} value={t}>
              {capital(FRONTS[t].name)}
            </option>
          ))}
        </select>
      </label>
      )}
      {box && !table && inserts && (
        <div className="finish-field">
          <span>Miolo da porta</span>
          <FinishPicker key={front} name="insertMaterial" defaultValue={look.insertMaterialId && inserts.includes(categoryOf(look.insertMaterialId)) ? look.insertMaterialId : FRONTS[front].insertDefault!} categories={[...inserts]} />
        </div>
      )}
      {box && (
        <>
          {table ? (
            <span className="look-subtitle">Tampo</span>
          ) : (
            <label className="check-label">
              <input type="checkbox" checked={top} onChange={(e) => setTop(e.target.checked)} /> Tampo sobreposto
            </label>
          )}
          {top && (
            <>
              <div className="finish-field">
                <span>Material do tampo</span>
                <FinishPicker name="topMaterial" defaultValue={look.top?.materialId ?? tableTopNow?.materialId ?? 'oak-solid'} categories={TOP_CATEGORIES} />
              </div>
              <div className="fields">
                <label>
                  Espessura (mm)
                  <input type="number" name="topThickness" min={3} max={60} defaultValue={look.top?.thickness ?? tableTopNow?.thickness ?? 30} title={`Chapa ${TOP_LIMITS.sheet.join('–')}, maciço ${TOP_LIMITS.solid.join('–')}, pedra ${TOP_LIMITS.stone.join('–')}, vidro ${TOP_LIMITS.glass.join('–')}, metal ${TOP_LIMITS.metal.join('–')} mm`} />
                </label>
                <label>
                  {table ? 'Avanço sobre a base (mm)' : 'Avanço (mm)'}
                  <input type="number" name="topOverhang" min={0} max={60} defaultValue={look.top?.overhang ?? tableTopNow?.overhang ?? 15} />
                </label>
                <label>
                  Borda
                  <select name="topEdge" defaultValue={look.top?.edge ?? 'square'}>
                    {EDGE_PROFILES.map((v) => (
                      <option key={v} value={v}>
                        {EDGE_NAME[v]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
          {!table && (
            <>
          <label className="check-label">
            <input type="checkbox" name="cornice" defaultChecked={!!look.cornice} /> Moldura no topo
          </label>
          <label className="check-label">
            <input type="checkbox" checked={frame} onChange={(e) => setFrame(e.target.checked)} /> Contorno de aço
          </label>
            </>
          )}
          {!table && frame && (
            <div className="finish-field">
              <span>Acabamento do contorno</span>
              <FinishPicker name="frameMaterial" defaultValue={look.frameMaterialId ?? 'steel-black'} categories={['metal']} />
            </div>
          )}
          {!table && m.back && (
            <>
              <label className="check-label">
                <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} /> Fundo em outro acabamento
              </label>
              {back && (
                <div className="finish-field">
                  <span>Acabamento do fundo</span>
                  <FinishPicker name="backMaterial" defaultValue={look.backMaterialId ?? 'sage'} />
                </div>
              )}
            </>
          )}
        </>
      )}
      {!table && (
        <label className="check-label">
          <input type="checkbox" name="led" defaultChecked={!!look.led} /> Fita de LED
        </label>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Button className="touch-target" type="submit" disabled={busy}>
        Aplicar acabamento
      </Button>
    </form>
  );
}
