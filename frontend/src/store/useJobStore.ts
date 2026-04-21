import { create } from 'zustand';

export interface ProcessedHDR {
  id: string;
  url: string;
  thumbUrl?: string;
  originalUrl?: string; 
  roomName: string;
  status: string;
  isFlagged?: boolean;
  vlmReport?: any;
}

interface Job {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'FLAGGED' | 'NEEDS_REVIEW' | 'READY';
  nextPollAt: number; // Unix timestamp
  result?: ProcessedHDR;
  error?: string;
}

interface JobStore {
  jobs: Record<string, Job>;
  activeSessionId: string | null;
  addJobs: (ids: string[], sessionId: string) => void;
  rehydrateSession: (sessionId: string) => Promise<void>;
  pollDueJobs: () => Promise<void>;
  setJobs: (jobs: Record<string, Job>) => void;
  setSessionId: (id: string | null) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export const useJobStore = create<JobStore>((set, get) => ({
  jobs: {},
  activeSessionId: null,
  
  setJobs: (jobs) => set({ jobs }),
  setSessionId: (id) => set({ activeSessionId: id }),

  addJobs: (ids, sessionId) => {
    const now = Date.now();
    set((state) => {
      const newJobs = { ...state.jobs };
      ids.forEach(id => {
        newJobs[id] = { id, status: 'PENDING', nextPollAt: now };
      });
      return { jobs: newJobs, activeSessionId: sessionId };
    });
  },

  rehydrateSession: async (sessionId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/jobs/active?session_id=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        const now = Date.now();
        set((state) => {
          const newJobs = { ...state.jobs };
          data.jobs.forEach((jobData: any) => {
            newJobs[jobData.id] = {
              id: jobData.id,
              status: jobData.status,
              nextPollAt: now,
              result: jobData.result,
              error: jobData.error
            };
          });
          return { jobs: newJobs, activeSessionId: sessionId };
        });
      }
    } catch (err) {
      console.error("Failed to rehydrate session", err);
    }
  },

  pollDueJobs: async () => {
    const { jobs } = get();
    const now = Date.now();
    
    // Gather only the IDs that are due for polling
    const dueIds = Object.values(jobs)
      .filter(job => ['PENDING', 'PROCESSING'].includes(job.status))
      .filter(job => job.nextPollAt <= now)
      .map(job => job.id);

    if (dueIds.length === 0) return;

    try {
      const res = await fetch(`${API_URL}/api/v1/jobs/batch-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: dueIds })
      });
      
      const globalRetryAfter = res.headers.get('Retry-After');
      const globalDelayMs = globalRetryAfter ? parseInt(globalRetryAfter) * 1000 : 0;

      if (res.ok) {
        const data = await res.json();
        
        set((state) => {
          const updatedJobs = { ...state.jobs };
          
          data.jobs.forEach((jobData: any) => {
            const delayMs = jobData.retryAfterSeconds 
               ? jobData.retryAfterSeconds * 1000 
               : Math.max(globalDelayMs, 5000);

            updatedJobs[jobData.id] = {
              ...updatedJobs[jobData.id],
              status: jobData.status,
              result: jobData.result,
              error: jobData.error,
              nextPollAt: Date.now() + delayMs
            };
            
            // Map the result properties
            if (jobData.result && jobData.status === 'COMPLETED') {
                updatedJobs[jobData.id].result = {
                    id: jobData.id,
                    url: jobData.result.url,
                    thumbUrl: jobData.result.thumb_url || jobData.result.url,
                    originalUrl: jobData.result.original_blob_path, // If we get signed URL for this it should be mapped
                    roomName: jobData.result.room,
                    status: 'NEEDS_REVIEW', // Manual Default as per plan
                    isFlagged: jobData.result.isFlagged,
                    vlmReport: jobData.result.vlmReport
                };
            }
          });
          
          return { jobs: updatedJobs };
        });
      }
    } catch (error) {
      console.error("Batch polling failed", error);
    }
  }
}));

// Set up the centralized ticker
if (typeof window !== 'undefined') {
  setInterval(() => {
    useJobStore.getState().pollDueJobs();
  }, 2000);
}
