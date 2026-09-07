import { spawn } from 'node:child_process';
try {
  process.loadEnvFile('.env');
} catch {
  console.error(
    'Arquivo .env nÃ£o encontrado. Copie .env.example e configure sua chave.',
  );
}
const child = spawn(
  process.execPath,
  [
    'node_modules/vinext/dist/cli.js',
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    '4310',
  ],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
