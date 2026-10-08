'use client';
/* oxlint-disable next/no-img-element -- Prévias vêm do próprio servidor (arquivo guardado) ou de SVG gerado aqui. */
/* oxlint-disable jsx-a11y/media-has-caption -- Áudio e vídeo anexados são arquivos do estúdio sem fala; não há legenda a dar. */
import { useRef } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Download,
  ExternalLink,
  Eye,
  FileJson,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Music,
  Play,
  RefreshCw,
} from 'lucide-react';
import { durationLabel, FILE_FORMATS, sizeLabel, type FileBlock, type FileKind, type FileMeta } from '@/lib/rich';
import { fileUrl, fixDuration, svgUrl, useFileAvailable, usePreviewPages, useRich } from './rich-context';

const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  image: 'Imagem',
  spreadsheet: 'Planilha',
  document: 'Documento',
  audio: 'Áudio',
  video: 'Vídeo',
};

/** Rótulo curto do formato no ícone: PDF, CSV, JSON, PNG, WEBM. */
function badge(meta: FileMeta | null, block: FileBlock) {
  const ext = (meta?.name.split('.').pop() ?? FILE_FORMATS[block.format].ext).toUpperCase();
  return ext.length > 4 ? ext.slice(0, 4) : ext;
}

function KindIcon({ kind, size = 18 }: { kind: FileKind; size?: number }) {
  if (kind === 'pdf') return <FileText size={size} />;
  if (kind === 'spreadsheet') return <FileSpreadsheet size={size} />;
  if (kind === 'image') return <ImageIcon size={size} />;
  if (kind === 'video') return <Film size={size} />;
  if (kind === 'audio') return <Music size={size} />;
  return <FileJson size={size} />;
}

/**
 * Cartão de arquivo da conversa: o mesmo esqueleto para todos os tipos
 * (ícone ou miniatura, nome, descrição, metadados e ações), com a prévia do
 * tipo quando ajuda. Nada abre nem baixa sozinho: só no clique.
 */
