'use client';
import { useState } from 'react';
import { ChevronDown, PencilLine, Play, Square } from 'lucide-react';
import type { ChangeHighlight } from '@/lib/progress';
import { signOf, type ChangeSign } from '@/lib/diff';

const SIGN_CLASS: Record<ChangeSign, string> = { '+': 'add', '-': 'del', '~': 'mod' };
const SIGN_LABEL: Record<ChangeSign, string> = { '+': 'Entrou', '-': 'Saiu', '~': 'Mudou' };
/** Linhas visíveis antes de "mais N": o bloco não toma a conversa. */
const PEEK = 3;

/** Medida curta para a ponta da linha: "180 × 55 cm", "3 vãos". */
function metaOf(line: ChangeHighlight) {
  const cm = (v: string) => {
    const n = Number(v.replace(/[^\d.,]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? String(Math.round(n / 10)) : null;
  };
  if (line.measures && line.measures.length >= 2) {
    const [a, b] = line.measures.map((m) => cm(m.value));
    if (a && b) return `${a} × ${b} cm`;
  }
  if (line.rows && line.rows.length > 1) return `${line.rows.length} vãos`;
  if (line.rows?.length === 1) return line.rows[0].value;
  return null;
}

/**
 * O que o turno mudou, como o diff de um editor de código: cada linha é uma
 * mudança com o sinal (+ entrou, − saiu, ~ mudou), o cabeçalho traz a
 * contagem e a barrinha de proporção, e "Rever" toca as operações na cena,
 * uma a uma. Passar o mouse numa linha acende as peças dela no 3D.
 */
export function ChangeSet({
  lines,
  revision,
  parts,
  active,
  playingOp,
  playing,
  onReplay,
  onStop,
  onFocus,
  onPick,
}: {
  lines: ChangeHighlight[];
  /** Número da versão que o turno criou. */
  revision?: number;
  /** Peças que entraram, saíram e mudaram (o diff do desenho). */
  parts?: { added: number; removed: number; changed: number } | null;
  /** Esta mensagem está sendo revista na cena. */
  active: boolean;
  /** Operação do lote que está tocando agora. */
  playingOp: number | null;
  playing: boolean;
  onReplay?: () => void;
  onStop?: () => void;
  onFocus?: (targets: string[] | null) => void;
  onPick?: (targets: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const stat = { '+': 0, '-': 0, '~': 0 } as Record<ChangeSign, number>;
  for (const l of lines) stat[signOf(l)]++;
  const total = stat['+'] + stat['-'] + stat['~'];
  // Barrinha de cinco quadros, como o diffstat: proporção de cada sinal.
  const blocks: ChangeSign[] = [];
  for (const sign of ['+', '-', '~'] as ChangeSign[])
    for (let i = 0; i < Math.round((stat[sign] / Math.max(total, 1)) * 5); i++) blocks.push(sign);
  while (blocks.length < 5) blocks.push('~');
  blocks.length = 5;
  const playingLine = playingOp === null ? -1 : lines.findIndex((l) => l.ops?.includes(playingOp));
  // A linha que está tocando nunca fica escondida atrás de "mais N".
  const shown = expanded || playingLine >= PEEK ? lines : lines.slice(0, PEEK);
  const hidden = lines.length - shown.length;
  return (
    <section className={'cs' + (active ? ' active' : '')} aria-label="Mudanças deste turno">
      <header className="cs-head">
        <span className="cs-icon" aria-hidden="true">
          <PencilLine size={13} />
        </span>
        <strong>Edição</strong>
        {/* Versão e contagem: na coluna estreita descem para a segunda linha. */}
        <span className="cs-chips">
          {revision ? <span className="cs-rev">v{revision}</span> : null}
          <span className="cs-stat" aria-label={`${stat['+']} entraram, ${stat['-']} saíram, ${stat['~']} mudaram`}>
            {stat['+'] > 0 && <b className="add">+{stat['+']}</b>}
            {stat['-'] > 0 && <b className="del">−{stat['-']}</b>}
            {stat['~'] > 0 && <b className="mod">~{stat['~']}</b>}
          </span>
          <span className="cs-bar" aria-hidden="true">
            {blocks.map((b, i) => (
              <i key={i} className={SIGN_CLASS[b]} />
            ))}
          </span>
        </span>
        <span className="cs-spacer" />
        {onReplay &&
          (playing ? (
            <button type="button" className="cs-play" onClick={onStop} title="Parar a reprodução">
              <Square size={11} /> Parar
            </button>
          ) : (
            <button type="button" className="cs-play" onClick={onReplay} title="Ver as mudanças acontecerem na cena, passo a passo">
              <Play size={11} /> Rever
            </button>
          ))}
      </header>
      <ol className="cs-lines">
        {shown.map((line, i) => {
          const sign = signOf(line);
          const meta = metaOf(line);
          const isOpen = open === i;
          const detail =
            line.summary || line.rows?.length || line.facts?.length || line.measures?.length;
          return (
            <li
              key={`${line.tool}-${i}`}
              className={`cs-line ${SIGN_CLASS[sign]}${i === playingLine ? ' now' : ''}${isOpen ? ' open' : ''}`}
            >
              <button
                type="button"
                aria-expanded={detail ? isOpen : undefined}
                onMouseEnter={() => line.targets?.length && onFocus?.(line.targets)}
                onMouseLeave={() => onFocus?.(null)}
                onFocus={() => line.targets?.length && onFocus?.(line.targets)}
                onBlur={() => onFocus?.(null)}
                onClick={() => {
                  setOpen(isOpen ? null : i);
                  if (line.targets?.length) onPick?.(line.targets);
                }}
              >
                <span className="cs-sign" title={SIGN_LABEL[sign]}>
                  {sign === '-' ? '−' : sign}
                </span>
                <span className="cs-text">{line.title}</span>
                {meta && <span className="cs-meta">{meta}</span>}
              </button>
              {isOpen && detail ? (
                <div className="cs-detail">
                  {line.summary && <p>{line.summary}</p>}
                  {line.rows && line.rows.length > 0 && (
                    <ul className="cs-rows">
                      {line.rows.map((row, r) => (
                        <li key={`${row.label}-${r}`}>
                          <span>{row.label}</span>
                          <b>{row.value}</b>
                          {row.parts && row.parts.length > 1 && (
                            <span className="cs-split" aria-hidden="true">
                              {row.parts.map((part, k) => (
                                <i key={k} style={{ flexGrow: part }} />
                              ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(line.measures?.length || line.facts?.length) ? (
                    <dl className="cs-facts">
                      {[...(line.measures ?? []), ...(line.facts ?? [])].map((f) => (
                        <div key={f.label}>
                          <dt>{f.label}</dt>
                          <dd>{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {(hidden > 0 || expanded || parts) && (
        <footer className="cs-foot">
          {parts && (
            <span className="cs-parts" title="Peças de corte que entraram, saíram e mudaram">
              peças <b className="add">+{parts.added}</b> <b className="del">−{parts.removed}</b> <b className="mod">~{parts.changed}</b>
            </span>
          )}
          {(hidden > 0 || expanded) && lines.length > PEEK && (
            <button type="button" className="cs-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              {expanded ? 'Mostrar menos' : `Mais ${hidden} ${hidden === 1 ? 'mudança' : 'mudanças'}`}
              <ChevronDown size={12} />
            </button>
          )}
        </footer>
      )}
    </section>
  );
}
