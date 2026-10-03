// Envia as chaves do .env e a senha do app para o Worker `merce` na Cloudflare.
// Uso: npm run cf:secrets            (pede a senha do app)
//      npm run cf:secrets -- --keep  (mantém a senha que já está lá)
// Nenhum valor aparece na tela: as chaves vão do .env direto para o wrangler.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const keep = process.argv.includes('--keep');
let env;
try {
  env = parseEnv(readFileSync('.env', 'utf8'));
} catch {
  console.error('Não achei o .env nesta pasta. Copie .env.example para .env e preencha as chaves.');
  process.exit(1);
}

// Só o que o servidor lê. MERCE_DATA_DIR é caminho do Node e não vale na Cloudflare.
const wanted = (name) =>
  (name.startsWith('AI_') || name.startsWith('MERCE_') || name === 'TYPESAFE_API_KEY' || name === 'PERPLEXITY_API_KEY') &&
  !['MERCE_DATA_DIR', 'MERCE_PASSWORD'].includes(name) &&
  !(env[name] ?? '').startsWith('your-');
const secrets = Object.fromEntries(Object.entries(env).filter(([k, v]) => v && wanted(k)));
if (!secrets.AI_API_KEY) {
  console.error('O .env não tem AI_API_KEY preenchida; sem ela a IA não responde.');
  process.exit(1);
}

function ask(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let typed = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(typed);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') {
          if (typed) {
            typed = typed.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          typed += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

if (!keep) {
  console.log('Senha para abrir o Merce publicado (mínimo 10 caracteres). Guarde num gerenciador de senhas.');
  for (;;) {
    const first = await ask('Senha: ');
    if (first.length < 10) {
      console.log('Curta demais. Use pelo menos 10 caracteres.');
      continue;
    }
    const again = await ask('Repita: ');
    if (first !== again) {
      console.log('As duas não conferem. De novo.');
      continue;
    }
    secrets.MERCE_PASSWORD = first;
    break;
  }
}

console.log(`Enviando ${Object.keys(secrets).length} valores: ${Object.keys(secrets).sort().join(', ')}`);
const child = spawn('npx', ['wrangler', 'secret', 'bulk', '-c', 'cloudflare/wrangler.jsonc'], { stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
child.stdin.end(JSON.stringify(secrets));
child.on('exit', (code) => {
  if (code === 0) console.log('Pronto. A mudança vale na hora; recarregue o app.');
  process.exit(code ?? 1);
});
