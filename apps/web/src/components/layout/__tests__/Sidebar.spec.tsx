import { render, screen, fireEvent } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '../Sidebar';

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

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

describe('Sidebar', () => {
  const logout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (usePathname as unknown as jest.Mock).mockReturnValue('/dashboard');
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) => selector({ logout }));
  });

  it('renders every navigation entry as a link with its href', () => {
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: /Dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /Signaux/i })).toHaveAttribute('href', '/signals');
    expect(screen.getByRole('link', { name: /Paramètres/i })).toHaveAttribute('href', '/settings');
  });

  it('highlights the link matching the current pathname', () => {
    (usePathname as unknown as jest.Mock).mockReturnValue('/signals');
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: /Signaux/i }).className).toContain('text-emerald-400');
    expect(screen.getByRole('link', { name: /Dashboard/i }).className).not.toContain('text-emerald-400');
  });

  it('calls logout when the déconnexion button is clicked', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: /Déconnexion/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
