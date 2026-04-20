'use client';

import { useState, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

interface ProcessingConsoleProps {
  sessionId: string | null;
  onComplete: (data?: any) => void;
}

export default function ProcessingConsole({ sessionId, onComplete }: ProcessingConsoleProps) {
  const { t } = useTranslation();
  
  const statusLabels = useMemo<Record<string, string>>(() => ({
    'ALIGNING': t('status_aligning'),
    'SEMANTIC_MASKING': t('status_masking'),
    'FUSING': t('status_fusing'),
    'DENOISING': t('status_denoising'),
    'AI_REVIEW_AND_EDIT': t('status_ai_review'),
    'COMPLETED': t('status_completed'),
    'FINISHED': t('status_completed'),
    'FAILED': t('status_failed')
  }), [t]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [realProgress, setRealProgress] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  useEffect(() => {
    if (!sessionId) {
      // Mock progression if offline
      if (activeIndex >= Object.values(statusLabels).length - 3) {
        setTimeout(() => onComplete(), 800);
        return;
      }

      const timer = setTimeout(() => {
        setActiveIndex(prev => prev + 1);
      }, 400);

      return () => clearTimeout(timer);
    } else {
      // Real SSE progression
      const eventSource = new EventSource(`${API_URL}/api/v1/hdr-jobs/${sessionId}/progress`);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status === 'COMPLETED' || data.status === 'FINISHED') {
           eventSource.close();
           setRealProgress(100);
           setStatusMessage(t('status_completed'));
           // the payload usually contains the final URLs
           setTimeout(() => onComplete(data.result || data.results || []), 800);
        } else {
           // E.g. {"status": "ALIGNING", "room": "kitchen", "progress": 20}
           if (data.progress !== undefined) {
             setRealProgress(data.progress);
           } else {
             // Fake progress bump based on status
             setRealProgress(prev => Math.min((prev || 0) + 15, 95));
           }
           setStatusMessage(statusLabels[data.status] || data.status || t('processing'));
        }
      };

      eventSource.onerror = (err) => {
        console.error("SSE Error:", err);
        // Fallback gracefully to completion if it drops after a while
        eventSource.close();
        setTimeout(() => onComplete(), 1500);
      };

      return () => {
        eventSource.close();
      };
    }
  }, [activeIndex, onComplete, sessionId, API_URL, statusLabels]);

    const progress = sessionId && realProgress !== null 
    ? realProgress 
    : Math.min(((activeIndex) / (Object.values(statusLabels).length - 3)) * 100, 100);

  return (
    <div className="w-full max-w-2xl text-center px-6 animate-in fade-in duration-500">
      <h2 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-16">{t('crafting_imagery')}</h2>
      
      <div 
        className="h-[60px] flex items-center justify-center overflow-hidden relative mb-12"
        aria-live="polite"
        aria-atomic="false"
      >
          {sessionId && statusMessage ? (
             <div className="absolute transition-all duration-300 ease-out w-full text-center opacity-100 translate-y-0">
               <span className="text-xs md:text-sm tracking-[0.1em] uppercase text-muted font-sans">
                 {statusMessage}
               </span>
             </div>
          ) : (
            Object.values(statusLabels).slice(0, -3).map((label, idx) => {
              const isCurrent = idx === activeIndex;
              const isPast = idx < activeIndex;
              return (
                <div
                  key={label}
                  aria-hidden={!isCurrent}
                  className={clsx(
                    "absolute transition-all duration-300 ease-out w-full text-center",
                    isCurrent ? "opacity-100 translate-y-0" : 
                    isPast ? "opacity-0 -translate-y-4" : "opacity-0 translate-y-4 pointer-events-none"
                  )}
                >
                  <span className="text-xs md:text-sm tracking-[0.1em] uppercase text-muted font-sans">
                    {label}
                  </span>
                </div>
              );
            })
          )}
      </div>

      {/* Minimal Progress Line */}
      <div className="w-full max-w-md mx-auto h-px bg-border relative overflow-hidden">
        <div 
          className="absolute top-0 left-0 bottom-0 bg-accent transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-6 font-mono text-xs text-muted">
        {Math.round(progress)}%
      </div>
    </div>
  );
}