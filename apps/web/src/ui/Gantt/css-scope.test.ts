import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Round 2 Gantt's stylesheet is global, and the older GanttStrip (Phases, project overview) styles the BEM block
 * `.gantt` in styles/data.css. The Gantt must keep to its own block (`.gchart`) so it never restyles GanttStrip rows.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const classSelectors = (css: string) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

describe('Gantt stylesheet scope', () => {
  it('defines none of the GanttStrip classes', () => {
    const strip = [...read('../GanttStrip/index.tsx').matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('gantt'));
    expect(strip).toContain('gantt__row');
    const mine = classSelectors(read('Gantt.css'));
    expect(strip.filter((c) => mine.has(c))).toEqual([]);
    expect(mine.has('gantt')).toBe(false);
  });
});
