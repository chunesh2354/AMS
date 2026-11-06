import type { Meta, StoryObj } from '@storybook/react-vite';
import { STATUS_GROUPS, type Tone } from './status-colors';
import { formatHours, formatINR } from './format';

const COLOURS = ['surface', 'surface-muted', 'surface-raised', 'ink-1', 'ink-2', 'ink-3', 'line', 'line-strong', 'accent', 'accent-soft', 'accent-text'];
const TONES: Tone[] = ['neutral', 'info', 'warn', 'ok', 'danger'];
const TYPE = ['display', 'h1', 'h2', 'h3', 'body', 'body-sm', 'label', 'caption', 'numeric', 'kpi', 'timer'];
const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const RADII = ['sm', 'md', 'lg', 'xl', 'pill'];

const swatch = { width: 72, height: 40, border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)' };
const section = { display: 'flex', flexDirection: 'column' as const, gap: 'var(--s-3)' };

function TokenSheet() {
  return (
    <div style={{ padding: 'var(--s-8)', display: 'flex', flexDirection: 'column', gap: 'var(--s-8)', maxWidth: 1100 }}>
      <section className="glass" style={{ padding: 'var(--s-5)', ...section }}>
        <h2 className="t-h2">Glass surfaces</h2>
        <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
          <div className="glass" style={{ padding: 'var(--s-4)', flex: 1 }}><p className="t-h3">.glass</p><p className="ink-2">Sidebar, top bar, cards</p></div>
          <div className="glass glass--elevated" style={{ padding: 'var(--s-4)', flex: 1 }}><p className="t-h3">.glass--elevated</p><p className="ink-2">Sheets, popovers, palette</p></div>
        </div>
      </section>
      <section style={section}>
        <h2 className="t-h2">Typography</h2>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 'var(--s-5)', ...section }}>
          {TYPE.map((t) => (
            <div key={t} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'baseline', gap: 'var(--s-4)' }}>
              <code className="t-caption ink-2">--text-{t}</code>
              <span className={`t-${t}`}>{['numeric', 'kpi', 'timer'].includes(t) ? `${formatINR(400000)}  ${formatHours(6.5)}` : 'Lakeview Residence'}</span>
            </div>
          ))}
        </div>
      </section>
      <section style={section}>
        <h2 className="t-h2">Colour</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)' }}>
          {COLOURS.map((c) => (
            <div key={c}><div style={{ ...swatch, background: `var(--${c})` }} /><code className="t-caption ink-2">--{c}</code></div>
          ))}
        </div>
      </section>
      <section style={section}>
        <h2 className="t-h2">Status tones</h2>
        {TONES.map((tone) => (
          <div key={tone} className={`tone-${tone}`} style={{ display: 'grid', gridTemplateColumns: '72px 72px 1fr', gap: 'var(--s-3)', alignItems: 'center' }}>
            <div style={{ ...swatch, background: 'var(--tone)' }} />
            <div style={{ ...swatch, background: 'var(--tone-soft)' }} />
            <span className="t-body-sm" style={{ color: 'var(--tone-ink)' }}><strong>{tone}</strong>: {STATUS_GROUPS[tone].join(', ')}</span>
          </div>
        ))}
      </section>
      <section style={section}>
        <h2 className="t-h2">Spacing and radius</h2>
        <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-end' }}>
          {SPACE.map((s) => (
            <div key={s}><div style={{ width: `var(--s-${s})`, height: `var(--s-${s})`, background: 'var(--accent-soft)' }} /><code className="t-caption ink-2">{s * 4}</code></div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
          {RADII.map((r) => (
            <div key={r}><div style={{ width: 72, height: 40, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: `var(--radius-${r})` }} /><code className="t-caption ink-2">{r}</code></div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta: Meta = { title: 'Foundations/Tokens', parameters: { layout: 'fullscreen' } };
export default meta;
export const Sheet: StoryObj = { render: () => <TokenSheet /> };
