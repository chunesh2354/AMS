import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';

/** The one primary action of an empty state, when the way forward is another screen. */
export function GoTo({ to, children }: { to: string; children: string }) {
  const navigate = useNavigate();
  return <Button variant="primary" onClick={() => navigate(to)}>{children}</Button>;
}
