'use client';

import { Suspense } from 'react';
import UploadFlow from '@/components/UploadFlow';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSelector } from '@/components/LanguageSelector';
import { useTranslation } from '@/hooks/useTranslation';

export default function Home() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-background font-sans text-foreground selection:bg-accent selection:text-white flex flex-col transition-colors duration-300">
      {/* Editorial Header */}
      <header className="w-full flex justify-between items-center px-4 py-4 md:py-6 md:px-8 z-50 border-b border-border dark:border-zinc-800">
        <div className="flex gap-3 md:gap-4 items-baseline">
          <h1 className="text-lg md:text-xl lg:text-2xl font-bold tracking-tight m-0 leading-none">{t('folio')}</h1>
          <span className="font-mono text-[9px] md:text-[10px] uppercase tracking-widest px-1.5 py-0.5 bg-foreground text-background rounded-sm">{t('beta')}</span>
        </div>
        <div className="flex items-center gap-3 md:gap-6">
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 flex flex-col w-full relative">
        <Suspense fallback={<div className="flex-1 flex items-center justify-center p-8"><span className="animate-pulse text-muted">{t('loading_workspace')}</span></div>}>
          <UploadFlow />
        </Suspense>
      </div>
    </main>
  );
}