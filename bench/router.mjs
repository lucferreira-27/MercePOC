/**
 * Mede o roteador do assistente (Jev) contra `router-cases.mjs`, com a rede.
 *
 *   npm run bench:router            # todos os casos
 *   npm run bench:router -- --show  # imprime cada caso
 *
 * Grave: atalho errado (fez rápido a coisa errada). Leve: atalho perdido
 * (foi para o laço quando dava para atalhar). Um pedido por chamada, em
 * paralelo, como no produto.
 */
import { routerCases } from './router-cases.mjs';

const { askJev, jevAvailable } = await import('../lib/agent/jev.ts');
const { decideRoute, routerQuestions } = await import('../lib/agent/router.ts');

if (!jevAvailable()) {
  console.error('Sem TYPESAFE_API_KEY: o roteador cai sempre no laço. Nada a medir.');
  process.exit(1);
}
const show = process.argv.includes('--show');
const t0 = Date.now();
const results = await Promise.all(
  routerCases.map(async (c) => {
    const t = Date.now();
    const answers = await askJev({ pedido: c.text }, routerQuestions());
    return { c, answers, ms: Date.now() - t, route: decideRoute(c.text, answers) };
  }),
);
let right = 0,
  wrongShortcut = 0,
  missed = 0,
  intentRight = 0,
  intentTotal = 0,
  failed = 0;
for (const { c, answers, ms, route } of results) {
  if (!answers) failed++;
  let verdict;
  if (route.kind === c.expect && (c.expect !== 'direct' || JSON.stringify([...route.actions].sort()) === JSON.stringify([...c.actions].sort()))) {
    right++;
    verdict = 'ok';
  } else if (route.kind !== 'agent') {
    wrongShortcut++;
    verdict = 'ATALHO ERRADO';
  } else {
    missed++;
    verdict = 'atalho perdido';
  }
  if (c.intent) {
    intentTotal++;
    if (route.intent === c.intent) intentRight++;
  }
  if (show || verdict !== 'ok')
    console.log(
      `${verdict.padEnd(15)} ${c.text.padEnd(62)} → ${route.kind}${route.kind === 'direct' ? ` [${route.actions.join(', ')}]` : ''} · ${route.intent ?? '-'} (${answers?.intent?.confidence?.toFixed(2) ?? '-'}) gates=${['g_movel','g_criar','g_config','g_pergunta','g_alvo'].map((g)=>answers?.[g]?.noul?.toFixed(2) ?? '-').join('/')} vague=${answers?.vague?.noul?.toFixed(2) ?? '-'} · ${ms} ms`,
    );
}
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(
  `\n${routerCases.length} casos · certos ${right} (${Math.round((right / routerCases.length) * 100)}%) · atalho errado ${wrongShortcut} · atalho perdido ${missed} · intenção ${intentRight}/${intentTotal} · sem resposta ${failed}`,
);
console.log(`latência: mediana ${ms[Math.floor(ms.length / 2)]} ms, p90 ${ms[Math.floor(ms.length * 0.9)]} ms · total ${Date.now() - t0} ms em paralelo`);
