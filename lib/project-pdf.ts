import type { ModularPart } from './composition';
import type { CutPlan, CutSheet } from './cutplan';
import { materials } from './furniture';
import { groupParts } from './parts-group';
import { A4, PdfDoc, wrapText, type PdfPage } from './pdf';
import { planView } from './plan-geometry';
import { money, quantity, QUOTE_SECTIONS, type Quote } from './quote';

/**
 * Os PDFs do estúdio, montados no servidor a partir da versão gravada: o do
 * projeto (desenho, orçamento, peças e chapas) e o do orçamento (só a
 * proposta, para mandar ao cliente). Vetoriais, com texto selecionável, e
 * iguais no Node e na Cloudflare.
 */
export type PdfInput = {
  name: string;
  /** Número da versão de onde o arquivo sai. */
  revision: number;
  date: Date;
  /** Peças de corte (lista e chapas). */
  parts: readonly ModularPart[];
  /** Peças do desenho, com pés e ferragens à vista. */
  drawing: readonly ModularPart[];
  /** Largura, altura e profundidade totais, em mm. */
  size: [number, number, number];
  modules: number;
  quote: Quote;
};
export type PdfResult = { bytes: Uint8Array; pages: number; description: string; /** As páginas em SVG, para a prévia. */ svg: string[] };

const INK = '#1d211e';
const MUTED = '#6f6c65';
const FAINT = '#9a968d';
const LINE = '#e5dfd5';
const SOFT = '#f6f3ee';
const ACCENT = '#2f6b4f';
const MARGIN = 42;
const RIGHT = A4.width - MARGIN;
const WIDTH = RIGHT - MARGIN;
/** Fim útil da página: o rodapé fica embaixo. */
const BOTTOM = A4.height - 58;

