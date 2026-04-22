'use client';

import { useState, useEffect, useRef } from 'react';
import { useJobStore } from '../store/useJobStore';
import { Info, Loader2, Copy, Check, ChevronRight, AlertTriangle, ImageIcon } from 'lucide-react';

interface ProcessingConsoleProps {
  sessionId: string | null;
  expectedScenes?: number;
  onComplete: (data?: any) => void;
}

export default function ProcessingConsole({ sessionId, expectedScenes = 1, onComplete }: ProcessingConsoleProps) {
  const { jobs } = useJobStore();
  
  const [realProgress, setRealProgress] = useState<number>(0);
  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [hasCopied, setHasCopied] = useState(false);

  // Streaming logs state
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
  const [logQueue, setLogQueue] = useState<string[]>([]);
  const lastThresholdRef = useRef(-1);

  const sessionJobs = Object.values(jobs).filter(j => j.status !== 'PENDING'); 
  const totalJobs = Math.max(expectedScenes, sessionJobs.length);
  
  useEffect(() => {
    if (!sessionId) return;
    
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

  return (
    <div className="w-full max-w-2xl text-center px-6 animate-in fade-in duration-500 flex flex-col items-center">
      <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-8 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
        Processing Your Shoot
      </h2>
      
      {/* Real-time Job Status Grid */}
      <div className="w-full max-w-3xl mb-12">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {sessionJobs.map((job, i) => {
             const isDone = ['COMPLETED', 'FLAGGED', 'NEEDS_REVIEW', 'READY'].includes(job.status);
             const isFailed = job.status === 'FAILED';
             
             return (
                <div key={job.id} className="relative aspect-[3/2] rounded-xl overflow-hidden bg-[#0D0D0C] border border-[#2A2A2A] shadow-sm flex items-center justify-center group">
                   {isDone && job.result?.thumbUrl ? (
                      <>
                        <img 
                          src={job.result.thumbUrl} 
                          alt={`Scene ${i+1}`} 
                          className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        <div className="absolute bottom-2 left-2 right-2 text-left opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                           <span className="text-[10px] font-medium text-white truncate block drop-shadow-md">
                             {job.result.sceneName || `Scene ${i+1}`}
                           </span>
                        </div>
                      </>
                   ) : isFailed ? (
                      <div className="flex flex-col items-center gap-2 text-warning/80">
                         <AlertTriangle className="w-5 h-5" />
                         <span className="text-[10px] font-medium uppercase tracking-wider">Failed</span>
                      </div>
                   ) : (
                      <div className="flex flex-col items-center gap-3 w-full h-full justify-center">
                         <div className="relative">
                            <ImageIcon className="w-6 h-6 text-[#8A8A8A] opacity-20" />
                            <div className="absolute inset-0 flex items-center justify-center">
                               <div className="w-8 h-8 border-2 border-foreground/10 border-t-foreground/40 rounded-full animate-spin" />
                            </div>
                         </div>
                         <span className="text-[10px] uppercase font-bold tracking-widest text-[#8A8A8A]">Processing</span>
                      </div>
                   )}
                   
                   {/* Overlay Status Badge */}
                   <div className="absolute top-2 right-2 z-10">
                      {isDone ? (
                         <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center backdrop-blur-md border border-emerald-500/30">
                            <Check className="w-3 h-3 text-emerald-500" />
                         </div>
                      ) : isFailed ? null : (
                         <div className="w-2 h-2 rounded-full bg-[#B0A084] animate-pulse shadow-[0_0_8px_rgba(176,160,132,0.5)]" />
                      )}
                   </div>
                </div>
             );
          })}
          
          {/* Skeleton placeholders for expected scenes not yet in jobs (rare but possible during init) */}
          {Array.from({ length: Math.max(0, expectedScenes - sessionJobs.length) }).map((_, i) => (
             <div key={`skeleton-${i}`} className="relative aspect-[3/2] rounded-xl overflow-hidden bg-[#0D0D0C]/50 border border-[#2A2A2A]/50 shadow-sm flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-muted/30 animate-spin" />
             </div>
          ))}
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
