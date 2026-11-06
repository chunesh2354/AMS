import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toast, ToastProvider, useToast } from '.';
import { Button } from '../Button';

const meta: Meta = { title: 'Feedback/Toast' };
export default meta;
export const Variants: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
      <Toast persist variant="success" message="13 approved. 1 exception excluded." onDismiss={() => {}} />
      <Toast persist variant="warn" message="Thursday has 12.5 h logged." />
      <Toast persist variant="danger" message="The draft could not be submitted." action={{ label: 'Retry', onClick: () => {} }} />
      <Toast persist variant="info" message="Plan published to 3 people." />
    </div>
  ),
};
function Fire() {
  const toast = useToast();
  return <Button onClick={() => toast({ variant: 'success', message: 'Timesheet submitted.' })}>Show toast</Button>;
}
export const Live: StoryObj = { render: () => <ToastProvider><Fire /></ToastProvider> };
