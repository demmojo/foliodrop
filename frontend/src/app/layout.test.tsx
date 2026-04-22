import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RootLayout, { metadata, viewport } from './layout';
import React from 'react';

// Mock the next/font/google Inter font
vi.mock('next/font/google', () => ({
  Inter: () => ({
    variable: 'mock-inter-variable',
  }),
}));

describe('RootLayout', () => {
  it('renders children within ThemeProvider', () => {
    const { getByTestId, getByText } = render(
      <RootLayout>
        <div data-testid="child">Test Child</div>
      </RootLayout>
    );

    expect(getByTestId('child')).toBeInTheDocument();
    expect(getByText('Test Child')).toBeInTheDocument();
  });

  it('exports correct viewport settings', () => {
    expect(viewport).toBeDefined();
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
    expect(viewport.maximumScale).toBe(1);
    expect(viewport.userScalable).toBe(false);
  });

  it('exports correct metadata settings', () => {
    expect(metadata).toBeDefined();
    expect(metadata.title).toBe('Folio | Pro HDR Pipeline');
  });
});
