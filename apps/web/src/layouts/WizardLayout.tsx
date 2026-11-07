import type { ReactNode } from 'react';
import { Stepper } from '../ui/Stepper';

/** Section 8, Wizard: glass step rail, one step on a solid panel, sticky footer. The rail becomes a top stepper under 1024 px. */
export function WizardLayout({ steps, current, footer, children }: { steps: string[]; current: number; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="wizard">
      <div className="wizard__rail glass"><Stepper vertical steps={steps} current={current} /></div>
      <div className="wizard__panel solid-panel">
        <div className="wizard__body">{children}</div>
        <div className="wizard__foot">{footer}</div>
      </div>
    </div>
  );
}
