import { AlertTriangle } from 'lucide-react';
import { Button } from '../Button';

export type ErrorStateProps = { message: string; onRetry?: () => void };

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state" role="alert">
      <span className="state__icon"><AlertTriangle size={20} strokeWidth={1.5} aria-hidden /></span>
      <p className="state__body">{message}</p>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}
