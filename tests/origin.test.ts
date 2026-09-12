import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin } from '../lib/utils';

function pedido(headers: Record<string, string>, url = 'http://127.0.0.1:4310/api/projects') {
  return new Request(url, { method: 'POST', headers });
}

void test('pedido sem origem passa (cliente que não é navegador)', () => {
  assert.equal(sameOrigin(pedido({})), true);
});

void test('mesma origem do próprio servidor passa', () => {
  assert.equal(
    sameOrigin(pedido({ origin: 'http://127.0.0.1:4310', host: '127.0.0.1:4310' })),
    true,
  );
});

void test('origem igual ao host encaminhado passa (túnel, proxy)', () => {
  // Atrás do túnel o servidor vê 127.0.0.1 e o navegador está no domínio
  // público: comparar só com a URL interna recusava toda escrita com
  // "Origem inválida".
  assert.equal(
    sameOrigin(
      pedido(
        {
          origin: 'https://algo-teste.trycloudflare.com',
          host: '127.0.0.1:4310',
          'x-forwarded-host': 'algo-teste.trycloudflare.com',
        },
      ),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      pedido({
        origin: 'https://outro.exemplo.com',
        host: '127.0.0.1:4310',
        'x-forwarded-host': 'algo-teste.trycloudflare.com',
      }),
    ),
    false,
  );
});

void test('site de fora continua recusado', () => {
  assert.equal(
    sameOrigin(pedido({ origin: 'https://mau.exemplo.com', host: '127.0.0.1:4310' })),
    false,
  );
  // Porta diferente é origem diferente.
  assert.equal(
    sameOrigin(pedido({ origin: 'http://127.0.0.1:4311', host: '127.0.0.1:4310' })),
    false,
  );
  // Origem malformada não passa por engano.
  assert.equal(sameOrigin(pedido({ origin: 'nada', host: '127.0.0.1:4310' })), false);
});

void test('cabeçalho de host encaminhado com lista usa o primeiro', () => {
  assert.equal(
    sameOrigin(
      pedido({
        origin: 'https://algo-teste.trycloudflare.com',
        'x-forwarded-host': 'algo-teste.trycloudflare.com, interno.local',
      }),
    ),
    true,
  );
});
