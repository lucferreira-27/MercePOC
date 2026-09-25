/**
 * Mede a conferência da resposta (Jev + CLAIMS) contra `claims-cases.mjs`,
 * com a rede. Grave: mentira que passou. Leve: resposta honesta barrada
 * (custa duas chamadas ao modelo).
 *
 *   npm run bench:claims            # todos os casos
 *   npm run bench:claims -- --show  # imprime cada caso
 */
import { claimsCases } from './claims-cases.mjs';

const { askJev, jevAvailable } = await import('../lib/agent/jev.ts');
const { claimGaps, claimQuestions } = await import('../lib/agent/tools.ts');

if (!jevAvailable()) {
  console.error('Sem TYPESAFE_API_KEY: a conferência não roda. Nada a medir.');
  process.exit(1);
}
const show = process.argv.includes('--show');
const results = await Promise.all(
  claimsCases.map(async (c) => {
    const t = Date.now();
    const answers = await askJev({ resposta: c.resposta }, claimQuestions());
    const gaps = answers ? claimGaps(answers, { tools: new Set(c.tools), changes: c.mudancas, view: c.view ?? null }) : null;
    return { c, answers, gaps, ms: Date.now() - t };
  }),
);
let right = 0,
  lies = 0,
  blocked = 0,
  failed = 0;
for (const { c, answers, gaps, ms } of results) {
  if (!gaps) failed++;
  const pass = !!gaps && gaps.length === 0;
  const verdict = !gaps
    ? 'sem resposta'
    : pass === c.ok
      ? 'ok'
      : c.ok
        ? 'barrou honesta'
        : c.coberto
          ? 'outra conferência'
          : 'MENTIRA PASSOU';
  if (verdict === 'ok' || verdict === 'outra conferência') right++;
  else if (verdict === 'MENTIRA PASSOU') lies++;
  else if (verdict === 'barrou honesta') blocked++;
  if (show || verdict !== 'ok') {
    const high = Object.entries(answers ?? {})
      .filter(([, a]) => a.noul >= 0.5)
      .map(([k, a]) => `${k} ${a.noul.toFixed(2)}`)
      .join(', ');
    console.log(`${verdict.padEnd(17)} ${c.name.padEnd(20)} afirma: ${high || '-'}${gaps?.length ? ` · falta: ${gaps.join('; ')}` : ''}${c.coberto && verdict !== 'ok' ? ` · pega: ${c.coberto}` : ''} · ${ms} ms`);
  }
}
console.log(`\n${claimsCases.length} casos · certos ${right} · mentira passou ${lies} · honesta barrada ${blocked} · sem resposta ${failed}`);
