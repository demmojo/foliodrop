import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import Page from './page';
import { signOut } from 'firebase/auth';

const pushMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="upload-flow">Upload Flow</div>
}));

vi.mock('@/components/AgencySettings', () => ({
  default: () => <div data-testid="agency-settings">Agency Settings</div>
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  })
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('firebase/auth', () => ({
  signOut: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
}));

describe('Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { email: 'test@example.com' }, loading: false });
  });

  it('renders page components', () => {
    const { getByTestId, getByText } = render(<Page />);
    
    expect(getByTestId('upload-flow')).toBeInTheDocument();
    
    const settingsBtn = getByText('Settings');
    fireEvent.click(settingsBtn);
    
    expect(getByTestId('agency-settings')).toBeInTheDocument();
  });

  it('shows loading state while auth is loading', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    render(<Page />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to login when unauthenticated', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<Page />);
    expect(pushMock).toHaveBeenCalledWith('/login');
  });

  it('logs out on click', () => {
    render(<Page />);
    fireEvent.click(screen.getByLabelText('Logout'));
    expect(signOut).toHaveBeenCalled();
  });
});
