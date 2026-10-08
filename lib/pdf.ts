/**
 * PDF vetorial mínimo, sem dependência: texto em Helvetica (as 14 fontes que
 * todo leitor de PDF tem), linhas, retângulos e polígonos. Roda igual no Node
 * e no Worker da Cloudflare, sem canvas nem navegador, então o arquivo sai do
 * servidor a partir da versão gravada e fica guardado como foi gerado.
 *
 * O texto vai em WinAnsi (Latin-1 com aspas e traços): cobre o português
 * inteiro. O que não existe nessa tabela vira um equivalente simples.
 *
 * Coordenadas da API em pontos, com a origem no canto de cima à esquerda
 * (como na tela); o PDF usa a de baixo, e a conversão fica aqui dentro.
 */

/** A4 em pontos. */
export const A4 = { width: 595.28, height: 841.89 } as const;

type FontId = 'regular' | 'bold';

/** Larguras (1/1000 do corpo) dos caracteres 32 a 126 da Helvetica. */
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** O mesmo para a Helvetica-Bold. */
const HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Caracteres fora do Latin-1 que o WinAnsi tem em 128..159. */
const WIN_EXTRA: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};
/** O que não tem no WinAnsi e tem um equivalente claro. */
const SUBSTITUTE: Record<string, string> = {
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  '↻': '*',
  '→': '>',
  '←': '<',
  '✓': 'v',
  '≈': '~',
};

/** Letra base de cada acentuado do Latin-1: a largura é a mesma. */
const BASE: Record<number, string> = {};
for (const [base, list] of Object.entries({
  A: 'ÀÁÂÃÄÅ',
  C: 'Ç',
  E: 'ÈÉÊË',
  I: 'ÌÍÎÏ',
  N: 'Ñ',
  O: 'ÒÓÔÕÖØ',
  U: 'ÙÚÛÜ',
  Y: 'Ý',
  a: 'àáâãäå',
  c: 'ç',
  e: 'èéêë',
  i: 'ìíîï',
  n: 'ñ',
  o: 'òóôõöø',
  u: 'ùúûü',
  y: 'ýÿ',
}))
  for (const ch of list) BASE[ch.charCodeAt(0)] = base;

/** Larguras dos códigos 128..255 que não são letra acentuada. */
const HIGH: Record<number, [number, number]> = {
  0x80: [556, 556],
  0x82: [222, 278],
  0x84: [333, 500],
  0x85: [1000, 1000],
  0x91: [222, 278],
  0x92: [222, 278],
  0x93: [333, 500],
  0x94: [333, 500],
  0x95: [350, 350],
  0x96: [556, 556],
  0x97: [1000, 1000],
  0xa0: [278, 278],
  0xa7: [556, 556],
  0xaa: [370, 370],
  0xb0: [400, 400],
  0xb2: [333, 333],
  0xb3: [333, 333],
  0xb7: [278, 278],
  0xba: [365, 365],
  0xd7: [584, 584],
  0xdf: [611, 611],
};

/** Texto em bytes WinAnsi. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.normalize('NFC')) {
    const ch = SUBSTITUTE[raw] ?? raw;
    for (const c of ch) {
      const code = c.charCodeAt(0);
      if (WIN_EXTRA[c] !== undefined) out.push(WIN_EXTRA[c]);
      else if (code === 9 || code === 10 || code === 13) out.push(32);
      else if (code >= 32 && code <= 126) out.push(code);
      else if (code >= 160 && code <= 255) out.push(code);
      else out.push(63);
    }
  }
  return out;
}

function charWidth(code: number, font: FontId) {
  const table = font === 'bold' ? HELV_BOLD : HELV;
  if (code >= 32 && code <= 126) return table[code - 32];
  const base = BASE[code];
  if (base) return table[base.charCodeAt(0) - 32];
  const high = HIGH[code];
  return high ? high[font === 'bold' ? 1 : 0] : 556;
}

/** Largura do texto em pontos. */
export function textWidth(text: string, size: number, font: FontId = 'regular') {
  return (winAnsi(text).reduce((a, c) => a + charWidth(c, font), 0) * size) / 1000;
}

/** Corta o texto para caber em `max` pontos, com reticências. */
export function fitText(text: string, size: number, max: number, font: FontId = 'regular') {
  if (textWidth(text, size, font) <= max) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(text.slice(0, mid).trimEnd() + '…', size, font) <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/** Quebra em linhas que cabem em `max` pontos, pelas palavras. */
export function wrapText(text: string, size: number, max: number, font: FontId = 'regular') {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, font) <= max || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.map((l) => fitText(l, size, max, font));
}

function pdfString(text: string) {
  let out = '(';
  for (const code of winAnsi(text)) {
    if (code === 40 || code === 41 || code === 92) out += '\\' + String.fromCharCode(code);
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out + ')';
}

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** "#a1b2c3" ou "#abc" → "r g b" de 0 a 1. */
function rgb(hex: string) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.slice(0, 6);
  const v = Number.parseInt(full, 16);
  if (Number.isNaN(v)) return '0 0 0';
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => n(c / 255)).join(' ');
}

