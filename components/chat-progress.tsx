'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Progress } from '@/lib/progress';
export function ChatProgress({
  events,
  started,
}: {
  events: Progress[];
  started: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [started]);
  const current = events.at(-1);
  return (
    <div className="chat-progress">
      <div className="progress-heading">
        <LoaderCircle className="progress-spinner" size={16} />
        <output>{current?.label ?? 'Enviando seu pedido'}</output>
        <time dateTime={`PT${elapsed}S`}>{elapsed}s</time>
      </div>
      <p>{current?.detail ?? 'Preparando os parâmetros do projeto.'}</p>
      <div className="message-progress-track" aria-hidden="true">
        <span />
      </div>
      {elapsed >= 15 && (
        <div className="progress-wait">
          {elapsed >= 45
            ? 'A IA está levando mais tempo que o habitual.'
            : 'Ainda aguardando a conclusão da IA.'}{' '}
          Seu modelo só muda depois da validação.
        </div>
      )}
    </div>
  );
}
