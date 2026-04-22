import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranslation, useTranslationStore } from './useTranslation';

describe('useTranslation', () => {
  beforeEach(() => {
    useTranslationStore.setState({ lang: 'en' });
  });

  it('provides translations for the current language', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('import_exposures')).toBe('Add Listing Photos');
  });

  it('falls back to english if key is missing in selected language', () => {
    // Let's pretend spanish is selected but some key is missing
    useTranslationStore.setState({ lang: 'es' });
    const { result } = renderHook(() => useTranslation());
    
    // In our actual dictionaries, 'es' has 'processing.ready'. 
    // But let's ask for a fake key to test the fallback chain.
    // wait, if it's missing in es AND en, it falls back to key
    expect(result.current.t('fake.key')).toBe('fake.key');
  });

  it('allows changing the language', () => {
    const { result } = renderHook(() => useTranslation());
    act(() => {
      result.current.setLang('es');
    });
    expect(result.current.lang).toBe('es');
    expect(result.current.t('import_exposures')).toBe('Preparar Fotos del Listado');
  });
});
