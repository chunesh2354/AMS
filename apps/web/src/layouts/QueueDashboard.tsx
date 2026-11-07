import type { ReactNode } from 'react';

/** Section 8, Queue dashboard: six queue cards, then attention (7) and insight (5) columns. */
export function QueueDashboard({ cards, main, side }: { cards: ReactNode; main: ReactNode; side: ReactNode }) {
  return (
    <>
      <div className="grid-6">{cards}</div>
      <div className="cols-7-5"><div className="stack-4">{main}</div><div className="stack-4">{side}</div></div>
    </>
  );
}
