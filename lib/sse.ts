export async function readEvents(
  response: Response,
  onEvent: (event: { event: string; data: string }) => void,
) {
  if (!response.body) throw new Error('A resposta chegou sem conteúdo.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    event = 'message',
    data: string[] = [];
  const line = (value: string) => {
    value = value.replace(/\r$/, '');
    if (!value) {
      if (data.length) onEvent({ event, data: data.join('\n') });
      event = 'message';
      data = [];
    } else if (value.startsWith('event:')) event = value.slice(6).trim();
    else if (value.startsWith('data:'))
      data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += chunk.done
        ? decoder.decode()
        : decoder.decode(chunk.value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (chunk.done) {
        if (buffer) line(buffer);
        line('');
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
