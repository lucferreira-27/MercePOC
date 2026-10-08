import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, get, reviseQuote, save, undo, revise, type Message } from '../lib/store';
import { DEFAULT_PRICES, quoteOf, adjustQuote, cleanAdjust } from '../lib/quote';
import { canonical } from '../lib/studio';
import { exportFile } from '../lib/exports';
import { PdfDoc, fitText, textWidth, winAnsi } from '../lib/pdf';
import { addExtra, draftChanges, draftLabel, setQty, setRemoved } from '../lib/quote-draft';
import { blocksForPrompt, fileName, type FileBlock, type WidgetBlock } from '../lib/rich';
import { fileBytes, fileMeta, makeFileBlock } from '../lib/files';
import { runAgentTurn } from '../lib/agent/turn';
import type { ChatMessage, ModelReply, ToolCall } from '../lib/agent/model';

process.env.MERCE_DATA_DIR = mkdtempSync(join(tmpdir(), 'merce-rich-'));
process.env.MERCE_JEV = '0';

const decoder = new TextDecoder('latin1');

// ------------------------------------------------------------------ PDF
void test('PDF: estrutura válida, xref nos lugares certos e acentos em WinAnsi', () => {
  const doc = new PdfDoc({ title: 'Orçamento · Rack' });
  const page = doc.page();
  page.text(40, 60, 'Ação, coração e pé: R$ 1.234,56 — ok', { size: 12, bold: true });
  page.rect(40, 80, 100, 50, { fill: '#e4efe7', stroke: '#2f6b4f' });
  page.polygon(
    [
      [10, 10],
      [30, 10],
      [20, 30],
    ],
    { fill: '#bd925c', opacity: 0.5 },
  );
  doc.page().line(0, 0, 100, 100, { stroke: '#000', dash: [2, 2] });
  const bytes = doc.bytes(new Date('2026-10-08T12:00:00Z'));
  const text = decoder.decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  // Cada entrada do xref aponta para o começo do objeto de mesmo número.
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
  const table = text.slice(xrefAt).split('\n');
  const count = Number(table[1].split(' ')[1]);
  for (let i = 1; i < count; i++) {
    const offset = Number(table[2 + i].slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${i} 0 obj`), `objeto ${i}`);
  }
  // "ç" e "ã" vão como octal do WinAnsi, "—" como 0x97.
  assert.match(text, /A\\347\\343o/);
  assert.match(text, /\\227/);
  assert.match(text, /\/GA50 gs/);
  assert.deepEqual(winAnsi('é−'), [0xe9, 45]);
  assert.ok(textWidth('WWW', 10) > textWidth('iii', 10));
  assert.ok(textWidth('Orçamento longo demais', 9).toFixed(1) !== '0.0');
  assert.ok(fitText('Um nome de projeto bem comprido demais', 10, 80).endsWith('…'));
  // A mesma página em SVG, com o texto escapado.
  const svg = doc.pages[0].toSvg();
  assert.match(svg, /^<svg/);
  assert.match(svg, /R\$ 1\.234,56/);
});

function demoProject() {
  const p = get(create().id);
  return p;
}

void test('arquivos do estúdio: PDF do projeto, PDF do orçamento, CSVs e JSON da versão', () => {
  const p = demoProject();
  const rev = p.revisions[p.cursor];
  rev.quote = { lines: { 'Mão de obra|Montagem': { removed: true } }, extras: [{ id: 'frete', label: 'Frete e entrega', qty: 1, unit: 'un', unitPrice: 180 }] };
  const project = exportFile('pdf', { project: p, index: p.cursor, prices: DEFAULT_PRICES });
  assert.ok(project.pages! >= 3, 'capa, orçamento e peças, chapas');
  assert.equal(project.svg?.length, project.pages);
  const quotePdf = exportFile('quote-pdf', { project: p, index: p.cursor, prices: DEFAULT_PRICES });
  const body = decoder.decode(quotePdf.bytes);
  assert.match(body, /Frete e entrega/);
  assert.ok(body.includes('(tirado \\340 m\\343o\\): Montagem'), 'linha tirada à mão aparece fora do orçamento');
  assert.match(quotePdf.description, /2 ajustes à mão/);
  // O total do PDF é o mesmo da conta com os ajustes.
  const q = quoteOf(canonical(rev.params), DEFAULT_PRICES, rev.quote);
  assert.ok(body.includes(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(q.total).replace(/ /g, '\\240')));
  const cut = new TextDecoder('utf-8', { ignoreBOM: true }).decode(exportFile('cut-csv', { project: p, index: p.cursor, prices: DEFAULT_PRICES }).bytes);
  assert.match(cut, /^﻿"Nº";"Chapa"/);
  const json = JSON.parse(new TextDecoder().decode(exportFile('json', { project: p, index: p.cursor, prices: DEFAULT_PRICES }).bytes));
  assert.equal(json.resumo.orcamentoEstimado, q.total);
  assert.throws(() => exportFile('png', { project: p, index: p.cursor, prices: DEFAULT_PRICES }), /navegador/);
  assert.equal(fileName('Rack de TV · Sala', 'quote-pdf', 5, 2), 'rack-de-tv-sala-orcamento-v5-2.pdf');
});

// ------------------------------------------------------------------ orçamento à mão
void test('orçamento à mão: tirar linha, trocar quantidade e item à parte refazem o total', () => {
  const p = demoProject();
  const d = canonical(p.revisions[p.cursor].params);
  const base = quoteOf(d, DEFAULT_PRICES);
  const labour = base.lines.find((l) => l.label === 'Montagem')!;
  const handle = base.lines.find((l) => l.label === 'Kit de montagem')!;
  const adj = { lines: { [labour.key!]: { removed: true }, [handle.key!]: { qty: handle.qty + 3 } }, extras: [{ id: 'frete', label: 'Frete', qty: 2, unit: 'un', unitPrice: 50 }] };
  const q = adjustQuote(base, adj, DEFAULT_PRICES.margin);
  assert.equal(q.adjusted, 3);
  assert.deepEqual(q.removed.map((l) => l.label), ['Montagem']);
  const kit = q.lines.find((l) => l.key === handle.key)!;
  assert.equal(kit.qty, handle.qty + 3);
  assert.equal(kit.computedQty, handle.qty);
  assert.ok(q.lines.some((l) => l.extra === 'frete' && l.total === 100 && l.section === 'Outros'));
  const cost = Math.round((base.cost - labour.total + 3 * handle.unitPrice + 100) * 100) / 100;
  assert.equal(q.cost, cost);
  assert.equal(q.total, Math.round((cost + Math.round(cost * DEFAULT_PRICES.margin) / 100) * 100) / 100);
  // Ajuste vazio não fica guardado.
  assert.equal(cleanAdjust({ lines: { x: {} }, extras: [] }), undefined);
});

void test('ajuste do orçamento vira versão com o mesmo móvel, segue nas versões seguintes e desfaz', () => {
  const p = demoProject();
  const before = p.revisions.length;
  const first = reviseQuote(p, { lines: { 'Mão de obra|Montagem': { removed: true } } }, 'Orçamento: tirou Montagem');
  assert.equal(first.noop, false);
  assert.equal(p.revisions.length, before + 1);
  assert.equal(p.revisions[p.cursor].params, p.revisions[p.cursor - 1].params);
  assert.deepEqual(p.revisions[p.cursor].quote, { lines: { 'Mão de obra|Montagem': { removed: true } } });
  assert.equal(reviseQuote(p, { lines: { 'Mão de obra|Montagem': { removed: true } } }, 'de novo').noop, true);
  // Mudar o móvel depois mantém o ajuste.
  revise(p, p.revisions[p.cursor].params, 'Mudou o móvel');
  assert.deepEqual(p.revisions[p.cursor].quote, { lines: { 'Mão de obra|Montagem': { removed: true } } });
  undo(p);
  undo(p);
  assert.equal(p.revisions[p.cursor].quote, undefined);
});

void test('rascunho do orçamento: operações, contagem de mudanças e rótulo da versão', () => {
  const line = { key: 'Ferragens|Puxador', qty: 4, computedQty: undefined, extra: undefined };
  let draft = setRemoved(undefined, 'Mão de obra|Montagem', true);
  draft = setQty(draft, line, 6);
  draft = addExtra(draft, { label: 'Frete e entrega', qty: 1, unit: 'un', unitPrice: 200 });
  assert.equal(draftChanges(undefined, draft), 3);
  assert.equal(draftLabel(undefined, draft, (k) => k.split('|')[1]), 'Orçamento: tirou Montagem; Puxador 6; + Frete e entrega');
  // Voltar a quantidade para a conta do app apaga o ajuste da linha.
  const back = setQty(draft, { ...line, qty: 6, computedQty: 4 }, 4);
  assert.equal(back?.lines?.['Ferragens|Puxador'], undefined);
  assert.equal(draftChanges(draft, draft), 0);
  assert.equal(setRemoved(setRemoved(undefined, 'a|b', true), 'a|b', false), undefined);
});

// ------------------------------------------------------------------ assistente
let n = 0;
const call = (name: string, args: unknown): ToolCall => ({ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCall[]): ModelReply => ({ content: '', calls, finish: 'tool_calls' });
function scripted(steps: ((seen: ChatMessage[]) => ModelReply)[]) {
  let i = 0;
  return async () => steps[Math.min(i++, steps.length - 1)]([]);
}
function start(request: string, id?: string) {
  const p = get(id ?? create().id);
  const user: Message = {
    id: `u${++n}`,
    role: 'user',
    content: request,
    revisionId: p.revisions[p.cursor].id,
    revision: p.cursor + 1,
    context: { requestId: `r${n}`, baseRevisionId: p.revisions[p.cursor].id, selectedPartIds: [], referencedPartIds: [] },
  };
  p.messages.push(user);
  const version = save(p, p.version).version;
  return { p, user, version };
}
function turn(s: ReturnType<typeof start>, fake: ReturnType<typeof scripted>, request: string) {
  return runAgentTurn({
    project: s.p,
    version: s.version,
    user: s.user,
    request,
    selected: [],
    ui: null,
    prices: structuredClone(DEFAULT_PRICES),
    model: 'deepseek',
    requestId: s.user.context!.requestId,
    started: Date.now(),
    signal: new AbortController().signal,
    progress: () => {},
    emit: () => {},
    onUsage: () => {},
    usage: () => ({}),
    call: fake as never,
  });
}

void test('assistente: cartão do corte na chapa pedida, orçamento ajustado vira versão e o PDF sai anexado', async () => {
  const s = start('Tire a montagem, mostre a chapa 2 e gere o PDF do orçamento');
  const fake = scripted([
    () =>
      reply(
        call('quote_edit', { tirar: ['montagem'] }),
        call('card_show', { cartao: 'corte', chapa: 2 }),
        call('export_file', { formato: 'quote-pdf' }),
      ),
    () => reply(call('finish', { mensagem: 'Tirei a montagem e anexei o PDF do orçamento.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake, 'Tire a montagem, mostre a chapa 2 e gere o PDF do orçamento');
  const p = get(r.projectId);
  const rev = p.revisions[p.cursor];
  assert.deepEqual(rev.quote, { lines: { 'Mão de obra|Montagem': { removed: true } } });
  assert.deepEqual(rev.params, p.revisions[p.cursor - 1].params, 'o móvel não mudou');
  const m = p.messages.at(-1)!;
  const widgets = m.blocks!.filter((b): b is WidgetBlock => b.kind === 'widget');
  assert.deepEqual(widgets.map((w) => w.widget), ['quote', 'cut']);
  assert.equal(widgets.find((w) => w.widget === 'cut')!.sheet, 2);
  assert.deepEqual(widgets.find((w) => w.widget === 'quote')!.focus, ['Mão de obra|Montagem']);
  assert.equal(widgets[0].revisionId, rev.id);
  const file = m.blocks!.find((b): b is FileBlock => b.kind === 'file')!;
  assert.equal(file.status, 'ready');
  assert.equal(file.generation, 1);
  assert.equal(file.file?.pages, 1);
  const meta = await fileMeta(file.file!.id);
  assert.equal(meta.mime, 'application/pdf');
  assert.ok(meta.preview, 'prévia das páginas guardada junto');
  assert.ok(decoder.decode(await fileBytes(file.file!.id)).startsWith('%PDF'));
  // A conversa seguinte vê o cartão e o arquivo ("aquele PDF").
  assert.deepEqual(blocksForPrompt(m.blocks).map((b) => ('arquivo' in b ? b.formato : b.cartao)), ['orçamento', 'plano de corte', 'quote-pdf']);

  // "Atualize aquele PDF": geração 2, o anterior continua e fica substituído.
  const again = start('Atualize aquele PDF', p.id);
  const second = await turn(
    again,
    scripted([() => reply(call('export_file', { formato: 'quote-pdf' })), () => reply(call('finish', { mensagem: 'PDF novo anexado.', sugestoes: [] }))]),
    'Atualize aquele PDF',
  );
  const newer = get(second.projectId).messages.at(-1)!.blocks!.find((b): b is FileBlock => b.kind === 'file')!;
  assert.equal(newer.generation, 2);
  assert.equal(newer.supersedes, file.file!.id);
  assert.match(newer.file!.name, /-orcamento-v\d+-2\.pdf$/);
  assert.ok(get(second.projectId).messages.some((x) => x.blocks?.some((b) => b.kind === 'file' && b.file?.id === file.file!.id)), 'o arquivo antigo continua na conversa');
});

void test('assistente: arquivo que só a página faz (vídeo) nasce pendente; corte inexistente é recusado', async () => {
  const s = start('Grave um vídeo do móvel girando e mostre a chapa 40');
  const fake = scripted([
    () => reply(call('export_file', { formato: 'video' }), call('card_show', { cartao: 'corte', chapa: 40 })),
    () => reply(call('finish', { mensagem: 'Vídeo anexado.', sugestoes: [] })),
  ]);
  const r = await turn(s, fake, 'Grave um vídeo do móvel girando e mostre a chapa 40');
  const m = get(r.projectId).messages.at(-1)!;
  const file = m.blocks!.find((b): b is FileBlock => b.kind === 'file')!;
  assert.equal(file.status, 'pending');
  assert.equal(file.file, null);
  assert.ok(!m.blocks!.some((b) => b.kind === 'widget' && b.widget === 'cut'), 'chapa que não existe não vira cartão');
  assert.ok(m.report?.steps?.some((st) => !st.ok && /não existe a chapa 40/.test(st.detail ?? '')));
});

void test('rota de arquivos: gerar pelo cartão cria mensagem com o arquivo; baixar e metadata', async () => {
  const { POST, GET } = await import('../app/api/files/route');
  const p = demoProject();
  const res = await POST(
    new Request('http://127.0.0.1:4310/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', id: p.id, format: 'cut-csv', prices: DEFAULT_PRICES, from: 'card' }),
    }),
  );
  assert.equal(res.status, 200);
  const state = (await res.json()) as { messages: Message[] };
  const m = state.messages.at(-1)!;
  assert.equal(m.action, 'card');
  const block = m.blocks![0] as FileBlock;
  assert.equal(block.status, 'ready');
  assert.match(m.content, /Plano de corte da versão 1/);
  const meta = await GET(new Request(`http://127.0.0.1:4310/api/files?id=${block.file!.id}&meta=1`));
  assert.equal(((await meta.json()) as { kind: string }).kind, 'spreadsheet');
  const dl = await GET(new Request(`http://127.0.0.1:4310/api/files?id=${block.file!.id}&download=1`));
  assert.match(dl.headers.get('content-disposition') ?? '', /^attachment; filename="/);
  const inline = await GET(new Request(`http://127.0.0.1:4310/api/files?id=${block.file!.id}`));
  assert.match(inline.headers.get('content-disposition') ?? '', /^inline;/);
  const missing = await GET(new Request(`http://127.0.0.1:4310/api/files?id=00000000-0000-4000-8000-000000000000&meta=1`));
  assert.equal(missing.status, 404);
  // Pendente do navegador: a falha fica registrada no cartão.
  const q = get(p.id);
  const pending = await makeFileBlock(q, 'png', DEFAULT_PRICES);
  q.messages.push({ id: 'note-png', role: 'assistant', content: 'Foto', blocks: [pending] });
  save(q, q.version);
  const failed = await POST(
    new Request('http://127.0.0.1:4310/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fail', id: p.id, messageId: 'note-png', blockId: pending.id, error: 'Sem WebGL' }),
    }),
  );
  const after = (await failed.json()) as { messages: Message[] };
  assert.equal((after.messages.at(-1)!.blocks![0] as FileBlock).status, 'failed');
});
