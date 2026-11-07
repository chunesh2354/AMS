import { Check } from 'lucide-react';
import { cx } from '../cx';

export type StepperProps = { steps: string[]; current: number; vertical?: boolean };

/** Added for wizards: done, current and upcoming steps. Vertical is the step rail in the Wizard pattern. */
export function Stepper({ steps, current, vertical }: StepperProps) {
  return (
    <ol className={cx('stepper', vertical && 'stepper--vertical')} aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className={cx('stepper__step', i === current && 'is-current', i < current && 'is-done')} aria-current={i === current ? 'step' : undefined}>
          <span className="stepper__n">{i < current ? <Check size={12} strokeWidth={2.5} aria-hidden /> : i + 1}</span>
          {s}{i < current && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}
