/**
 * Grava os projetos de demonstração (lib/demos.ts) na base local.
 *
 *   npm run demos              grava ou regrava as demos; os outros projetos ficam
 *   npm run demos -- --replace também apaga todos os projetos que não são demo
 *
 * Antes de escrever, copia a base inteira para data/merce-before-demos-<hora>.sqlite.
 * Os ids são fixos: rodar de novo devolve cada demo ao estado original, sem
 * duplicar. Pode rodar com o servidor de pé (a base está em WAL); recarregue a
 * página depois.
 */
import { DEMOS, buildDemo } from '../lib/demos';
import { backupDatabase, list, putProject, removeDemosExcept, removeNonDemo } from '../lib/store';

const replace = process.argv.includes('--replace');
// Monta tudo antes de tocar na base: uma receita recusada pela validação não
// deixa a vitrine pela metade.
const now = new Date();
const built = DEMOS.map((recipe, order) => buildDemo(recipe, order, now));
const backup = backupDatabase(`merce-before-demos-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`);
console.log(`Backup: ${backup}`);
for (const { project, updated } of built) {
  putProject(project, updated);
  console.log(`Demo gravada: ${project.name} (${project.revisions.length} versões, ${project.messages.length} mensagens)`);
}
const stale = removeDemosExcept(built.map((b) => b.project.id));
if (stale) console.log(`Demos antigas removidas: ${stale}`);
if (replace) console.log(`Projetos que não são demo removidos: ${removeNonDemo()}`);
const all = list();
console.log(`Na base agora: ${all.length} projetos (${all.filter((p) => p.demo !== undefined).length} demos).`);
