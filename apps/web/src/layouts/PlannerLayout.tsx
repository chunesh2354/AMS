import type { ReactNode } from 'react';

/** Section 8, Planner: tools, then a full-bleed grid that fills the viewport, then the legend. */
export function PlannerLayout({ tools, grid, foot, fit }: { tools?: ReactNode; grid: ReactNode; foot?: ReactNode; /** Grid takes its content height instead of filling the viewport. */ fit?: boolean }) {
  return (
    <div className="planner-page">
      {tools && <div className="planner-page__tools">{tools}</div>}
      <div className={fit ? 'planner-page__grid planner-page__grid--fit' : 'planner-page__grid'}>{grid}</div>
      {foot && <div className="planner-page__foot">{foot}</div>}
    </div>
  );
}
