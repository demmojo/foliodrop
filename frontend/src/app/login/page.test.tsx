import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import Login from './page';
import { signInWithPopup } from 'firebase/auth';

const { firebaseState } = vi.hoisted(() => ({
  firebaseState: { auth: {} as Record<string, never> | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  })
}));

vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebaseState.auth;
  },
  googleProvider: {},
  appleProvider: {}
}));

vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
}));

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseState.auth = {};
  });

  it('renders login form', () => {
    render(<Login />);
    expect(screen.getByText('Agency Login')).toBeInTheDocument();
    expect(screen.getByText(/Continue with Google/i)).toBeInTheDocument();
    expect(screen.getByText(/Continue with Apple/i)).toBeInTheDocument();
  });

  it('handles successful Google login', async () => {
    (signInWithPopup as any).mockResolvedValue({ user: { email: 'test@example.com' } });
    
    render(<Login />);
    
    const googleBtn = screen.getByText(/Continue with Google/i);
    
    await act(async () => {
      fireEvent.click(googleBtn);
    });
    
    expect(signInWithPopup).toHaveBeenCalled();
  });

  it('handles failed Google login', async () => {
    (signInWithPopup as any).mockRejectedValue(new Error('Google login failed'));
    
    render(<Login />);
    
    const googleBtn = screen.getByText(/Continue with Google/i);
    
    await act(async () => {
      fireEvent.click(googleBtn);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Google login failed')).toBeInTheDocument();
    });
  });

  it('handles successful Apple login', async () => {
    (signInWithPopup as any).mockResolvedValue({ user: { email: 'test@example.com' } });
    
    render(<Login />);
    
    const appleBtn = screen.getByText(/Continue with Apple/i);
    
    await act(async () => {
      fireEvent.click(appleBtn);
    });
    
    expect(signInWithPopup).toHaveBeenCalled();
  });

  it('handles failed Apple login', async () => {
    (signInWithPopup as any).mockRejectedValue(new Error('Apple login failed'));
    
    render(<Login />);
    
    const appleBtn = screen.getByText(/Continue with Apple/i);
    
    await act(async () => {
      fireEvent.click(appleBtn);
    });
    
    await waitFor(() => {
      expect(screen.getByText('Apple login failed')).toBeInTheDocument();
    });
  });

  it('shows configuration error when Firebase auth is unavailable', async () => {
    firebaseState.auth = null;
    render(<Login />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Continue with Google/i));
    });
    expect(screen.getByText('Firebase not configured')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(/Continue with Apple/i));
    });
    expect(screen.getByText('Firebase not configured')).toBeInTheDocument();
    expect(signInWithPopup).not.toHaveBeenCalled();
  });
});
