import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import LoginPage from '../page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn() as jest.Mock,
}));

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn() as jest.Mock,
}));

describe('LoginPage', () => {
  const mockReplace = jest.fn();
  const mockLogin = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: mockReplace });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      login: mockLogin,
      isLoading: false,
    });
  });

  it('renders login form', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText(/vous@exemple\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /se connecter/i })).toBeInTheDocument();
  });

  it('submits credentials and redirects on success', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText(/vous@exemple\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /se connecter/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123', undefined);
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays error message on login failure', async () => {
    mockLogin.mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    });
    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText(/vous@exemple\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /se connecter/i }));

    await waitFor(() => {
      expect(screen.getByText(/email ou mot de passe incorrect/i)).toBeInTheDocument();
    });
  });
});
