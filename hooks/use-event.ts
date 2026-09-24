import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * Função de identidade fixa que sempre chama a versão do render atual. Serve
 * para passar callbacks a componentes memorizados (`memo`) sem que cada render
 * do pai crie uma função nova e force o filho a renderizar de novo.
 */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
