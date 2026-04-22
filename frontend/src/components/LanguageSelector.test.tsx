import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LanguageSelector } from './LanguageSelector';

const setLangMock = vi.fn();

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ lang: 'en', setLang: setLangMock })
}));

describe('LanguageSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders and changes language', async () => {
    render(<LanguageSelector />);
    
    // Fast forward to mount
    act(() => {
      vi.runAllTimers();
    });

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    
    fireEvent.change(select, { target: { value: 'es' } });
    
    expect(setLangMock).toHaveBeenCalledWith('es');
  });
});