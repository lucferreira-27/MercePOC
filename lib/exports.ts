import { SCHEMA_VERSION, type ModularPart } from './composition';
import { cutPlanCSV } from './cutplan';
import { drawingParts, fittingsOf } from './fittings';
import { groupParts } from './parts-group';
import { projectPdf, quotePdf } from './project-pdf';
import { quote as buildQuote, money, type Prices, type Quote } from './quote';
import { FILE_FORMATS, type FileFormat } from './rich';
import type { Project, Revision } from './store';
import { canonical, cortecloud, cutCSV, generateDesign } from './studio';

/**
 * Bytes de cada arquivo que o servidor gera, a partir de uma versão gravada.
 * Puro (sem disco nem rede): a rota de arquivos e o turno da IA guardam o
 * resultado; os testes conferem o conteúdo direto.
 */
export type ExportInput = {
  project: Pick<Project, 'id' | 'name' | 'revisions' | 'room' | 'cursor' | 'origin'> & Partial<Project>;
  /** Índice da versão de onde o arquivo sai. */
  index: number;
  prices: Prices;
  date?: Date;
};
export type ExportResult = { bytes: Uint8Array; mime: string; pages?: number; description: string; /** Páginas em SVG (PDF), para a prévia na conversa. */ svg?: string[] };

const encoder = new TextEncoder();

/** Peças, desenho, medidas e orçamento (com os ajustes à mão) de uma versão. */
export function revisionFacts(rev: Revision, prices: Prices) {
  const params = canonical(rev.params);
  const g = generateDesign(rev.params);
  const parts = g.parts as ModularPart[];
  const size = [0, 1, 2].map((i) => g.bounds.max[i] - g.bounds.min[i]) as [number, number, number];
  const quote: Quote = buildQuote(parts, rev.params.modules.length, prices, fittingsOf(params, parts), rev.quote);
  return { params, parts, drawing: drawingParts(params), size, quote, modules: rev.params.modules.length };
}

/** O JSON do projeto completo, o mesmo do menu Exportar. */
export function projectJSON(project: ExportInput['project'], index: number, q: Quote, parts: readonly ModularPart[]) {
  const rev = project.revisions[index];
  const rows = groupParts(parts);
  return {
    ...project,
    schemaVersion: SCHEMA_VERSION,
    params: canonical(rev.params),
    revisions: project.revisions.map((r) => ({ ...r, params: canonical(r.params) })),
    resumo: {
      larguraMm: rev.params.width,
      alturaMm: rev.params.height,
      profundidadeMm: rev.params.depth,
      modulos: rev.params.modules.length,
      pecas: parts.length,
      itensDistintos: rows.length,
      areaM2: Number(rows.reduce((a, r) => a + r.area, 0).toFixed(4)),
      versaoExibida: index + 1,
      versoesSalvas: project.revisions.length,
      chapas: q.counts.sheets,
      orcamentoEstimado: q.total,
      ...(project.room ? { ambiente: project.room } : {}),
    },
  };
}

export function exportFile(format: FileFormat, input: ExportInput): ExportResult {
  const rev = input.project.revisions[input.index];
  if (!rev) throw new Error('Versão não encontrada para gerar o arquivo.');
  const mime = FILE_FORMATS[format].mime;
  const facts = revisionFacts(rev, input.prices);
  const date = input.date ?? new Date();
  const pdfInput = {
    name: input.project.name,
    revision: rev.number,
    date,
    parts: facts.parts,
    drawing: facts.drawing,
    size: facts.size,
    modules: facts.modules,
    quote: facts.quote,
  };
  switch (format) {
    case 'pdf': {
      const r = projectPdf(pdfInput);
      return { bytes: r.bytes, mime, pages: r.pages, description: r.description, svg: r.svg };
    }
    case 'quote-pdf': {
      const r = quotePdf(pdfInput);
      return { bytes: r.bytes, mime, pages: r.pages, description: r.description, svg: r.svg };
    }
    case 'parts-csv':
      return {
        bytes: encoder.encode(cutCSV(rev.params)),
        mime: 'text/csv;charset=utf-8',
        description: `${facts.parts.length} peças, uma linha por peça física`,
      };
    case 'cut-csv':
      return {
        bytes: encoder.encode(cutPlanCSV(facts.quote.plan)),
        mime: 'text/csv;charset=utf-8',
        description: `Posições das ${facts.quote.plan.sheets.reduce((a, s) => a + s.placements.length, 0)} peças em ${facts.quote.plan.sheets.length} ${facts.quote.plan.sheets.length === 1 ? 'chapa' : 'chapas'}`,
      };
    case 'cortecloud':
      return {
        bytes: encoder.encode(JSON.stringify(cortecloud(rev.params), null, 2)),
        mime,
        description: 'Peças no formato do Cortecloud (experimental)',
      };
    case 'json':
      return {
        bytes: encoder.encode(JSON.stringify(projectJSON(input.project, input.index, facts.quote, facts.parts), null, 2)),
        mime,
        description: `Projeto com ${input.project.revisions.length} versões e orçamento de ${money(facts.quote.total)}`,
      };
    default:
      throw new Error('Este arquivo é feito pelo navegador, não pelo servidor.');
  }
}
