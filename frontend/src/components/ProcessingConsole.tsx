'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useJobStore } from '../store/useJobStore';

interface ProcessingConsoleProps {
  sessionId: string | null;
  expectedRooms?: number;
  onComplete: (data?: any) => void;
}

export default function ProcessingConsole({ sessionId, expectedRooms = 1, onComplete }: ProcessingConsoleProps) {
  const { t } = useTranslation();
  const { jobs } = useJobStore();
  
  const [realProgress, setRealProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(t('processing') || "Processing...");

  useEffect(() => {
    if (!sessionId) return;

    // Filter jobs for this session
    const sessionJobs = Object.values(jobs).filter(j => j.status !== 'PENDING'); 
    // Assuming expectedRooms roughly equals job count
    const totalJobs = Math.max(expectedRooms, sessionJobs.length);
    
    const completedItems = sessionJobs.filter(j => 
       ['COMPLETED', 'FLAGGED', 'NEEDS_REVIEW', 'READY', 'FAILED'].includes(j.status)
    );
    const completedCount = completedItems.length;

    if (completedCount > 0 && completedCount >= totalJobs) {
      setRealProgress(100);
      setStatusMessage(t('status_completed') || "Batch Complete");
      // Let UploadFlow transition state automatically based on job status,
      // but we can call onComplete just in case
      setTimeout(() => onComplete(completedItems.map(j => j.result)), 800);
    } else {
      const percent = Math.floor((completedCount / totalJobs) * 100);
      setRealProgress(percent === 0 ? 5 : percent);
      setStatusMessage(`Processing (${completedCount}/${totalJobs})`);
    }
  }, [jobs, sessionId, expectedRooms, onComplete, t]);

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
