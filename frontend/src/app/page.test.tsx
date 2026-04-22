import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import Page from './page';

vi.mock('../components/UploadFlow', () => ({
  default: () => <div data-testid="upload-flow">Upload Flow</div>
}));

vi.mock('../components/AgencySettings', () => ({
  default: () => <div data-testid="agency-settings">Agency Settings</div>
}));

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k })
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