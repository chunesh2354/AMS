import type { ReactNode } from 'react';

/** Section 8, Workspace: main table (8) beside the attention list (4). */
export function WorkspaceColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return <div className="cols-8-4"><div className="stack-4">{main}</div><div className="stack-4">{side}</div></div>;
}
