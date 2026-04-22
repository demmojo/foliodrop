'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useJobStore } from '../store/useJobStore';
import { Info, Loader2 } from 'lucide-react';

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
      
      if (displayProgress < 20) setStatusMessage("Aligning structural details");
      else if (displayProgress < 50) setStatusMessage("Fusing dynamic range");
      else if (displayProgress < 80) setStatusMessage("Generative tone mapping");
      else setStatusMessage("Applying geometry corrections");
  }, [displayProgress]);

  return (
    <div className="w-full max-w-2xl text-center px-6 animate-in fade-in duration-500 flex flex-col items-center">
      <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-12 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
        Processing Your Shoot
      </h2>
      
      <div 
        className="h-[40px] flex items-center justify-center overflow-hidden relative mb-6"
        aria-live="polite"
      >
         <div className="absolute transition-all duration-300 ease-out w-full flex items-center justify-center gap-3 opacity-100 translate-y-0">
           <Loader2 className="w-4 h-4 text-white/50 animate-spin" />
           <span className="text-xs md:text-sm tracking-widest uppercase text-white/70 font-medium font-sans">
             {statusMessage}...
           </span>
         </div>
      </div>

      <div className="w-full max-w-md bg-black border border-white/10 h-1.5 rounded-full overflow-hidden mb-12 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] relative">
        <div 
          className="absolute top-0 left-0 h-full bg-white transition-all duration-300 ease-linear overflow-hidden"
          style={{ width: `${displayProgress}%` }}
        >
          {/* Shimmer effect inside the progress fill */}
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-black/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite_linear]" />
        </div>
      </div>

      <div className="backdrop-blur-md bg-white/[0.02] border border-white/[0.05] shadow-lg rounded-2xl px-6 py-4 flex items-start gap-4 max-w-md mx-auto text-left transition-all hover:bg-white/[0.04]">
         <div className="bg-white/10 p-2 rounded-full mt-0.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]">
            <Info className="w-4 h-4 text-white/80" />
         </div>
         <div>
            <h4 className="text-sm font-semibold text-white/90 mb-1">Safe to leave this page</h4>
            <p className="text-xs text-white/50 leading-relaxed font-medium">
               Generative processing takes time. We&apos;ll handle everything in the background and notify you when your 16-bit TIFFs and MLS JPEGs are ready.
            </p>
         </div>
      </div>
    </div>
  );
}
