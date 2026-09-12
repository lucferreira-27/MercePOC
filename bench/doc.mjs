/**
 * Gera a documentação do benchmark a partir do corpus, para os casos e o que
 * aprendemos nunca ficarem fora de sincronia com o código.
 *
 *   npm run bench:doc
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cases, groups } from './cases.mjs';

const existing = readFileSync('bench/README.md', 'utf8');
const head = existing.split('<!-- catalogo -->')[0].trimEnd();

const lines = [head, '', '<!-- catalogo -->', '<!-- gerado por bench/doc.mjs: não edite à mão -->', ''];
for (const [group, about] of Object.entries(groups)) {
  const list = cases.filter((c) => c.group === group);
  lines.push(`### ${group} · ${about}`, '');
  lines.push('| caso | pedido | expectativa | o que já aprendemos |', '|---|---|---|---|');
  for (const c of list) {
    const expect = [];
    if (c.expect.action) {
      const actions = Array.isArray(c.expect.action) ? c.expect.action.join(' ou ') : c.expect.action;
      expect.push(`ação ${actions}`);
    }
    if (c.expect.applied === true) expect.push('muda o projeto');
    if (c.expect.applied === false) expect.push('não muda nada');
    if (c.expect.design) expect.push('geometria conferida');
    if (c.expect.clarify) expect.push('cartão com opções reais');
    if (c.expect.content?.mustMatch) expect.push(`resposta cita ${c.expect.content.mustMatch.map(String).join(', ')}`);
    if (c.expect.content?.mustNotMatch) expect.push(`resposta não traz ${c.expect.content.mustNotMatch.map(String).join(', ')}`);
    lines.push(
      `| \`${c.id}\` | ${c.prompt} | ${expect.join('; ') || 'não travar'} | ${(c.learned ?? '').replace(/\n/g, ' ')} |`,
    );
  }
  lines.push('');
}
lines.push(`Total: ${cases.length} casos em ${Object.keys(groups).length} grupos.`, '');

writeFileSync('bench/README.md', lines.join('\n'));
console.log(`bench/README.md atualizado com ${cases.length} casos`);
