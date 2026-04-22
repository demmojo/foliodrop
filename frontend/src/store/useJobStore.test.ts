import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useJobStore } from './useJobStore';

// Smart mock fetch
const mockFetch = vi.fn().mockImplementation((url) => {
  if (typeof url === 'string' && url.includes('127.0.0.1:7781/ingest')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  return Promise.resolve({
    ok: true,
    headers: { get: vi.fn() },
    clone: () => ({ json: () => Promise.resolve({}) }),
    json: () => Promise.resolve({ jobs: [] })
  });
});
global.fetch = mockFetch;

describe('useJobStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useJobStore.setState({
      jobs: {},
      activeSessionId: null,
      quota: null,
      styleProfiles: [],
    });
    // @ts-ignore
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8080';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic state setters', () => {
    it('should set jobs', () => {
      const mockJobs = {
        'job1': { id: 'job1', status: 'PENDING', nextPollAt: 123 }
      } as any;
      useJobStore.getState().setJobs(mockJobs);
      expect(useJobStore.getState().jobs).toEqual(mockJobs);
    });

    it('should set session id', () => {
      useJobStore.getState().setSessionId('sess123');
      expect(useJobStore.getState().activeSessionId).toBe('sess123');
    });

    it('should set style profiles', () => {
      const mockProfiles = [{ id: '1', name: 'Profile 1', createdAt: 123 }];
      useJobStore.getState().setStyleProfiles(mockProfiles);
      expect(useJobStore.getState().styleProfiles).toEqual(mockProfiles);
    });

    it('should add jobs', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      
      useJobStore.getState().addJobs(['job1', 'job2'], 'sess123');
      
      const state = useJobStore.getState();
      expect(state.activeSessionId).toBe('sess123');
      expect(state.jobs['job1']).toEqual({ id: 'job1', status: 'PENDING', nextPollAt: now });
      expect(state.jobs['job2']).toEqual({ id: 'job2', status: 'PENDING', nextPollAt: now });
      
      vi.restoreAllMocks();
    });
  });

  describe('API actions', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:url');
    });

    it('uploadStyleProfile should succeed', async () => {
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({
          ok: true,
          clone: () => ({ json: () => Promise.resolve({}) })
        });
      });

      const file = new File([''], 'test.jpg');
      await useJobStore.getState().uploadStyleProfile(file);
      
      const state = useJobStore.getState();
      expect(state.styleProfiles).toHaveLength(1);
      expect(state.styleProfiles[0].name).toBe('test.jpg');
      expect(state.styleProfiles[0].url).toBe('blob:url');
    });

    it('uploadStyleProfile should handle failure', async () => {
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false });
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().uploadStyleProfile(new File([''], 'test.jpg'));

      expect(useJobStore.getState().styleProfiles).toHaveLength(0);
      
      consoleSpy.mockRestore();
    });

    it('uploadTrainingPair should succeed', async () => {
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: true });
      });

      const brackets = [new File([''], 'b1.jpg')];
      const final = new File([''], 'final.jpg');
      await useJobStore.getState().uploadTrainingPair(brackets, final);
    });

    it('uploadTrainingPair should log error on failure', async () => {
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false });
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().uploadTrainingPair([], new File([''], 'final.jpg'));

      expect(consoleSpy).toHaveBeenCalledWith("Failed to upload training pair");
      consoleSpy.mockRestore();
    });

    it('overrideWithManualEdit should succeed', async () => {
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: true });
      });
      
      useJobStore.setState({
        jobs: {
          'job1': {
            id: 'job1',
            status: 'NEEDS_REVIEW',
            nextPollAt: 0,
            result: { id: 'job1', url: 'old', roomName: 'Living', status: 'NEEDS_REVIEW' }
          }
        }
      });

      await useJobStore.getState().overrideWithManualEdit('job1', new File([''], 'edit.jpg'));

      const state = useJobStore.getState();
      expect(state.jobs['job1'].status).toBe('COMPLETED');
      expect(state.jobs['job1'].result?.url).toBe('blob:url');
      expect(state.jobs['job1'].result?.status).toBe('APPROVED');
    });

    it('overrideWithManualEdit should log error if network fails', async () => {
      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().overrideWithManualEdit('job1', new File([''], 'edit.jpg'));

      expect(consoleSpy).toHaveBeenCalledWith("Failed to override with manual edit", expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('fetchQuota should succeed', async () => {
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({
          ok: true,
          clone: () => ({ json: () => Promise.resolve({}) }),
          json: () => Promise.resolve({ used: 5, limit: 10 })
        });
      });

      await useJobStore.getState().fetchQuota();

      expect(useJobStore.getState().quota).toEqual({ used: 5, limit: 10 });
    });

    it('rehydrateSession should handle errors', async () => {
      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().rehydrateSession('sess123');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('pollDueJobs should handle errors', async () => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'PENDING', nextPollAt: 0 }
        }
      });

      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().pollDueJobs();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('pollDueJobs should handle non-ok response', async () => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'PENDING', nextPollAt: 0 }
        }
      });

      mockFetch.mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({
          ok: false,
          headers: new Headers(), // return a real Headers object to prevent TypeError
          json: () => Promise.resolve({})
        });
      });
      
      await useJobStore.getState().pollDueJobs();
      // Should silently do nothing
      expect(useJobStore.getState().jobs['job1'].status).toBe('PENDING');
    });

    it('fetchQuota should handle error', async () => {
      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().fetchQuota();

      expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch quota", expect.any(Error));
      consoleSpy.mockRestore();
    });
    it('rehydrateSession should succeed', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      
      mockFetch.mockImplementationOnce((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({
          ok: true,
          clone: () => ({ json: () => Promise.resolve({}) }),
          json: () => Promise.resolve({
            jobs: [
              { id: 'job1', status: 'PENDING' },
              { 
                id: 'job2', 
                status: 'COMPLETED', 
                result: { url: 'url2', room: 'Kitchen' } 
              }
            ]
          })
        });
      });

      await useJobStore.getState().rehydrateSession('sess123');

      const state = useJobStore.getState();
      expect(state.activeSessionId).toBe('sess123');
      expect(state.jobs['job1'].status).toBe('PENDING');
      expect(state.jobs['job2'].status).toBe('COMPLETED');
      expect(state.jobs['job2'].result?.url).toBe('url2');
      expect(state.jobs['job2'].result?.roomName).toBe('Kitchen');
      
      vi.restoreAllMocks();
    });

    it('pollDueJobs should fetch due jobs and update state', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'PENDING', nextPollAt: now - 1000 },
          'job2': { id: 'job2', status: 'PROCESSING', nextPollAt: now - 500 },
          'job3': { id: 'job3', status: 'PENDING', nextPollAt: now + 5000 }, // Not due
        }
      });

      mockFetch.mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:7781')) return Promise.resolve({ ok: true });
        return Promise.resolve({
          ok: true,
          headers: { get: vi.fn().mockReturnValue('10') },
          clone: () => ({ json: () => Promise.resolve({}) }),
          json: () => Promise.resolve({
            jobs: [
              { id: 'job1', status: 'PROCESSING' },
              { 
                id: 'job2', 
                status: 'COMPLETED', 
                result: { url: 'new_url', room: 'Bedroom' } 
              }
            ]
          })
        });
      });

      await useJobStore.getState().pollDueJobs();

      const state = useJobStore.getState();
      
      expect(state.jobs['job1'].status).toBe('PROCESSING');
      expect(state.jobs['job1'].nextPollAt).toBe(now + 10000); // 10s Retry-After
      
      expect(state.jobs['job2'].status).toBe('COMPLETED');
      expect(state.jobs['job2'].result?.url).toBe('new_url');
      expect(state.jobs['job2'].result?.status).toBe('NEEDS_REVIEW');
      
      vi.restoreAllMocks();
    });
  });
});