export function FileCard({ block, messageId }: { block: FileBlock; messageId: string }) {
  const rich = useRich();
  const meta = block.file;
  const available = useFileAvailable(block.status === 'ready' ? meta?.id : undefined);
  const kind: FileKind = meta?.kind ?? FILE_FORMATS[block.format].kind;
  const opener = useRef<HTMLButtonElement>(null);
  const newer = meta ? rich.supersededBy(meta.id) : null;
  const outdated = block.revisionId !== rich.current.id && FILE_FORMATS[block.format].made !== 'upload';
  const index = rich.revisionIndex(block.revisionId);
  const label = FILE_FORMATS[block.format].label;
  const busyHere = rich.generating.includes(block.format) || rich.fulfilling.includes(block.id);
  const missing = block.status === 'ready' && available === 'missing';
  const preview = () => meta && rich.open({ kind: 'file', block, meta }, opener.current);
  const regenerate = () =>
    FILE_FORMATS[block.format].made === 'client' ? rich.fulfill(messageId, block) : void rich.generate(block.format);

  if (block.status === 'pending' || (block.status === 'failed' && !meta)) {
    const pending = block.status === 'pending';
    return (
      <article className={'file-card ' + (pending ? 'pending' : 'failed')} data-block={block.id} aria-busy={pending && busyHere}>
        <span className={`file-icon kind-${kind}`} aria-hidden="true">
          {pending && busyHere ? <Loader2 size={18} className="spin" /> : pending ? <KindIcon kind={kind} /> : <AlertTriangle size={18} />}
        </span>
        <div className="file-main">
          <strong className="file-name">{label}</strong>
          <span className="file-desc">
            {pending
              ? busyHere
                ? block.format === 'video'
                  ? 'Gravando o móvel girando… leva alguns segundos.'
                  : 'Gerando a partir da cena…'
                : 'Este arquivo é feito pela tela e ainda não foi gerado.'
              : `Não saiu: ${block.error ?? 'erro ao gerar'}`}
          </span>
          <span className="file-meta">
            <span className="file-chip">v{block.revision}</span>
            {pending ? <span className="file-chip wait">{busyHere ? 'Gerando' : 'Pendente'}</span> : <span className="file-chip bad">Falhou</span>}
          </span>
        </div>
        {!busyHere && (
          <div className="file-actions">
            <button type="button" className="file-action" disabled={rich.busy || index < 0} onClick={regenerate} title={index < 0 ? 'A versão deste arquivo foi descartada' : undefined}>
              <RefreshCw size={14} /> {pending ? 'Gerar agora' : 'Tentar de novo'}
            </button>
          </div>
        )}
      </article>
    );
  }
  if (!meta) return null;
  const facts = [
    KIND_LABEL[kind],
    meta.pages ? `${meta.pages} ${meta.pages === 1 ? 'página' : 'páginas'}` : '',
    meta.durationMs ? durationLabel(meta.durationMs) : '',
    meta.width && meta.height && kind !== 'video' ? `${meta.width} × ${meta.height}` : '',
    sizeLabel(meta.size),
  ].filter(Boolean);
  const nameLabel = `${meta.name}, ${facts.join(', ')}`;
  return (
    <article className={`file-card kind-${kind}` + (missing ? ' missing' : '') + (newer ? ' superseded' : '')} data-block={block.id} aria-label={`Arquivo: ${nameLabel}`}>
      <FileThumb kind={kind} meta={meta} block={block} onOpen={missing ? undefined : preview} openerRef={opener} />
      <div className="file-main">
        <strong className="file-name" title={meta.name}>
          {meta.name}
        </strong>
        {meta.description && !missing && <span className="file-desc">{meta.description}</span>}
        {missing && <span className="file-desc bad">Arquivo indisponível: ele não está mais guardado no servidor.</span>}
        <span className="file-meta">
          <span className="file-facts">{facts.join(' · ')}</span>
          <span className="file-chip" title={`Gerado da versão ${block.revision} do projeto`}>
            v{block.revision}
            {block.generation > 1 ? ` · ${block.generation}ª geração` : ''}
          </span>
          {newer ? (
            <button type="button" className="file-chip link" onClick={() => rich.scrollToBlock(newer.id)} title="Ir para o arquivo mais novo">
              Substituído <ArrowDown size={11} />
            </button>
          ) : outdated ? (
            <span className="file-chip old" title={`O projeto está na versão ${rich.current.number}; este arquivo continua como foi gerado`}>
              projeto na v{rich.current.number}
            </span>
          ) : null}
        </span>
        {kind === 'audio' && !missing && <audio className="file-audio" controls preload="metadata" src={fileUrl(meta.id)} aria-label={`Tocar ${meta.name}`} onLoadedMetadata={fixDuration} />}
      </div>
      <div className="file-actions">
        {!missing && kind !== 'audio' && (
          <button ref={kind === 'image' || kind === 'video' || kind === 'pdf' ? undefined : opener} type="button" className="file-action" onClick={preview} aria-label={`Visualizar ${meta.name}`}>
            <Eye size={14} /> <span>Visualizar</span>
          </button>
        )}
        {!missing && (kind === 'pdf' || kind === 'image') && (
          <a className="file-action" href={fileUrl(meta.id)} target="_blank" rel="noopener" aria-label={`Abrir ${meta.name} em outra aba`}>
            <ExternalLink size={14} /> <span>Abrir</span>
          </a>
        )}
        {!missing && (
          <a className="file-action" href={fileUrl(meta.id, true)} download={meta.name} aria-label={`Baixar ${meta.name}`}>
            <Download size={14} /> <span>Baixar</span>
          </a>
        )}
        {!newer && (missing || outdated) && FILE_FORMATS[block.format].made !== 'upload' && (
          <button
            type="button"
            className="file-action"
            disabled={rich.busy || busyHere}
            onClick={() =>
              FILE_FORMATS[block.format].made === 'client' ? rich.fulfill(messageId, { ...block, status: 'pending', file: null }) : void rich.generate(block.format)
            }
            title={`Gera um arquivo novo da versão ${rich.current.number}; este continua aqui`}
          >
            {busyHere ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} <span>Gerar da v{rich.current.number}</span>
          </button>
        )}
      </div>
    </article>
  );
}

/** Ícone do tipo ou miniatura (primeira página do PDF, imagem, quadro do vídeo). */
function FileThumb({
  kind,
  meta,
  block,
  onOpen,
  openerRef,
}: {
  kind: FileKind;
  meta: FileMeta;
  block: FileBlock;
  onOpen?: () => void;
  openerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const pages = usePreviewPages(kind === 'pdf' ? meta.preview : undefined);
  const art =
    kind === 'pdf' && pages?.[0] ? (
      <img src={svgUrl(pages[0])} alt="" />
    ) : kind === 'image' ? (
      <img src={fileUrl(meta.id)} alt="" loading="lazy" />
    ) : kind === 'video' ? (
      <>
        <video src={`${fileUrl(meta.id)}#t=0.5`} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} />
        <span className="file-play" aria-hidden="true">
          <Play size={16} />
        </span>
      </>
    ) : null;
  const visual = kind === 'pdf' || kind === 'image' || kind === 'video';
  if (!visual || !onOpen)
    return (
      <span className={`file-icon kind-${kind}`} aria-hidden="true">
        {art ?? <KindIcon kind={kind} />}
        {!art && <b>{badge(meta, block)}</b>}
      </span>
    );
  return (
    <button
      ref={openerRef}
      type="button"
      className={`file-thumb kind-${kind}` + (art ? '' : ' empty')}
      onClick={onOpen}
      aria-label={kind === 'video' ? `Assistir ${meta.name}` : `Ampliar ${meta.name}`}
    >
      {art ?? (
        <span className={`file-icon kind-${kind}`}>
          <KindIcon kind={kind} />
          <b>{badge(meta, block)}</b>
        </span>
      )}
      {kind === 'pdf' && <b className="file-badge">PDF</b>}
      {kind === 'image' && (
        <span className="file-zoom" aria-hidden="true">
          <Maximize2 size={12} />
        </span>
      )}
    </button>
  );
}
