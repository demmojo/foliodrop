import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import Page from './page';

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="upload-flow">Upload Flow</div>
}));

vi.mock('../components/AgencySettings', () => ({
  default: () => <div data-testid="agency-settings">Agency Settings</div>
}));

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  })
}));

vi.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: { email: "test@example.com" }, loading: false })
}));

describe('Page', () => {
  it('renders page components', () => {
    const { getByTestId, getByText } = render(<Page />);
    
    expect(getByTestId('upload-flow')).toBeInTheDocument();
    
    const settingsBtn = getByText('Settings');
    fireEvent.click(settingsBtn);
    
    expect(getByTestId('agency-settings')).toBeInTheDocument();
  });
});
