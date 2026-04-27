import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HowItWorksPage from './page';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a href={href}>{children}</a>
  )
}));

describe('HowItWorksPage', () => {
  it('renders the how it works page correctly', () => {
    render(<HowItWorksPage />);
    
    // Check if the main heading exists
    expect(screen.getByText('How Folio Works: The Background Pipeline')).toBeInTheDocument();
    
    // Check if all 4 stages exist (updated from 5)
    expect(screen.getByText(/Intelligent Ingestion/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct-to-Cloud Secure Transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/The Hybrid Engine/i)).toBeInTheDocument();
    expect(screen.getByText(/Zero-Wait Local Delivery/i)).toBeInTheDocument();

    // QA gate (anti-hallucination) is wired into the hybrid engine and must be documented.
    expect(screen.getByText(/Structural QA Gate/i)).toBeInTheDocument();

    // Check if back link exists
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/');
  });
});
