'use client';
/* oxlint-disable next/no-img-element -- Imagem e páginas vêm do servidor do próprio estúdio. */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Área que rola (páginas, tabela, texto) precisa de foco para rolar pelo teclado. */
/* oxlint-disable jsx-a11y/media-has-caption -- Vídeo e foto gerados do móvel não têm fala; não há legenda a dar. */
import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { FileBlock, FileMeta } from '@/lib/rich';
import { fileUrl, fixDuration, svgUrl, usePreviewPages } from './rich-context';

/**
 * Prévia de um arquivo dentro da janela grande. PDF: as páginas desenhadas
 * (SVG gerado junto com o PDF), com zoom; sem elas, o leitor do navegador.
 * Planilha: tabela. Documento: o texto formatado. Imagem, vídeo e áudio: o
 * elemento do navegador, com controles.
 */
export function FilePreview({ meta, block }: { meta: FileMeta; block: FileBlock }) {
  if (meta.kind === 'pdf') return <PdfPages meta={meta} />;
  if (meta.kind === 'image')
    return (
      <div className="media-preview">
        <img src={fileUrl(meta.id)} alt={`${meta.name}, versão ${block.revision}`} data-autofocus tabIndex={0} />
      </div>
    );
  if (meta.kind === 'video')
    return (
      <div className="media-preview">
        <video src={fileUrl(meta.id)} controls playsInline data-autofocus aria-label={meta.name} onLoadedMetadata={fixDuration} />
      </div>
    );
  if (meta.kind === 'audio')
    return (
      <div className="media-preview audio">
        <audio src={fileUrl(meta.id)} controls data-autofocus aria-label={meta.name} onLoadedMetadata={fixDuration} />
      </div>
    );
  return <TextPreview meta={meta} />;
}

function PdfPages({ meta }: { meta: FileMeta }) {
  const pages = usePreviewPages(meta.preview);
  const [zoom, setZoom] = useState(1);
  if (meta.preview && pages === undefined)
    return (
      <output className="xv-loading">Carregando as páginas…</output>
    );
  if (!pages?.length)
    return <iframe className="xv-pdf-frame" src={`${fileUrl(meta.id)}#view=FitH`} title={meta.name} data-autofocus />;
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span>
          {pages.length} {pages.length === 1 ? 'página' : 'páginas'}
        </span>
        <fieldset className="pdf-zoom" aria-label="Zoom">
          <button type="button" className="icon-button" aria-label="Diminuir" disabled={zoom <= 0.6} onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))}>
            <Minus size={15} />
          </button>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" className="icon-button" aria-label="Aumentar" disabled={zoom >= 2} onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))}>
            <Plus size={15} />
          </button>
        </fieldset>
      </div>
      <div className="pdf-pages" tabIndex={0} data-autofocus aria-label={`${meta.name}, ${pages.length} páginas`} style={{ '--pdf-zoom': zoom } as React.CSSProperties}>
        {pages.map((svg, i) => (
          <figure key={i} className="pdf-page">
            <img src={svgUrl(svg)} alt={`Página ${i + 1} de ${pages.length}`} />
            <figcaption>
              {i + 1} / {pages.length}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** "a;b;"c;d"" → células, com aspas do CSV que o estúdio gera. */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  const sep = body.split(/\r?\n/, 1)[0].split(';').length >= body.split(/\r?\n/, 1)[0].split(',').length ? ';' : ',';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const MAX_ROWS = 400;

function TextPreview({ meta }: { meta: FileMeta }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(fileUrl(meta.id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error())))
      .then((t) => alive && setText(t))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [meta.id]);
  if (error) return <p className="xv-loading">Não consegui abrir o arquivo. Use Baixar.</p>;
  if (text === null)
    return (
      <output className="xv-loading">Abrindo…</output>
    );
  if (meta.kind === 'spreadsheet') {
    const rows = parseCsv(text);
    const [head, ...body] = rows;
    return (
      <div className="sheet-preview" tabIndex={0} data-autofocus aria-label={`Tabela de ${meta.name}`}>
        <table>
          <thead>
            <tr>
              {head?.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={/^-?\d+([.,]\d+)?$/.test(c) ? 'num' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {body.length > MAX_ROWS && <p className="hint">Mostrando {MAX_ROWS} de {body.length} linhas. O arquivo completo está em Baixar.</p>}
      </div>
    );
  }
  let shown = text;
  try {
    shown = JSON.stringify(JSON.parse(text), null, 2);
  } catch {}
  const cut = shown.length > 200_000;
  return (
    <pre className="doc-preview" tabIndex={0} data-autofocus>
      {cut ? `${shown.slice(0, 200_000)}\n…` : shown}
    </pre>
  );
}
