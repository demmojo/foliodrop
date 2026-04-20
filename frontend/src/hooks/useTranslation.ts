import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Language, dictionaries } from '../i18n/dictionaries';

interface TranslationStore {
  lang: Language;
  setLang: (lang: Language) => void;
}

export const useTranslationStore = create<TranslationStore>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
    }),
    {
      name: 'folio-language',
    }
  )
);

export function useTranslation() {
  const { lang, setLang } = useTranslationStore();

  const t = (key: string): string => {
    return dictionaries[lang][key] || dictionaries['en'][key] || key;
  };

  return { t, lang, setLang };
}