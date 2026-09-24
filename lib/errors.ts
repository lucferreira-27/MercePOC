/**
 * Falhas de rede chegam como TypeError ("Failed to fetch") ou "network error"
 * do motor do navegador. A interface é em português: traduzir na fronteira.
 */
export function friendlyError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|network error|load failed|fetch failed|err_/i.test(message))
    return 'Sem conexão com o estúdio local. Verifique se o servidor está rodando e tente novamente.';
  if (/aborted|abort/i.test(message) && !/timeout/i.test(message))
    return 'A conexão foi interrompida antes da resposta. Tente novamente.';
  return message || 'Não foi possível concluir.';
}
