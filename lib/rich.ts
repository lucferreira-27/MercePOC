/**
 * Conteúdo rico da conversa: cartões interativos (widgets) e arquivos
 * anexados a uma mensagem. A mensagem guarda blocos estruturados, cada um com
 * o tipo do componente e o recurso que ele mostra (a versão do projeto, o
 * arquivo gerado). O cliente desenha cada bloco pelo registro em
 * components/rich; nada aqui é deduzido do texto da IA.
 *
 * Sem dependência de servidor: o cliente importa os mesmos tipos.
 */

/** Cartões que espelham uma aba do estúdio. */
export const WIDGET_KINDS = ['cut', 'quote', 'design'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/**
 * O que cada formato de arquivo gera. `server`: o servidor monta os bytes a
 * partir da versão gravada (PDF, CSV, JSON). `client`: depende da tela (foto
 * da cena, vídeo girando), o navegador grava e envia.
 */
export const FILE_FORMATS = {
  pdf: { label: 'PDF do projeto', kind: 'pdf', made: 'server', ext: 'pdf', mime: 'application/pdf' },
  'quote-pdf': { label: 'PDF do orçamento', kind: 'pdf', made: 'server', ext: 'pdf', mime: 'application/pdf' },
  'parts-csv': { label: 'Lista de peças', kind: 'spreadsheet', made: 'server', ext: 'csv', mime: 'text/csv' },
  'cut-csv': { label: 'Plano de corte', kind: 'spreadsheet', made: 'server', ext: 'csv', mime: 'text/csv' },
  cortecloud: { label: 'Arquivo Cortecloud', kind: 'document', made: 'server', ext: 'json', mime: 'application/json' },
  json: { label: 'Projeto completo', kind: 'document', made: 'server', ext: 'json', mime: 'application/json' },
  png: { label: 'Foto do móvel', kind: 'image', made: 'client', ext: 'png', mime: 'image/png' },
  video: { label: 'Vídeo girando o móvel', kind: 'video', made: 'client', ext: 'webm', mime: 'video/webm' },
} as const;
export type FileFormat = keyof typeof FILE_FORMATS;
export const FILE_FORMAT_IDS = Object.keys(FILE_FORMATS) as FileFormat[];
/** Família do arquivo: decide o cartão (ícone, prévia, tocador). */
export type FileKind = 'pdf' | 'image' | 'spreadsheet' | 'document' | 'audio' | 'video';

/** Família pelo tipo MIME, para arquivos que não saem de um formato do estúdio. */
export function kindOfMime(mime: string): FileKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (/csv|spreadsheet|excel/.test(mime)) return 'spreadsheet';
  return 'document';
}

/** Arquivo guardado: o que o cartão mostra sem baixar os bytes. */
export type FileMeta = {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  size: number;
  /** Páginas do PDF, quando se sabe. */
  pages?: number;
  /** Duração de áudio e vídeo, em ms. */
  durationMs?: number;
  width?: number;
  height?: number;
  /** Uma frase sobre o conteúdo ("Desenho, orçamento, peças e 4 chapas"). */
  description?: string;
  createdAt: string;
  projectId?: string;
  revisionId?: string;
  /** Número da versão de onde o arquivo saiu (exibição). */
  revision?: number;
  format?: FileFormat;
  /** Arquivo com a prévia (PDF: as páginas em SVG, JSON `string[]`). */
  preview?: string;
};

/** Números que o cartão tinha ao nascer: o histórico continua legível. */
export type QuoteSnapshot = {
  widget: 'quote';
  total: number;
  cost: number;
  margin: number;
  lines: number;
  /** Itens ajustados à mão (removidos, quantidade, extras). */
  adjusted: number;
  /** As linhas que mais pesam, para o cartão histórico. */
  top: { label: string; qty: number; unit: string; total: number }[];
};
export type CutSnapshot = {
  widget: 'cut';
  sheets: number;
  parts: number;
  efficiency: number;
  groups: { material: string; thickness: number; sheets: number }[];
};
export type DesignSnapshot = {
  widget: 'design';
  /** Largura, altura e profundidade, em mm. */
  size: [number, number, number];
  modules: number;
  parts: number;
  total: number;
};
export type WidgetSnapshot = QuoteSnapshot | CutSnapshot | DesignSnapshot;

export type WidgetBlock = {
  kind: 'widget';
  id: string;
  widget: WidgetKind;
  /** Versão que o cartão mostrou ao nascer. */
  revisionId: string;
  revision: number;
  /** Corte: a chapa em foco (1 em diante, na ordem do plano inteiro). */
  sheet?: number;
  /** Orçamento: as linhas que a resposta cita (chave seção|rótulo). */
  focus?: string[];
  snapshot: WidgetSnapshot;
};

export type FileBlock = {
  kind: 'file';
  id: string;
  format: FileFormat;
  /** `pending`: o navegador ainda vai gerar (foto, vídeo); `failed`: não saiu. */
  status: 'ready' | 'pending' | 'failed';
  file: FileMeta | null;
  revisionId: string;
  revision: number;
  /** Geração deste formato na conversa: 1, 2, 3… */
  generation: number;
  /** Arquivo da geração anterior, que este substitui (o antigo continua lá). */
  supersedes?: string;
  error?: string;
};

export type RichBlock = WidgetBlock | FileBlock;

/** Chave estável de uma linha do orçamento calculado. */
export const lineKey = (l: { section: string; label: string }) => `${l.section}|${l.label}`;

/** Nome de arquivo a partir do nome do projeto: "Guarda-roupa 2" → guarda-roupa-2. */
export function fileSlug(name: string) {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'projeto'
  );
}

/** "rack-de-tv-orcamento-v5.pdf"; a partir da segunda geração ganha "-2". */
export function fileName(project: string, format: FileFormat, revision: number, generation = 1) {
  const what: Record<FileFormat, string> = {
    pdf: 'projeto',
    'quote-pdf': 'orcamento',
    'parts-csv': 'pecas',
    'cut-csv': 'corte',
    cortecloud: 'cortecloud',
    json: 'projeto',
    png: 'foto',
    video: 'giro',
  };
  const tail = generation > 1 ? `-${generation}` : '';
  return `${fileSlug(project)}-${what[format]}-v${revision}${tail}.${FILE_FORMATS[format].ext}`;
}

/** "48 KB", "1,2 MB". */
export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** "0:42", "1:05:09". */
export function durationLabel(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * O que a conversa recente mostrou em cartões e arquivos, curto, para a IA
 * entender "aquele PDF", "a segunda chapa", "o orçamento de antes".
 */
export function blocksForPrompt(blocks: readonly RichBlock[] | undefined) {
  return (blocks ?? []).map((b) =>
    b.kind === 'widget'
      ? {
          cartao: { cut: 'plano de corte', quote: 'orçamento', design: 'móvel' }[b.widget],
          versao: b.revision,
          ...(b.sheet ? { chapa: b.sheet } : {}),
          ...(b.snapshot.widget === 'quote' ? { total: Math.round(b.snapshot.total * 100) / 100 } : {}),
          ...(b.snapshot.widget === 'cut' ? { chapas: b.snapshot.sheets } : {}),
        }
      : {
          arquivo: FILE_FORMATS[b.format].label,
          formato: b.format,
          versao: b.revision,
          ...(b.file ? { nome: b.file.name } : {}),
          ...(b.generation > 1 ? { geracao: b.generation } : {}),
          estado: b.status,
        },
  );
}
