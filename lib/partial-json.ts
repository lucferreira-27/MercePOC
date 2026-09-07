// Reads only a named top-level string from incomplete JSON tool arguments.
// Incomplete escapes are withheld until their next chunk arrives.
export function readStringField(
  source: string,
  field: string,
): string | undefined {
  const stringAt = (start: number) => {
    let value = '',
      i = start + 1;
    while (i < source.length) {
      const c = source[i++];
      if (c === '"') return { value, end: i, complete: true };
      if (c !== '\\') {
        value += c;
        continue;
      }
      if (i >= source.length) break;
      const escape = source[i++];
      if (escape === 'u') {
        if (i + 4 > source.length) break;
        const hex = source.slice(i, i + 4);
        if (!/^[0-9a-f]{4}$/i.test(hex)) break;
        value += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        const map: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
        };
        if (!(escape in map)) break;
        value += map[escape];
      }
    }
    return {
      value: value.replace(/[\uD800-\uDBFF]$/, ''),
      end: i,
      complete: false,
    };
  };
  let depth = 0;
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === '"') {
      const key = stringAt(i);
      i = key.end;
      if (!key.complete) return;
      if (depth !== 1 || key.value !== field) continue;
      while (/\s/.test(source[i] ?? '') && i < source.length) i++;
      if (source[i++] !== ':') continue;
      while (/\s/.test(source[i] ?? '') && i < source.length) i++;
      if (source[i] === '"') return stringAt(i).value;
    } else {
      if (c === '{' || c === '[') depth++;
      if (c === '}' || c === ']') depth--;
      i++;
    }
  }
}
