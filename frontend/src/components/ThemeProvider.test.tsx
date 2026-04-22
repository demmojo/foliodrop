import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from 'next-themes';

vi.mock('next-themes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-themes')>();
  return {
    ...actual,
    ThemeProvider: ({ children, ...props }: any) => (
      <div data-testid="next-themes-provider" {...props}>
        {children}
      </div>
    ),
  };
});

describe('ThemeProvider', () => {
  it('renders NextThemesProvider with props', () => {
    const { getByTestId, getByText } = render(
      <ThemeProvider defaultTheme="dark" attribute="class">
        <div>Test Child</div>
      </ThemeProvider>
    );

    const provider = getByTestId('next-themes-provider');
    expect(provider).toBeInTheDocument();
    expect(provider).toHaveAttribute('defaulttheme', 'dark');
    expect(provider).toHaveAttribute('attribute', 'class');
    expect(getByText('Test Child')).toBeInTheDocument();
  });
});
