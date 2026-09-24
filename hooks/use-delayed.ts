import { useEffect, useState } from 'react';

/**
 * `true` só depois de `value` ficar verdadeiro por `ms`; volta a `false` na
 * hora. Serve para a aparência de "ocupado": uma gravação rápida (mover o
 * móvel leva ~100 ms) não pisca a página inteira em cinza, e uma espera longa
 * ainda aparece.
 */
export function useDelayedTrue(value: boolean, ms: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setShown(true), ms);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [value, ms]);
  return value && shown;
}
