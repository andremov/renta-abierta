// Guards against invisible control characters in source (e.g. a regex "\b" written through a
// tool as a literal backspace), which silently break regular expressions.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|css)$/.test(f) ? [p] : [];
  });
}

it('source files contain no control characters', () => {
  const bad = files(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    .filter((f) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
