/**
 * Senha única na frente do app publicado. Sem ela qualquer pessoa com o
 * endereço gastaria a chave da IA. A sessão é um cookie com o HMAC da senha:
 * trocar a senha (`npm run cf:secrets`) desconecta todo mundo.
 */
const COOKIE = 'merce_session';
const MAX_AGE = 60 * 60 * 24 * 30;

async function sign(password: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('merce-session-v1'));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

function isLocal(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });

function page(message = '') {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Entrar · Merce</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --ink: #1d1b18; --muted: #6b665e; --line: #dedad2; --accent: #2f5d50; --error: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161513; --card: #1f1e1b; --ink: #ecebe7; --muted: #a39e95; --line: #34322d; --accent: #7fb8a4; --error: #f2b8b5; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; }
  form { width: 100%; max-width: 340px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px 24px; display: grid; gap: 14px; }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 0; color: var(--muted); }
  input { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { font: inherit; font-weight: 600; padding: 10px 12px; border-radius: 8px; border: 0; background: var(--accent); color: var(--card); cursor: pointer; }
  .error { color: var(--error); }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Merce</h1>
  <p>Estúdio de móveis planejados. Digite a senha para entrar.</p>
  ${message ? `<p class="error" role="alert">${message}</p>` : ''}
  <input type="password" name="password" autocomplete="current-password" aria-label="Senha" placeholder="Senha" required autofocus>
  <button type="submit">Entrar</button>
</form>
</body>
</html>`;
}

/**
 * Devolve a resposta quando o pedido para aqui (tela de senha, login, saída,
 * bloqueio) ou null quando pode seguir para o app.
 */
export async function gate(request: Request, password: string | undefined): Promise<Response | null> {
  const url = new URL(request.url);
  if (!password) {
    // `npm run cf:dev` na própria máquina funciona sem senha; publicado, não.
    if (isLocal(url)) return null;
    return html(
      page('O app ainda não tem senha. Na pasta do projeto rode <code>npm run cf:secrets</code> e recarregue.'),
      503,
    );
  }
  const expected = await sign(password);
  if (url.pathname === '/logout')
    return new Response(null, {
      status: 303,
      headers: { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  if (url.pathname === '/login') {
    if (request.method !== 'POST') return html(page());
    const form = await request.formData().catch(() => null);
    const field = form?.get('password');
    const typed = typeof field === 'string' ? field : '';
    if (!typed || !same(await sign(typed), expected)) {
      // Atraso fixo: tentar senhas em sequência fica lento.
      await new Promise((r) => setTimeout(r, 800));
      return html(page('Senha incorreta.'), 401);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Set-Cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }
  if (same(cookie(request, COOKIE), expected)) return null;
  if (url.pathname.startsWith('/api/'))
    return Response.json({ error: 'Sessão expirada. Recarregue a página e digite a senha.' }, { status: 401 });
  return new Response(null, { status: 303, headers: { Location: '/login' } });
}
