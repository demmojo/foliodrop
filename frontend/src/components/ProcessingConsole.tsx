'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useJobStore } from '../store/useJobStore';
import { Info, Loader2, Copy, Check } from 'lucide-react';

interface ProcessingConsoleProps {
  sessionId: string | null;
  expectedRooms?: number;
  onComplete: (data?: any) => void;
}

export default function ProcessingConsole({ sessionId, expectedRooms = 1, onComplete }: ProcessingConsoleProps) {
  const { t } = useTranslation();
  const { jobs } = useJobStore();
  
  const [realProgress, setRealProgress] = useState<number>(0);
  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("Analyzing image structures");
  const [hasCopied, setHasCopied] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const sessionJobs = Object.values(jobs).filter(j => j.status !== 'PENDING'); 
    const totalJobs = Math.max(expectedRooms, sessionJobs.length);
    
    const completedItems = sessionJobs.filter(j => 
       ['COMPLETED', 'FLAGGED', 'NEEDS_REVIEW', 'READY', 'FAILED'].includes(j.status)
    );
    const completedCount = completedItems.length;

    if (completedCount > 0 && completedCount >= totalJobs) {
      setRealProgress(100);
      setStatusMessage("Finalizing exports");
      setTimeout(() => onComplete(completedItems.map(j => j.result)), 800);
    } else {
      const percent = Math.floor((completedCount / totalJobs) * 100);
      setRealProgress(percent === 0 ? 5 : percent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, sessionId, expectedRooms, onComplete]);

   // "Creep" the display progress forward to simulate active work during long 60s waits
  useEffect(() => {
    if (realProgress >= 100) {
      setDisplayProgress(100);
      return;
    }

    setDisplayProgress(prev => Math.max(prev, realProgress));

    const interval = setInterval(() => {
      setDisplayProgress(prev => {
        // Allow the bar to creep up to 15% past actual completion
        const maxCreep = realProgress + 15;
        if (prev < maxCreep && prev < 95) {
          return prev + 0.3; // Very slow tick
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [realProgress]);

  // Update status message based on simulated progress rather than just time
  useEffect(() => {
      if (displayProgress >= 100) return;
      
      if (displayProgress < 20) setStatusMessage(t('status_aligning'));
      else if (displayProgress < 50) setStatusMessage(t('status_masking'));
      else if (displayProgress < 80) setStatusMessage(t('status_fusing'));
      else setStatusMessage(t('status_denoising'));
  }, [displayProgress]);

  return (
    <div className="w-full max-w-2xl text-center px-6 animate-in fade-in duration-500 flex flex-col items-center">
      <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-12 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
        Processing Your Shoot
      </h2>
      
      <div 
        className="h-[40px] flex items-center justify-center overflow-hidden relative mb-6"
        aria-live="polite"
      >
         <div className="absolute transition-all duration-300 ease-out w-full flex items-center justify-center gap-3 opacity-100 translate-y-0">
           <Loader2 className="w-4 h-4 text-muted animate-spin" />
           <span className="text-xs md:text-sm tracking-widest uppercase text-muted font-medium font-sans">
             {statusMessage}...
           </span>
         </div>
      </div>

      <div className="w-full max-w-md bg-border h-1.5 rounded-full overflow-hidden mb-12 relative">
        <div 
          className="absolute top-0 left-0 h-full bg-foreground transition-all duration-300 ease-linear overflow-hidden"
          style={{ width: `${displayProgress}%` }}
        >
          {/* Shimmer effect inside the progress fill */}
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-background/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite_linear]" />
        </div>
      </div>

      <div className="bg-surface border border-border shadow-sm rounded-2xl px-6 py-4 flex items-start gap-4 max-w-md mx-auto text-left transition-all hover:bg-surface/80">
         <div className="bg-foreground/5 border border-border p-2 rounded-full mt-0.5 shadow-sm">
            <Info className="w-4 h-4 text-foreground/80" />
         </div>
         <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">Safe to leave this page</h4>
            <p className="text-xs text-muted leading-relaxed font-medium">
               Generative processing takes time. We&apos;ll handle everything in the background. You can use your session code to resume later.
            </p>
         </div>
      </div>

      {sessionId && (
        <div className="mt-8 flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
           <p className="text-xs text-muted mb-3 font-medium uppercase tracking-wider">Session Code (Valid for 30 days)</p>
           <div className="flex items-center gap-2 bg-surface border border-border pl-4 pr-1 py-1 rounded-full shadow-sm">
             <code className="text-sm font-mono text-foreground font-medium select-all">{sessionId}</code>
             <button
               onClick={() => {
                 navigator.clipboard.writeText(sessionId);
                 setHasCopied(true);
                 setTimeout(() => setHasCopied(false), 2000);
               }}
               className="p-2 hover:bg-foreground/5 rounded-full transition-colors ml-2"
               title="Copy to clipboard"
             >
               {hasCopied ? (
                 <Check className="w-4 h-4 text-emerald-500" />
               ) : (
                 <Copy className="w-4 h-4 text-muted hover:text-foreground" />
               )}
             </button>
           </div>
        </div>
      )}
    </div>
  );
}
