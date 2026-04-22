'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useJobStore } from '../store/useJobStore';
import { Info, Loader2, Copy, Check, ChevronRight } from 'lucide-react';

interface ProcessingConsoleProps {
  sessionId: string | null;
  expectedScenes?: number;
  onComplete: (data?: any) => void;
}

const ALL_STAGES = [
  { threshold: 0, text: "Initializing generative pipeline..." },
  { threshold: 5, text: "Allocating cloud compute instances..." },
  { threshold: 12, text: "Analyzing architectural structures..." },
  { threshold: 20, text: "Aligning bracket exposures..." },
  { threshold: 30, text: "Extracting windows and highlights..." },
  { threshold: 40, text: "Fusing dynamic range..." },
  { threshold: 55, text: "Applying generative tone mapping..." },
  { threshold: 70, text: "Applying geometry & perspective corrections..." },
  { threshold: 85, text: "Enhancing micro-contrast & textures..." },
  { threshold: 92, text: "Running AI color grading..." },
  { threshold: 98, text: "Finalizing ML outputs..." },
];

export default function ProcessingConsole({ sessionId, expectedScenes = 1, onComplete }: ProcessingConsoleProps) {
  const { t } = useTranslation();
  const { jobs } = useJobStore();
  
  const [realProgress, setRealProgress] = useState<number>(0);
  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [hasCopied, setHasCopied] = useState(false);

  // Streaming logs state
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const lastThresholdRef = useRef(-1);

  useEffect(() => {
    if (!sessionId) return;

    const sessionJobs = Object.values(jobs).filter(j => j.status !== 'PENDING'); 
    const totalJobs = Math.max(expectedScenes, sessionJobs.length);
    
    const completedItems = sessionJobs.filter(j => 
       ['COMPLETED', 'FLAGGED', 'NEEDS_REVIEW', 'READY', 'FAILED'].includes(j.status)
    );
    const completedCount = completedItems.length;

    if (completedCount > 0 && completedCount >= totalJobs) {
      setRealProgress(100);
      // Let the queue drain before calling onComplete if possible, or just call it after a short delay
      setTimeout(() => onComplete(completedItems.map(j => j.result)), 2500);
    } else {
      const percent = Math.floor((completedCount / totalJobs) * 100);
      setRealProgress(percent === 0 ? 5 : percent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, sessionId, expectedScenes, onComplete]);

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

  // Enqueue logs based on displayProgress
  useEffect(() => {
    const newStages = ALL_STAGES.filter(
      s => s.threshold > lastThresholdRef.current && s.threshold <= displayProgress
    );

    if (newStages.length > 0) {
      setLogQueue(prev => [...prev, ...newStages.map(s => s.text)]);
      lastThresholdRef.current = newStages[newStages.length - 1].threshold;
    }
  }, [displayProgress]);

  // Dequeue logs one by one with a short delay so the user can read them
  useEffect(() => {
    if (logQueue.length > 0) {
      const timer = setTimeout(() => {
        setVisibleLogs(prev => {
           const next = [...prev, logQueue[0]];
           // Keep at most 5 lines
           if (next.length > 5) return next.slice(next.length - 5);
           return next;
        });
        setLogQueue(prev => prev.slice(1));
      }, 1200); // 1.2s delay between streaming lines
      return () => clearTimeout(timer);
    }
  }, [logQueue]);

  return (
    <div className="w-full max-w-2xl text-center px-6 animate-in fade-in duration-500 flex flex-col items-center">
      <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-8 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
        Processing Your Shoot
      </h2>
      
      {/* Console Streaming Logs */}
      <div className="w-full max-w-md bg-[#0D0D0C] border border-[#2A2A2A] shadow-2xl rounded-xl p-5 mb-8 h-[160px] relative flex flex-col justify-end text-left overflow-hidden">
         {/* Top fade out gradient */}
         <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-[#0D0D0C] to-transparent z-10" />
         
         <div className="flex flex-col gap-3 z-0 w-full">
            {visibleLogs.length === 0 && (
               <div className="flex items-center gap-3 text-sm font-mono text-[#8A8A8A] opacity-60">
                 <Loader2 className="w-4 h-4 animate-spin" />
                 Waking up pipeline...
               </div>
            )}
            {visibleLogs.map((log, i) => {
               const isLast = i === visibleLogs.length - 1;
               const opacity = isLast ? 'opacity-100' : (i === visibleLogs.length - 2 ? 'opacity-70' : 'opacity-40');
               const color = isLast ? 'text-[#EAEAEA]' : 'text-[#8A8A8A]';
               
               return (
                  <div key={`${log}-${i}`} className={`flex items-center gap-3 text-sm font-mono tracking-tight transition-all duration-500 ${opacity} ${color} ${isLast ? 'translate-x-0' : 'translate-x-0'}`}>
                     {isLast && displayProgress < 100 ? (
                        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[#B0A084]" />
                     ) : (
                        <Check className="w-4 h-4 text-[#4E6E50] shrink-0" />
                     )}
                     <span className="truncate">{log}</span>
                  </div>
               );
            })}
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
