import { create } from 'zustand';

export interface ProcessedHDR {
  id: string;
  url: string;
  thumbUrl?: string;
  originalUrl?: string; 
  sceneName: string;
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
  initialThumbUrl?: string;
}

interface Quota {
  used: number;
  limit: number;
}

interface StyleProfile {
  id: string;
  name: string;
  url?: string;
  createdAt: number;
}

interface JobStore {
  jobs: Record<string, Job>;
  activeSessionId: string | null;
  quota: Quota | null;
  styleProfiles: StyleProfile[];
  addJobs: (ids: string[], sessionId: string, initialThumbUrls?: string[]) => void;
  rehydrateSession: (sessionId: string) => Promise<void>;
  pollDueJobs: () => Promise<void>;
  fetchQuota: () => Promise<void>;
  setJobs: (jobs: Record<string, Job>) => void;
  setSessionId: (id: string | null) => void;
  setStyleProfiles: (profiles: StyleProfile[]) => void;
  fetchStyleProfiles: () => Promise<void>;
  deleteStyleProfile: (id: string) => Promise<void>;
  uploadStyleProfile: (file: File) => Promise<void>;
  uploadTrainingPair: (brackets: File[], finalEdit: File) => Promise<void>;
  overrideWithManualEdit: (jobId: string, file: File) => Promise<void>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export const useJobStore = create<JobStore>((set, get) => ({
  jobs: {},
  activeSessionId: null,
  quota: null,
  styleProfiles: [],
  
  setJobs: (jobs) => set({ jobs }),
  setSessionId: (id) => set({ activeSessionId: id }),
  setStyleProfiles: (profiles) => set({ styleProfiles: profiles }),

  fetchStyleProfiles: async () => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};
      
      const res = await fetch(`${API_URL}/api/v1/style/profiles`, { headers });
      if (res.ok) {
        const data = await res.json();
        const profiles = (data.profiles || []).map((p: any) => ({
          id: p.id,
          name: p.blob_path.split('_').pop() || 'Style Profile',
          url: p.url,
          createdAt: p.created_at
        }));
        set({ styleProfiles: profiles });
      }
    } catch (e) {
      console.error("Failed to fetch style profiles", e);
    }
  },

  deleteStyleProfile: async (id: string) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const res = await fetch(`${API_URL}/api/v1/style/profiles/${id}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        set((state) => ({
          styleProfiles: state.styleProfiles.filter((p) => p.id !== id)
        }));
      }
    } catch (e) {
      console.error("Failed to delete style profile", e);
    }
  },

  uploadStyleProfile: async (file: File) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/api/v1/style/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (res.ok) {
        await get().fetchStyleProfiles();
      }
    } catch (e) {
      console.error("Failed to upload style profile", e);
    }
  },

  uploadTrainingPair: async (brackets: File[], finalEdit: File) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const formData = new FormData();
      brackets.forEach(b => formData.append('brackets', b));
      formData.append('final_edit', finalEdit);
      const res = await fetch(`${API_URL}/api/v1/training/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) {
        console.error("Failed to upload training pair");
      }
    } catch (e) {
      console.error("Failed to upload training pair", e);
    }
  },

  overrideWithManualEdit: async (jobId: string, file: File) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/override`, {
        method: 'POST',
        headers,
        body: formData,
      });
      
      if (!res.ok) {
        console.error("Failed to override with manual edit");
      }
      
      // Update local state optimistic/mock if backend isn't ready
      const mockUrl = URL.createObjectURL(file);
      set((state) => {
        const updatedJobs = { ...state.jobs };
        if (updatedJobs[jobId] && updatedJobs[jobId].result) {
          updatedJobs[jobId].result = {
            ...updatedJobs[jobId].result!,
            url: mockUrl,
            thumbUrl: mockUrl,
            status: 'APPROVED',
          };
          updatedJobs[jobId].status = 'COMPLETED';
        }
        return { jobs: updatedJobs };
      });
    } catch (e) {
      console.error("Failed to override with manual edit", e);
    }
  },

  fetchQuota: async () => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const res = await fetch(`${API_URL}/api/v1/quota`, { headers });
      if (res.ok) {
        const data = await res.json();
        set({ quota: data });
      }
    } catch (e) {
      console.error("Failed to fetch quota", e);
    }
  },

  addJobs: (ids, sessionId, initialThumbUrls) => {
    const now = Date.now();
    set((state) => {
      const newJobs = { ...state.jobs };
      ids.forEach((id, idx) => {
        newJobs[id] = { 
          id, 
          status: 'PENDING', 
          nextPollAt: now,
          initialThumbUrl: initialThumbUrls?.[idx]
        };
      });
      return { jobs: newJobs, activeSessionId: sessionId };
    });
  },

  rehydrateSession: async (sessionId: string) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const res = await fetch(`${API_URL}/api/v1/jobs/active?session_id=${sessionId}`, { headers });
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
              result: jobData.result ? {
                  id: jobData.id,
                  url: jobData.result.url,
                  thumbUrl: jobData.result.thumb_url || jobData.result.url,
                  originalUrl: jobData.result.original_url || jobData.result.original_blob_path,
                  sceneName: jobData.result.room,
                  status: 'NEEDS_REVIEW',
                  isFlagged: jobData.result.isFlagged,
                  vlmReport: jobData.result.vlmReport
              } : undefined,
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
    
    const dueIds = Object.values(jobs)
      .filter(job => ['PENDING', 'PROCESSING'].includes(job.status))
      .filter(job => job.nextPollAt <= now)
      .map(job => job.id);

    if (dueIds.length === 0) return;

    try {
      const { auth } = await import('@/lib/firebase');
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/v1/jobs/batch-status`, {
        method: 'POST',
        headers,
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
                    originalUrl: jobData.result.original_url || jobData.result.original_blob_path, // If we get signed URL for this it should be mapped
                    sceneName: jobData.result.room,
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
