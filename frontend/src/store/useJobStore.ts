import { create } from 'zustand';
import { getLocalAnonAgencyId, getScopedAuthHeaders } from '@/lib/requestHeaders';

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
  blobPath?: string;
  isLocal?: boolean;
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
const LOCAL_STYLE_PROFILE_KEY_PREFIX = 'folio_local_style_profiles_v1';

const normalizeProfileUrl = (value?: string): string | undefined => {
  if (!value || typeof value !== 'string') return undefined;
  try {
    return new URL(value, API_URL).toString();
  } catch {
    return undefined;
  }
};

const extractProfileName = (blobPath?: string): string => {
  if (!blobPath || typeof blobPath !== 'string') return 'Style Profile';
  const filename = blobPath.split('/').pop() || blobPath;
  return filename.replace(/^[a-f0-9]{8}_/, '');
};

const getLocalAnonId = (): string => {
  return getLocalAnonAgencyId();
};

const getLocalStyleProfileStorageKey = (): string => {
  return `${LOCAL_STYLE_PROFILE_KEY_PREFIX}:${getLocalAnonId()}`;
};

const readLocalStyleProfiles = (): StyleProfile[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getLocalStyleProfileStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === 'string').map((p) => ({
      id: p.id,
      name: p.name || 'Style Profile',
      url: p.url,
      createdAt: Number(p.createdAt) || Date.now(),
      isLocal: true,
    }));
  } catch {
    return [];
  }
};

const writeLocalStyleProfiles = (profiles: StyleProfile[]): void => {
  if (typeof window === 'undefined') return;
  const serializable = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    createdAt: p.createdAt,
    isLocal: true,
  }));
  window.localStorage.setItem(getLocalStyleProfileStorageKey(), JSON.stringify(serializable));
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

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
      const headers = await getScopedAuthHeaders();
      if (!headers.Authorization) {
        set({ styleProfiles: readLocalStyleProfiles() });
        return;
      }
      
      const res = await fetch(`${API_URL}/api/v1/style/profiles`, { headers });
      if (res.ok) {
        const data = await res.json();
        const profiles = (data.profiles || []).map((p: any) => ({
          id: p.id,
          name: extractProfileName(p.blob_path),
          url: normalizeProfileUrl(p.url),
          createdAt: Number(p.created_at) || Date.now(),
          blobPath: p.blob_path,
        }));
        set({ styleProfiles: profiles });
      }
    } catch (e) {
      console.error("Failed to fetch style profiles", e);
    }
  },

  deleteStyleProfile: async (id: string) => {
    try {
      const headers = await getScopedAuthHeaders();
      if (!headers.Authorization) {
        const next = get().styleProfiles.filter((p) => p.id !== id);
        writeLocalStyleProfiles(next);
        set({ styleProfiles: next });
        return;
      }

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
      const headers = await getScopedAuthHeaders();
      if (!headers.Authorization) {
        const url = await fileToDataUrl(file);
        const profile: StyleProfile = {
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || 'Style Profile',
          url,
          createdAt: Date.now(),
          isLocal: true,
        };
        const next = [profile, ...readLocalStyleProfiles()];
        writeLocalStyleProfiles(next);
        set({ styleProfiles: next });
        return;
      }

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
    const headers = await getScopedAuthHeaders();

    const formData = new FormData();
    brackets.forEach(b => formData.append('brackets', b));
    formData.append('final_edit', finalEdit);
    const res = await fetch(`${API_URL}/api/v1/training/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      let message = 'Failed to upload training pair';
      try {
        const body = await res.json();
        const detail = body?.detail;
        if (typeof detail === 'string') {
          message = detail;
        } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
          message = detail.message;
        }
      } catch {
        /* fall through with default message */
      }
      console.error(message);
      throw new Error(message);
    }
  },

  overrideWithManualEdit: async (jobId: string, file: File) => {
    try {
      const headers = await getScopedAuthHeaders();

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
      const headers = await getScopedAuthHeaders();

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
      const headers = await getScopedAuthHeaders();

      const res = await fetch(`${API_URL}/api/v1/jobs/active?session_id=${sessionId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const now = Date.now();
        set((state) => {
          const newJobs: Record<string, Job> = {};
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
      const headers = await getScopedAuthHeaders({ includeContentTypeJson: true });

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
            
            // Backend returns COMPLETED or FLAGGED for reviewable jobs; both ship signed
            // URLs and need to be normalized into the ProcessedHDR shape.
            if (jobData.result && (jobData.status === 'COMPLETED' || jobData.status === 'FLAGGED')) {
                updatedJobs[jobData.id].result = {
                    id: jobData.id,
                    url: jobData.result.url,
                    thumbUrl: jobData.result.thumb_url || jobData.result.url,
                    originalUrl: jobData.result.original_url || jobData.result.original_blob_path,
                    sceneName: jobData.result.room,
                    status: 'NEEDS_REVIEW',
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
