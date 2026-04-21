'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

interface ProcessingConsoleProps {
  sessionId: string | null;
  expectedRooms?: number;
  onComplete: (data?: any) => void;
}

export default function ProcessingConsole({ sessionId, expectedRooms = 1, onComplete }: ProcessingConsoleProps) {
  const { t } = useTranslation();
  
  const [realProgress, setRealProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(t('processing') || "Processing...");
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  useEffect(() => {
    if (!sessionId) return;

    let completedRooms = 0;
    const allResults: any[] = [];
    
    // Stateless 2-second HTTP polling
    const pollStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/hdr-jobs/${sessionId}/status`);
        if (!res.ok) return; // Silent fail on network blips, retry next cycle
        
        const data = await res.json();
        
        // Ensure we count both READY and FLAGGED as completed processing items
        const finishedItems = (data.results || []).filter((r: any) => 
           r.status === 'READY' || r.status === 'FLAGGED' || r.status === 'COMPLETED'
        );
        completedRooms = finishedItems.length;
        
        if (completedRooms > 0 && finishedItems.length > allResults.length) {
           // We have new results
           finishedItems.forEach((item: any) => {
               if (!allResults.find(r => r.room === item.room)) {
                   allResults.push(item);
               }
           });
        }

        if (completedRooms >= expectedRooms || data.status === 'JOB_FINISHED') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setRealProgress(100);
          setStatusMessage(t('status_completed') || "Batch Complete");
          setTimeout(() => onComplete(allResults), 800);
        } else {
          const percent = Math.floor((completedRooms / expectedRooms) * 100);
          // Fake a minimum 5% progress so the UI feels alive before the first room finishes
          setRealProgress(percent === 0 ? 5 : percent);
          setStatusMessage(`Processing (${completedRooms}/${expectedRooms})`);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    // Poll immediately, then every 2 seconds
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [onComplete, sessionId, API_URL, expectedRooms, t]);

  return (
    <div className="w-full max-w-2xl text-center px-6 animate-in fade-in duration-500">
      <h2 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-16">{t('crafting_imagery') || "Processing Batch"}</h2>
      
      <div 
        className="h-[60px] flex items-center justify-center overflow-hidden relative mb-12"
        aria-live="polite"
      >
         <div className="absolute transition-all duration-300 ease-out w-full text-center opacity-100 translate-y-0">
           <span className="text-xs md:text-sm tracking-[0.1em] uppercase text-muted font-sans">
             {statusMessage}
           </span>
         </div>
      </div>

      <div className="w-full h-px bg-border/40 relative overflow-hidden">
        <div 
          className="absolute top-0 left-0 h-full bg-foreground transition-all duration-500 ease-out"
          style={{ width: `${realProgress}%` }}
        />
      </div>
    </div>
  );
}
