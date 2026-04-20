'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { Language } from '../i18n/dictionaries';

const languages: { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'sk', label: 'Slovenčina', flag: '🇸🇰' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'el', label: 'Ελληνικά', flag: '🇬🇷' },
];

export function LanguageSelector() {
  const { lang, setLang } = useTranslation();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-24 h-8 animate-pulse bg-border dark:bg-zinc-800 rounded" />;
  }

  return (
    <div className="relative">
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Language)}
        className="appearance-none bg-surface border border-border text-foreground text-xs md:text-sm rounded px-3 py-1.5 pr-8 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 transition-colors cursor-pointer shadow-sm"
        aria-label="Select language"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted">
        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </div>
    </div>
  );
}