import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { BottomNav } from '../BottomNav';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('next/link', () => {
  const MockLink = ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  );
  MockLink.displayName = 'Link';
  return MockLink;
});

describe('BottomNav', () => {
  beforeEach(() => {
    (usePathname as unknown as jest.Mock).mockReturnValue('/dashboard');
  });

  it('renders every navigation entry as a link with its href', () => {
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /Dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /Signaux/i })).toHaveAttribute('href', '/signals');
    expect(screen.getByRole('link', { name: /Copilot/i })).toHaveAttribute('href', '/copilot');
  });

  it('highlights the link matching the current pathname', () => {
    (usePathname as unknown as jest.Mock).mockReturnValue('/portfolio');
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /Portfolio/i }).className).toContain('text-emerald-400');
    expect(screen.getByRole('link', { name: /Dashboard/i }).className).not.toContain('text-emerald-400');
  });
});
