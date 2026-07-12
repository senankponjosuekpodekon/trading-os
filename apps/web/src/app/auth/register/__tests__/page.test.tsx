import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import RegisterPage from '../page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn() as jest.Mock,
}));

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn() as jest.Mock,
}));

describe('RegisterPage', () => {
  const mockReplace = jest.fn();
  const mockRegister = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: mockReplace });
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      register: mockRegister,
      isLoading: false,
    });
  });

  it('renders registration form', () => {
    render(<RegisterPage />);
    expect(screen.getByPlaceholderText(/jean dupont/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/vous@exemple\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/min\. 8 caractères/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /créer mon compte/i })).toBeInTheDocument();
  });

  it('submits registration and redirects on success', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    render(<RegisterPage />);

    fireEvent.change(screen.getByPlaceholderText(/jean dupont/i), {
      target: { value: 'Jean Dupont' },
    });
    fireEvent.change(screen.getByPlaceholderText(/vous@exemple\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/min\. 8 caractères/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /créer mon compte/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('test@example.com', 'password123', 'Jean Dupont');
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows error when password is too short', async () => {
    render(<RegisterPage />);

    fireEvent.change(screen.getByPlaceholderText(/jean dupont/i), {
      target: { value: 'Jean Dupont' },
    });
    fireEvent.change(screen.getByPlaceholderText(/vous@exemple\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/min\. 8 caractères/i), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /créer mon compte/i }));

    await waitFor(() => {
      expect(screen.getByText(/mot de passe doit faire au moins 8 caractères/i)).toBeInTheDocument();
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