const cmText = (mm: number) => (Math.round(mm) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const mmText = (mm: number) => String(Math.round(mm * 10) / 10).replace('.', ',');
const m2 = (v: number) => v.toFixed(2).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const dateText = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const tone = (id: string | null) => materials.find((m) => m.id === id)?.color ?? '#d9d3c7';
/** "Coluna 1 / Lateral esquerda" → "Lateral esquerda". */
const shortName = (name: string) => (name.includes(' / ') ? name.split(' / ').slice(1).join(' / ') : name);

/** Mistura a cor com branco: peça clara o bastante para o número aparecer. */
function lighten(hex: string, amount: number) {
  const v = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (Number.isNaN(v)) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Cursor vertical com quebra de página e cabeçalho corrido. */
class Flow {
  page!: PdfPage;
  y = MARGIN;
  constructor(
    readonly doc: PdfDoc,
    readonly running: string,
    first?: PdfPage,
    y = MARGIN,
  ) {
    if (first) {
      this.page = first;
      this.y = y;
    } else this.fresh();
  }
  private fresh() {
    const page = this.doc.page();
    page.text(MARGIN, MARGIN + 6, 'merce.', { size: 11, bold: true, color: ACCENT });
    page.text(RIGHT, MARGIN + 6, this.running, { size: 8.5, color: MUTED, align: 'right', maxWidth: WIDTH - 60 });
    page.line(MARGIN, MARGIN + 14, RIGHT, MARGIN + 14, { stroke: LINE, width: 0.6 });
    this.page = page;
    this.y = MARGIN + 36;
    return page;
  }
  /** Garante `h` pontos livres; senão abre página nova. Devolve se quebrou. */
  need(h: number) {
    if (this.y + h <= BOTTOM) return false;
    this.fresh();
    return true;
  }
  section(number: string, title: string) {
    this.need(70);
    this.page.text(MARGIN, this.y + 4, number, { size: 9, bold: true, color: ACCENT });
    this.page.text(MARGIN + 22, this.y + 4, title, { size: 15, bold: true });
    this.y += 22;
  }
  paragraph(text: string, size = 8.5, color = MUTED) {
    const lines = wrapText(text, size, WIDTH);
    for (const l of lines) {
      this.need(size + 4);
      this.page.text(MARGIN, this.y + size, l, { size, color });
      this.y += size + 3.5;
    }
    this.y += 4;
  }
}

/** Rodapé de todas as páginas: projeto, versão e página X de Y. */
function footers(doc: PdfDoc, left: string) {
  doc.pages.forEach((page, i) => {
    page.line(MARGIN, A4.height - 40, RIGHT, A4.height - 40, { stroke: LINE, width: 0.6 });
    page.text(MARGIN, A4.height - 28, left, { size: 7.5, color: FAINT, maxWidth: WIDTH - 90 });
    page.text(RIGHT, A4.height - 28, `Página ${i + 1} de ${doc.pages.length}`, { size: 7.5, color: FAINT, align: 'right' });
  });
}

/** Desenho do móvel (frontal ou isométrico) dentro de uma caixa. */
function drawFurniture(page: PdfPage, parts: readonly ModularPart[], view: 'iso' | 'front', x: number, y: number, w: number, h: number) {
  const g = planView(parts, view, { width: w, height: h });
  if (g.ground.length)
    page.polygon(
      g.ground.map(([px, py]) => [px + x, py + y] as const),
      { fill: '#000000', opacity: 0.06 },
    );
  for (const panel of g.panels)
    page.polygon(
      panel.points.map(([px, py]) => [px + x, py + y] as const),
      { fill: panel.tone, stroke: '#3a342c', width: 0.45 },
    );
  return g;
}

/** Vista frontal com as cotas de largura e altura do conjunto. */
function frontWithDims(page: PdfPage, parts: readonly ModularPart[], size: [number, number, number], x: number, y: number, w: number, h: number) {
  const g = drawFurniture(page, parts, 'front', x + 26, y, w - 26, h - 26);
  const pts = g.panels.flatMap((p) => p.points);
  if (!pts.length) return;
  const x0 = Math.min(...pts.map((p) => p[0])) + x + 26;
  const x1 = Math.max(...pts.map((p) => p[0])) + x + 26;
  const y0 = Math.min(...pts.map((p) => p[1])) + y;
  const y1 = Math.max(...pts.map((p) => p[1])) + y;
  const dim = { stroke: '#6b6257', width: 0.6 };
  const dy = y1 + 14;
  page.line(x0, dy, x1, dy, dim);
  page.line(x0, y1 + 3, x0, dy + 4, dim);
  page.line(x1, y1 + 3, x1, dy + 4, dim);
  page.text((x0 + x1) / 2, dy - 3, `${mmText(size[0])} mm`, { size: 7.5, align: 'center', color: INK });
  const dx = x0 - 14;
  page.line(dx, y0, dx, y1, dim);
  page.line(dx - 4, y0, x0 - 3, y0, dim);
  page.line(dx - 4, y1, x0 - 3, y1, dim);
  page.text(dx - 4, (y0 + y1) / 2 + 3, `${mmText(size[1])}`, { size: 7.5, align: 'right', color: INK });
}

/** Tabela do orçamento (seções, linhas, custo, margem e total). */
function quoteTable(f: Flow, q: Quote, notes = true) {
  const cols = { qty: RIGHT - 170, unit: RIGHT - 82, total: RIGHT };
  const head = () => {
    f.page.rect(MARGIN, f.y, WIDTH, 18, { fill: SOFT });
    f.page.text(MARGIN + 6, f.y + 12, 'Item', { size: 8, bold: true, color: MUTED });
    f.page.text(cols.qty, f.y + 12, 'Qtd.', { size: 8, bold: true, color: MUTED, align: 'right' });
    f.page.text(cols.unit, f.y + 12, 'Unitário', { size: 8, bold: true, color: MUTED, align: 'right' });
    f.page.text(cols.total - 6, f.y + 12, 'Total', { size: 8, bold: true, color: MUTED, align: 'right' });
    f.y += 22;
  };
  head();
  for (const s of QUOTE_SECTIONS) {
    const lines = q.lines.filter((l) => l.section === s);
    if (!lines.length) continue;
    if (f.need(40)) head();
    const total = lines.reduce((a, l) => a + l.total, 0);
    f.page.text(MARGIN + 6, f.y + 10, s === 'Outros' ? 'Outros itens' : s, { size: 9, bold: true });
    f.page.text(cols.total - 6, f.y + 10, money(total), { size: 9, bold: true, align: 'right' });
    f.y += 16;
    for (const l of lines) {
      const note = [l.computedQty !== undefined ? `ajustado à mão (calculado: ${quantity(l.computedQty)})` : '', notes ? (l.note ?? '') : '']
        .filter(Boolean)
        .join(' · ');
      const h = note ? 24 : 15;
      if (f.need(h)) head();
      f.page.text(MARGIN + 14, f.y + 9, l.label, { size: 8.5, maxWidth: cols.qty - MARGIN - 80 });
      f.page.text(cols.qty, f.y + 9, `${quantity(l.qty)} ${l.unit}`, { size: 8.5, align: 'right' });
      f.page.text(cols.unit, f.y + 9, money(l.unitPrice), { size: 8.5, align: 'right', color: MUTED });
      f.page.text(cols.total - 6, f.y + 9, money(l.total), { size: 8.5, align: 'right' });
      if (note) f.page.text(MARGIN + 14, f.y + 19, note, { size: 7, color: FAINT, maxWidth: cols.qty - MARGIN - 30 });
      f.y += h;
      f.page.line(MARGIN + 14, f.y - 3, RIGHT, f.y - 3, { stroke: LINE, width: 0.4 });
    }
    f.y += 4;
  }
  f.need(64);
  f.y += 4;
  const row = (label: string, value: string, strong = false) => {
    f.page.text(cols.unit, f.y + 10, label, { size: strong ? 11 : 9, bold: strong, align: 'right', color: strong ? INK : MUTED });
    f.page.text(cols.total - 6, f.y + 10, value, { size: strong ? 12 : 9, bold: strong, align: 'right', color: strong ? ACCENT : INK });
    f.y += strong ? 20 : 15;
  };
  row('Custo', money(q.cost));
  row('Margem', money(q.marginValue));
  f.page.line(cols.qty - 40, f.y + 1, RIGHT, f.y + 1, { stroke: INK, width: 0.8 });
  f.y += 4;
  row('Total estimado', money(q.total), true);
  if (q.removed.length)
    f.paragraph(`Fora deste orçamento (tirado à mão): ${q.removed.map((l) => l.label).join(', ')}.`, 7.5, FAINT);
}

/** Uma chapa em escala, com as peças numeradas, e a legenda ao lado. */
function sheetBlock(f: Flow, plan: CutPlan, s: CutSheet) {
  const dw = 300;
  const scale = dw / plan.spec.length;
  const dh = plan.spec.width * scale;
  const rowH = 9.4;
  const perCol = Math.max(1, Math.floor(dh / rowH));
  const cols = Math.ceil(s.placements.length / perCol);
  const legendW = WIDTH - dw - 16;
  const colW = cols > 1 ? legendW / Math.min(cols, 2) : legendW;
  const rowsShown = Math.min(s.placements.length, perCol * 2);
  const extra = s.placements.length - rowsShown;
  const h = 22 + Math.max(dh, Math.min(rowsShown, perCol) * rowH) + (extra > 0 ? 12 : 0) + 14;
  f.need(h);
  const ofMaterial = plan.groups.find((g) => g.key === s.key)?.sheets ?? 1;
  f.page.text(MARGIN, f.y + 10, `${s.material} · ${s.thickness} mm`, { size: 9.5, bold: true });
  f.page.text(RIGHT, f.y + 10, `chapa ${s.index} de ${ofMaterial} · ${s.placements.length} ${s.placements.length === 1 ? 'peça' : 'peças'} · ${pct(s.efficiency)} usada`, {
    size: 8,
    color: MUTED,
    align: 'right',
  });
  const top = f.y + 18;
  const x0 = MARGIN;
  f.page.rect(x0, top, dw, dh, { fill: '#efeae1', stroke: '#9a8f7e', width: 0.6 });
  const trim = plan.spec.trim * scale;
  f.page.rect(x0 + trim, top + trim, dw - 2 * trim, dh - 2 * trim, { stroke: '#b9ae9c', width: 0.4, dash: [2, 2] });
  for (const o of s.offcuts)
    f.page.rect(x0 + o.x * scale, top + o.y * scale, o.w * scale, o.h * scale, { fill: '#ffffff', stroke: '#c9bfae', width: 0.4, dash: [1.5, 1.5] });
  const fill = lighten(tone(s.materialId), 0.35);
  for (const p of s.placements) {
    const px = x0 + p.x * scale,
      py = top + p.y * scale,
      pw = p.w * scale,
      ph = p.h * scale;
    f.page.rect(px, py, pw, ph, { fill, stroke: '#3a342c', width: 0.45 });
    const size = Math.min(7, ph * 0.7, pw * 0.45);
    if (size >= 3.2) f.page.text(px + pw / 2, py + ph / 2 + size * 0.35, String(p.n), { size, bold: true, align: 'center', color: INK });
  }
  const lx = MARGIN + dw + 16;
  s.placements.slice(0, rowsShown).forEach((p, i) => {
    const c = Math.floor(i / perCol);
    const r = i % perCol;
    const x = lx + c * colW;
    const y = top + r * rowH + 7;
    f.page.text(x, y, String(p.n), { size: 7, bold: true, color: ACCENT });
    f.page.text(x + 14, y, `${shortName(p.name)}${p.rotated ? ' *' : ''}`, { size: 7, maxWidth: colW - 70 });
    f.page.text(x + colW - 4, y, `${mmText(p.w)} × ${mmText(p.h)}`, { size: 7, align: 'right', color: MUTED });
  });
  f.y = top + Math.max(dh, Math.min(rowsShown, perCol) * rowH);
  if (extra > 0) {
    f.page.text(lx, f.y + 9, `… e mais ${extra} peças (lista completa no CSV do plano de corte).`, { size: 7, color: FAINT });
    f.y += 12;
  }
  f.y += 14;
}

/** PDF do projeto: capa com o desenho, orçamento, lista de peças e chapas. */
export function projectPdf(input: PdfInput): PdfResult {
  const { name, revision, date, quote: q } = input;
  const doc = new PdfDoc({ title: `${name} · projeto v${revision}`, author: 'Merce', subject: 'Projeto de marcenaria' });
  const cover = doc.page();
  cover.text(MARGIN, MARGIN + 8, 'merce.', { size: 15, bold: true, color: ACCENT });
  cover.text(RIGHT, MARGIN + 8, `Projeto de marcenaria · versão ${revision} · ${dateText(date)}`, { size: 9, color: MUTED, align: 'right' });
  const titleLines = wrapText(name, 26, WIDTH, 'bold').slice(0, 2);
  let y = MARGIN + 56;
  for (const l of titleLines) {
    cover.text(MARGIN, y, l, { size: 26, bold: true });
    y += 30;
  }
  const [w, h, d] = input.size;
  cover.text(
    MARGIN,
    y,
    `${cmText(w)} × ${cmText(h)} × ${cmText(d)} cm (L × A × P) · ${input.modules} ${input.modules === 1 ? 'módulo' : 'módulos'} · ${input.parts.length} ${input.parts.length === 1 ? 'peça' : 'peças'}`,
    { size: 10.5, color: MUTED },
  );
  y += 18;
  cover.rect(MARGIN, y, WIDTH, 300, { fill: SOFT });
  drawFurniture(cover, input.drawing, 'iso', MARGIN, y, WIDTH, 300);
  y += 318;
  cover.rect(MARGIN, y, 300, 230, { stroke: LINE, width: 0.6 });
  frontWithDims(cover, input.drawing, input.size, MARGIN + 6, y + 8, 288, 214);
  cover.text(MARGIN, y + 244, 'Vista frontal, frentes fechadas · medidas em mm', { size: 7.5, color: FAINT });
  const fx = MARGIN + 320;
  let fy = y + 8;
  const fact = (label: string, value: string) => {
    cover.text(fx, fy + 8, label.toUpperCase(), { size: 7, bold: true, color: FAINT });
    cover.text(fx, fy + 22, value, { size: 11, bold: true });
    fy += 32;
  };
  fact('Largura', `${mmText(w)} mm`);
  fact('Altura', `${mmText(h)} mm`);
  fact('Profundidade', `${mmText(d)} mm`);
  cover.text(fx, fy + 8, 'CHAPAS', { size: 7, bold: true, color: FAINT });
  fy += 12;
  for (const g of q.plan.groups.slice(0, 5)) {
    cover.rect(fx, fy + 3, 7, 7, { fill: tone(g.materialId), stroke: '#8d7a5c', width: 0.4 });
    cover.text(fx + 12, fy + 10, `${g.material} ${g.thickness} mm`, { size: 8.5, maxWidth: RIGHT - fx - 40 });
    cover.text(RIGHT, fy + 10, `${g.sheets}×`, { size: 8.5, bold: true, align: 'right' });
    fy += 13;
  }
  if (q.plan.groups.length > 5) {
    cover.text(fx + 12, fy + 10, `+ ${q.plan.groups.length - 5} materiais`, { size: 8, color: MUTED });
    fy += 13;
  }
  fy += 8;
  cover.rect(fx, fy, RIGHT - fx, 44, { fill: '#e4efe7' });
  cover.text(fx + 10, fy + 15, 'ESTIMATIVA', { size: 7, bold: true, color: ACCENT });
  cover.text(fx + 10, fy + 34, money(q.total), { size: 16, bold: true, color: ACCENT });

  const running = `${name} · versão ${revision} · ${dateText(date)}`;
  const f = new Flow(doc, running);
  f.section('01', 'Orçamento estimado');
  quoteTable(f, q);
  f.y += 10;
  f.section('02', 'Lista de peças');
  const rows = groupParts(input.parts);
  const order = (material: string) => {
    const i = q.plan.groups.findIndex((g) => g.key === material);
    return i < 0 ? q.plan.groups.length : i;
  };
  const byMaterial = [...new Set(rows.map((r) => r.material))].sort((a, b) => order(a) - order(b));
  const pcols = { qty: RIGHT - 190, dims: RIGHT - 70, area: RIGHT };
  const phead = () => {
    f.page.rect(MARGIN, f.y, WIDTH, 18, { fill: SOFT });
    f.page.text(MARGIN + 6, f.y + 12, 'Peça', { size: 8, bold: true, color: MUTED });
    f.page.text(pcols.qty, f.y + 12, 'Qtd.', { size: 8, bold: true, color: MUTED, align: 'right' });
    f.page.text(pcols.dims, f.y + 12, 'C × L × E (mm)', { size: 8, bold: true, color: MUTED, align: 'right' });
    f.page.text(pcols.area - 6, f.y + 12, 'Área (m²)', { size: 8, bold: true, color: MUTED, align: 'right' });
    f.y += 22;
  };
  phead();
  for (const material of byMaterial) {
    const list = rows.filter((r) => r.material === material);
    if (f.need(34)) phead();
    f.page.text(MARGIN + 6, f.y + 10, material, { size: 9, bold: true, maxWidth: pcols.qty - MARGIN - 60 });
    const count = list.reduce((a, r) => a + r.count, 0);
    f.page.text(pcols.dims, f.y + 10, `${count} ${count === 1 ? 'peça' : 'peças'}`, { size: 8.5, align: 'right', color: MUTED });
    f.page.text(pcols.area - 6, f.y + 10, m2(list.reduce((a, r) => a + r.area, 0)), { size: 8.5, bold: true, align: 'right' });
    f.y += 16;
    for (const r of list) {
      if (f.need(14)) phead();
      f.page.text(MARGIN + 14, f.y + 9, r.name, { size: 8.5, maxWidth: pcols.qty - MARGIN - 40 });
      f.page.text(pcols.qty, f.y + 9, String(r.count), { size: 8.5, align: 'right' });
      f.page.text(pcols.dims, f.y + 9, `${mmText(r.c)} × ${mmText(r.l)} × ${mmText(r.thickness)}`, { size: 8.5, align: 'right' });
      f.page.text(pcols.area - 6, f.y + 9, m2(r.area), { size: 8.5, align: 'right', color: MUTED });
      f.y += 13;
    }
    f.y += 4;
  }
  f.y += 10;
  f.section('03', 'Plano de corte');
  const plan = q.plan;
  f.paragraph(
    `Chapa ${plan.spec.length} × ${plan.spec.width} mm, disco de ${plan.spec.kerf} mm, refilo de ${plan.spec.trim} mm. Cortes em guilhotina; madeira com o veio no comprimento da chapa. Os números nas peças são os mesmos da aba Corte e do CSV. Área tracejada branca: sobra com os dois lados de 15 cm ou mais. * peça girada na chapa.`,
  );
  for (const g of plan.groups) {
    f.need(14);
    f.page.rect(MARGIN, f.y + 2, 7, 7, { fill: tone(g.materialId), stroke: '#8d7a5c', width: 0.4 });
    f.page.text(MARGIN + 12, f.y + 9, `${g.material} · ${g.thickness} mm`, { size: 8.5, maxWidth: 220 });
    f.page.text(RIGHT - 190, f.y + 9, `${g.sheets} ${g.sheets === 1 ? 'chapa' : 'chapas'}`, { size: 8.5, align: 'right' });
    f.page.text(RIGHT - 110, f.y + 9, `${g.parts} ${g.parts === 1 ? 'peça' : 'peças'}`, { size: 8.5, align: 'right', color: MUTED });
    f.page.text(RIGHT, f.y + 9, `${pct(g.efficiency)} aproveitado`, { size: 8.5, align: 'right', color: MUTED });
    f.y += 13;
  }
  if (plan.oversize.length)
    f.paragraph(`Fora da chapa (precisa de emenda ou chapa maior): ${plan.oversize.map((o) => `${o.name} (${o.c} × ${o.l})`).join(', ')}.`, 8, '#b3412e');
  f.y += 8;
  for (const s of plan.sheets) sheetBlock(f, plan, s);
  f.paragraph(
    'Desenho de revisão gerado no Merce. Sem furação, fixações ou certificação estrutural. Conferir medidas, materiais, bordas e estabilidade antes de produzir.',
    7.5,
    FAINT,
  );
  footers(doc, `merce. · ${name} · versão ${revision}`);
  return {
    bytes: doc.bytes(date),
    pages: doc.pages.length,
    svg: doc.pages.map((pg) => pg.toSvg()),
    description: `Desenho, orçamento de ${money(q.total)}, ${input.parts.length} peças e ${plan.sheets.length} ${plan.sheets.length === 1 ? 'chapa' : 'chapas'}`,
  };
}

/** PDF do orçamento: a proposta para o cliente, com o desenho pequeno. */
export function quotePdf(input: PdfInput): PdfResult {
  const { name, revision, date, quote: q } = input;
  const doc = new PdfDoc({ title: `Orçamento · ${name} · v${revision}`, author: 'Merce', subject: 'Orçamento de marcenaria' });
  const page = doc.page();
  page.text(MARGIN, MARGIN + 8, 'merce.', { size: 15, bold: true, color: ACCENT });
  page.text(RIGHT, MARGIN + 8, `Orçamento · versão ${revision} do projeto · ${dateText(date)}`, { size: 9, color: MUTED, align: 'right' });
  const boxW = 190,
    boxH = 150;
  page.rect(RIGHT - boxW, MARGIN + 30, boxW, boxH, { fill: SOFT });
  drawFurniture(page, input.drawing, 'iso', RIGHT - boxW, MARGIN + 30, boxW, boxH);
  page.text(MARGIN, MARGIN + 52, 'Orçamento', { size: 26, bold: true });
  const titleW = WIDTH - boxW - 20;
  let y = MARGIN + 74;
  for (const l of wrapText(name, 14, titleW, 'bold').slice(0, 2)) {
    page.text(MARGIN, y, l, { size: 14, bold: true, color: INK });
    y += 18;
  }
  const [w, h, d] = input.size;
  page.text(MARGIN, y + 2, `${cmText(w)} × ${cmText(h)} × ${cmText(d)} cm (L × A × P)`, { size: 9.5, color: MUTED });
  page.text(MARGIN, y + 16, `${input.modules} ${input.modules === 1 ? 'módulo' : 'módulos'} · ${input.parts.length} peças · ${q.counts.sheets} ${q.counts.sheets === 1 ? 'chapa' : 'chapas'}`, {
    size: 9.5,
    color: MUTED,
  });
  page.rect(MARGIN, y + 30, 170, 46, { fill: '#e4efe7' });
  page.text(MARGIN + 10, y + 45, 'TOTAL ESTIMADO', { size: 7, bold: true, color: ACCENT });
  page.text(MARGIN + 10, y + 66, money(q.total), { size: 17, bold: true, color: ACCENT });
  const f = new Flow(doc, `Orçamento · ${name} · versão ${revision}`, page, MARGIN + 30 + boxH + 24);
  quoteTable(f, q, false);
  f.y += 12;
  f.paragraph(
    'Estimativa para conversa inicial: chapas contadas pelo plano de corte, fita de borda, ferragens e mão de obra pela tabela de preços do estúdio. Não inclui frete, instalação nem impostos, a não ser quando aparecem como item. Confirme medidas, materiais e ferragens antes de fechar.',
    8,
  );
  footers(doc, `merce. · Orçamento · ${name} · versão ${revision}`);
  return {
    bytes: doc.bytes(date),
    pages: doc.pages.length,
    svg: doc.pages.map((pg) => pg.toSvg()),
    description: `${q.lines.length} itens, total de ${money(q.total)}${q.adjusted ? `, ${q.adjusted} ${q.adjusted === 1 ? 'ajuste' : 'ajustes'} à mão` : ''}`,
  };
}
