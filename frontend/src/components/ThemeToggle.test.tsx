import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';
import { useTheme } from 'next-themes';

vi.mock('next-themes', () => ({
  useTheme: vi.fn()
}));

describe('ThemeToggle', () => {
  it('renders and toggles theme', () => {
    const setThemeMock = vi.fn();
    (useTheme as any).mockReturnValue({ theme: 'light', setTheme: setThemeMock });

    render(<ThemeToggle />);
    
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    
    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });

  it('toggles to light if currently dark', () => {
    const setThemeMock = vi.fn();
    (useTheme as any).mockReturnValue({ resolvedTheme: 'dark', setTheme: setThemeMock });

    render(<ThemeToggle />);
    
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    
    expect(setThemeMock).toHaveBeenCalledWith('light');
  });
});