export type TextOptions = {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'right' | 'center';
  /** Corta com reticências para não passar desta largura. */
  maxWidth?: number;
};
export type ShapeOptions = {
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: number[];
  /** Opacidade do preenchimento (0 a 1). */
  opacity?: number;
};

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class PdfPage {
  readonly ops: string[] = [];
  /**
   * A mesma página em SVG, desenhada junto: a prévia na conversa e a
   * miniatura do cartão não dependem do leitor de PDF do navegador.
   */
  readonly svg: string[] = [];
  private alphas = new Set<number>();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  private y(top: number) {
    return this.height - top;
  }
  /** Texto com a linha de base em `y` (do topo). Devolve a largura escrita. */
  text(x: number, y: number, value: string, o: TextOptions = {}) {
    const size = o.size ?? 10;
    const font: FontId = o.bold ? 'bold' : 'regular';
    const text = o.maxWidth ? fitText(value, size, o.maxWidth, font) : value;
    const w = textWidth(text, size, font);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.ops.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${n(size)} Tf ${rgb(o.color ?? '#1d211e')} rg ${n(left)} ${n(this.y(y))} Td ${pdfString(text)} Tj ET`,
    );
    const anchor = o.align === 'right' ? 'end' : o.align === 'center' ? 'middle' : 'start';
    this.svg.push(
      `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}"${font === 'bold' ? ' font-weight="700"' : ''} fill="${o.color ?? '#1d211e'}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}>${esc(text)}</text>`,
    );
    return w;
  }
  private style(o: ShapeOptions) {
    const parts: string[] = [];
    if (o.opacity !== undefined && o.opacity < 1) {
      const a = Math.round(o.opacity * 100);
      this.alphas.add(a);
      parts.push(`/GA${a} gs`);
    }
    if (o.fill) parts.push(`${rgb(o.fill)} rg`);
    if (o.stroke) parts.push(`${rgb(o.stroke)} RG ${n(o.width ?? 0.5)} w`);
    parts.push(o.dash?.length ? `[${o.dash.map(n).join(' ')}] 0 d` : '[] 0 d');
    return parts.join(' ');
  }
  private paint(o: ShapeOptions) {
    return o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
  }
  /** Atributos SVG do mesmo estilo. */
  private svgStyle(o: ShapeOptions) {
    return [
      `fill="${o.fill ?? 'none'}"`,
      o.opacity !== undefined && o.opacity < 1 ? `fill-opacity="${n(o.opacity)}"` : '',
      o.stroke ? `stroke="${o.stroke}" stroke-width="${n(o.width ?? 0.5)}"` : '',
      o.dash?.length ? `stroke-dasharray="${o.dash.map(n).join(' ')}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  rect(x: number, y: number, w: number, h: number, o: ShapeOptions = { stroke: '#000' }) {
    this.ops.push(`q ${this.style(o)} ${n(x)} ${n(this.y(y + h))} ${n(w)} ${n(h)} re ${this.paint(o)} Q`);
    this.svg.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${this.svgStyle(o)}/>`);
  }
  line(x1: number, y1: number, x2: number, y2: number, o: ShapeOptions = { stroke: '#000' }) {
    this.ops.push(`q ${this.style({ ...o, fill: undefined })} ${n(x1)} ${n(this.y(y1))} m ${n(x2)} ${n(this.y(y2))} l S Q`);
    this.svg.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${this.svgStyle({ ...o, fill: undefined })}/>`);
  }
  polygon(points: readonly (readonly [number, number])[], o: ShapeOptions) {
    if (points.length < 2) return;
    const path = points.map((p, i) => `${n(p[0])} ${n(this.y(p[1]))} ${i ? 'l' : 'm'}`).join(' ');
    this.ops.push(`q 1 j ${this.style(o)} ${path} h ${this.paint(o)} Q`);
    this.svg.push(`<polygon points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" stroke-linejoin="round" ${this.svgStyle(o)}/>`);
  }
  /** A página inteira em SVG, no tamanho do papel (pontos). */
  toSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(this.width)} ${n(this.height)}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>${this.svg.join('')}</svg>`;
  }
  /** Opacidades usadas na página (recursos ExtGState). */
  get alphaLevels() {
    return [...this.alphas];
  }
}

export class PdfDoc {
  readonly pages: PdfPage[] = [];
  constructor(
    readonly info: { title: string; author?: string; subject?: string } = { title: 'Documento' },
    readonly size: { width: number; height: number } = A4,
  ) {}
  page() {
    const p = new PdfPage(this.size.width, this.size.height);
    this.pages.push(p);
    return p;
  }
  /** Bytes do arquivo. Fluxos sem compressão: o texto continua legível no arquivo. */
  bytes(created = new Date()): Uint8Array {
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add('');
    const pagesId = add('');
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    for (const page of this.pages) {
      const content = page.ops.join('\n');
      const stream = add(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
      const alphas = page.alphaLevels.map((a) => `/GA${a} << /Type /ExtGState /ca ${n(a / 100)} /CA ${n(a / 100)} >>`).join(' ');
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(this.size.width)} ${n(this.size.height)}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${alphas ? ` /ExtGState << ${alphas} >>` : ''} >> /Contents ${stream} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const stamp = pdfDate(created);
    const info = add(
      `<< /Title ${pdfString(this.info.title)}${this.info.author ? ` /Author ${pdfString(this.info.author)}` : ''}${this.info.subject ? ` /Subject ${pdfString(this.info.subject)}` : ''} /Producer (Merce) /CreationDate (${stamp}) >>`,
    );
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    let length = byteLength(out);
    const chunks = [out];
    objects.forEach((body, i) => {
      offsets.push(length);
      const chunk = `${i + 1} 0 obj\n${body}\nendobj\n`;
      chunks.push(chunk);
      length += byteLength(chunk);
    });
    const xref = length;
    out = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    chunks.push(out);
    return latin1(chunks.join(''));
  }
}

/** O arquivo inteiro é ASCII, menos os 4 bytes binários do cabeçalho (latin-1). */
function latin1(text: string) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
  return bytes;
}
function byteLength(text: string) {
  return text.length;
}
function pdfDate(d: Date) {
  const p = (v: number) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
