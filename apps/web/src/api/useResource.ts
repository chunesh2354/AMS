import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ListState } from '../ui/ListState';

const DEMO = ['loading', 'empty', 'error', 'denied'];

/**
 * Loads through the api layer and reports one list state. `?demo=loading|empty|error|denied` forces a state,
 * so every list on every route can be reached and checked.
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]) {
  const [params] = useSearchParams();
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setStatus('loading');
    load().then(
      (d) => { if (live) { setData(d); setStatus('ready'); } },
      () => { if (live) setStatus('error'); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const demo = params.get('demo');
  const state: ListState = demo && DEMO.includes(demo) ? (demo as ListState) : status;
  return { state, data, retry };
}
