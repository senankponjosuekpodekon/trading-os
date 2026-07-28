import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { ToastProvider, ToastContext, ToastContextValue } from '../ToastProvider';

function Trigger({ message, opts }: { message: string; opts?: Parameters<ToastContextValue['toast']>[1] }) {
  const { toast } = useContext(ToastContext)!;
  return <button onClick={() => toast(message, opts)}>show</button>;
}

it('shows a toast and dismisses it manually', async () => {
  render(
    <ToastProvider>
      <Trigger message="hello" />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('show'));
  expect(screen.getByRole('status')).toHaveTextContent('hello');
  fireEvent.click(screen.getByLabelText('Dismiss'));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
});

it('supports success type styling', () => {
  render(
    <ToastProvider>
      <Trigger message="signal" opts={{ title: 'Signal', type: 'success' }} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('show'));
  const toast = screen.getByRole('status');
  expect(toast).toHaveTextContent('Signal');
  expect(toast).toHaveTextContent('signal');
});
