import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUsage, emptyUsage, modelInfo, percent, priceOf, sumUsage, tokensLabel, usageBreakdown, usd } from '../lib/models';

void test('custo do turno: cache paga preço de cache e saída inclui raciocínio', () => {
  const price = { input: 1, output: 4, cachedInput: 0.1 };
  const u = addUsage(
    emptyUsage('luna'),
    {
      prompt_tokens: 10_000,
      completion_tokens: 2_000,
      prompt_tokens_details: { cached_tokens: 4_000 },
      completion_tokens_details: { reasoning_tokens: 1_500 },
    },
    price,
  );
  // 6000 × 1 + 4000 × 0,1 + 2000 × 4 = 14 400 por milhão.
  assert.equal(u.costUsd, 0.0144);
  assert.equal(u.calls, 1);
  assert.equal(u.reasoningTokens, 1_500);
  const twice = addUsage(u, { prompt_tokens: 1_000_000, completion_tokens: 0 }, price);
  assert.equal(twice.calls, 2);
  assert.ok(Math.abs(twice.costUsd - 1.0144) < 1e-9);
});

void test('uso sem detalhes não quebra e cache nunca passa da entrada', () => {
  const u = addUsage(emptyUsage('deepseek'), { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 500 } }, { input: 1, output: 1, cachedInput: 0 });
  assert.equal(u.cachedTokens, 100);
  assert.equal(u.costUsd, 0);
  assert.equal(addUsage(emptyUsage('deepseek'), {}, modelInfo('deepseek').price).costUsd, 0);
});

void test('preço vem da tabela ou do .env do servidor', () => {
  assert.deepEqual(priceOf('luna'), modelInfo('luna').price);
  assert.deepEqual(priceOf('luna', { MERCE_PRICE_LUNA: '0.3, 1.2' }), { input: 0.3, output: 1.2, cachedInput: 0.3 });
  assert.deepEqual(priceOf('qwen-fast', { MERCE_PRICE_QWEN_FAST: '1,2,0.5' }), { input: 1, output: 2, cachedInput: 0.5 });
  assert.deepEqual(priceOf('deepseek', { MERCE_PRICE_DEEPSEEK: 'x,y' }), modelInfo('deepseek').price);
});

void test('soma da conversa agrupa por modelo e ignora respostas sem custo', () => {
  const a = { ...emptyUsage('luna'), calls: 1, inputTokens: 100, outputTokens: 50, costUsd: 0.01 };
  const b = { ...emptyUsage('deepseek'), calls: 2, inputTokens: 300, outputTokens: 10, costUsd: 0.002 };
  const total = sumUsage([a, undefined, b, a]);
  assert.equal(total.turns, 3);
  assert.equal(total.tokens, 610);
  assert.ok(Math.abs(total.costUsd - 0.022) < 1e-12);
  assert.equal(total.byModel.find((m) => m.model === 'luna')?.calls, 2);
});

void test('formatos para gente: dólar com casas úteis e tokens em mil', () => {
  assert.equal(usd(0), 'US$ 0,000');
  assert.equal(usd(0.0012), 'US$ 0,0012');
  assert.equal(usd(0.5), 'US$ 0,500');
  assert.equal(usd(12.345), 'US$ 12,35');
  assert.equal(tokensLabel(950), '950');
  assert.equal(tokensLabel(3_140), '3,1 mil');
  assert.equal(tokensLabel(48_000), '48 mil');
});

void test('modelo desconhecido cai no padrão do estúdio', () => {
  assert.equal(modelInfo('nada').key, 'haiku', 'o padrão do estúdio é o Haiku 5.5 com esforço baixo');
  assert.equal(modelInfo('haiku').reasoning, 'low', 'low acertou como medium no corpus, mais rápido e mais barato');
  assert.equal(modelInfo('luna').reasoning, 'high', 'Luna em low acertou 4/10 nos casos difíceis; em high, 9/10');
  assert.equal(modelInfo('deepseek').fallback, 'luna');
});

void test('custo separado em entrada nova, cache e saída soma o custo gravado', () => {
  const price = modelInfo('luna').price;
  const u = addUsage(
    emptyUsage('luna'),
    { prompt_tokens: 100_000, completion_tokens: 5_000, prompt_tokens_details: { cached_tokens: 80_000 } },
    price,
  );
  const b = usageBreakdown([u, undefined]);
  assert.equal(b.fresh.tokens, 20_000);
  assert.equal(b.cached.tokens, 80_000);
  assert.equal(b.output.tokens, 5_000);
  assert.equal(percent(b.hitRate), '80%');
  assert.ok(Math.abs(b.fresh.costUsd + b.cached.costUsd + b.output.costUsd - u.costUsd) < 1e-12);
  assert.ok(Math.abs(b.savedUsd - (80_000 * (price.input - price.cachedInput)) / 1_000_000) < 1e-12);
  // Preço trocado no servidor: as fatias acompanham o total gravado.
  const scaled = usageBreakdown([{ ...u, costUsd: u.costUsd * 2 }]);
  assert.ok(Math.abs(scaled.cached.costUsd - b.cached.costUsd * 2) < 1e-12);
  assert.deepEqual(usageBreakdown([]).hitRate, 0);
});
