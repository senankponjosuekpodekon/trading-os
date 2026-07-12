import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>Everything is fine</div>;
};

describe('ErrorBoundary', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterAll(() => {
    consoleError.mockRestore();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/oups, quelque chose s'est mal passé/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });
});
