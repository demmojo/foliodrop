import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useJobStore } from './useJobStore';

const { authState } = vi.hoisted(() => ({
  authState: { currentUser: null as null | { getIdToken: () => Promise<string> } },
}));

vi.mock('@/lib/firebase', () => ({
  auth: authState,
}));

// Central fetch mock (API + optional dev ingest URLs)
const mockFetch = vi.fn().mockImplementation((url) => {
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
    authState.currentUser = null;
    localStorage.clear();
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
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/api/v1/style/profiles')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              profiles: [
                { id: '1', blob_path: '123_test.jpg', url: 'blob:url', created_at: 1000 }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          clone: () => ({ json: () => Promise.resolve({}) })
        });
      });

      const file = new File([''], 'test.jpg');
      await useJobStore.getState().uploadStyleProfile(file);
      
      const state = useJobStore.getState();
      expect(state.styleProfiles).toHaveLength(1);
      expect(state.styleProfiles[0].name).toBe('123_test.jpg');
      expect(state.styleProfiles[0].url).toBe('blob:url');
    });

    it('uploadStyleProfile should handle failure', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false }));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().uploadStyleProfile(new File([''], 'test.jpg'));

      expect(useJobStore.getState().styleProfiles).toHaveLength(0);
      
      consoleSpy.mockRestore();
    });

    it('uploadTrainingPair should succeed', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true }));

      const brackets = [new File([''], 'b1.jpg')];
      const final = new File([''], 'final.jpg');
      await useJobStore.getState().uploadTrainingPair(brackets, final);
    });

    it('uploadTrainingPair should log error on failure', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false }));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().uploadTrainingPair([], new File([''], 'final.jpg'));

      expect(consoleSpy).toHaveBeenCalledWith("Failed to upload training pair");
      consoleSpy.mockRestore();
    });

    it('overrideWithManualEdit should succeed', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true }));
      
      useJobStore.setState({
        jobs: {
          'job1': {
            id: 'job1',
            status: 'NEEDS_REVIEW',
            nextPollAt: 0,
            result: { id: 'job1', url: 'old', sceneName: 'Living', status: 'NEEDS_REVIEW' }
          }
        }
      });

      await useJobStore.getState().overrideWithManualEdit('job1', new File([''], 'edit.jpg'));

      const state = useJobStore.getState();
      expect(state.jobs['job1'].status).toBe('COMPLETED');
      expect(state.jobs['job1'].result?.url).toBe('blob:url');
      expect(state.jobs['job1'].result?.status).toBe('APPROVED');
    });

    it('overrideWithManualEdit should log if override HTTP returns not ok', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false }));
      useJobStore.setState({
        jobs: {
          'job1': {
            id: 'job1',
            status: 'NEEDS_REVIEW',
            nextPollAt: 0,
            result: { id: 'job1', url: 'old', sceneName: 'Living', status: 'NEEDS_REVIEW' }
          }
        }
      });
      await useJobStore.getState().overrideWithManualEdit('job1', new File([''], 'edit.jpg'));
      expect(consoleSpy).toHaveBeenCalledWith('Failed to override with manual edit');
      consoleSpy.mockRestore();
    });

    it('overrideWithManualEdit should log error if network fails', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().overrideWithManualEdit('job1', new File([''], 'edit.jpg'));

      expect(consoleSpy).toHaveBeenCalledWith("Failed to override with manual edit", expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('fetchQuota should succeed', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce(() => {
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
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().rehydrateSession('sess123');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('pollDueJobs should handle errors', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
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
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'PENDING', nextPollAt: 0 }
        }
      });

      mockFetch.mockImplementation(() => {
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
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce((url) => {
        return Promise.reject(new Error("Network Error"));
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useJobStore.getState().fetchQuota();

      expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch quota", expect.any(Error));
      consoleSpy.mockRestore();
    });
    it('rehydrateSession should succeed', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      
      mockFetch.mockImplementationOnce(() => {
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
      expect(state.jobs['job2'].result?.sceneName).toBe('Kitchen');
      
      vi.restoreAllMocks();
    });

    it('pollDueJobs should normalize FLAGGED jobs into ProcessedHDR shape', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      useJobStore.setState({
        jobs: {
          'job_flag': { id: 'job_flag', status: 'PROCESSING', nextPollAt: now - 100 }
        }
      });

      mockFetch.mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          headers: { get: vi.fn() },
          clone: () => ({ json: () => Promise.resolve({}) }),
          json: () => Promise.resolve({
            jobs: [
              {
                id: 'job_flag',
                status: 'FLAGGED',
                result: {
                  url: 'flagged-url',
                  thumb_url: 'flagged-thumb',
                  original_url: 'flagged-orig',
                  room: 'Bathroom',
                  isFlagged: true,
                  vlmReport: { reason: 'soft fallback' }
                }
              }
            ]
          })
        });
      });

      await useJobStore.getState().pollDueJobs();

      const job = useJobStore.getState().jobs['job_flag'];
      expect(job.status).toBe('FLAGGED');
      expect(job.result?.sceneName).toBe('Bathroom');
      expect(job.result?.url).toBe('flagged-url');
      expect(job.result?.thumbUrl).toBe('flagged-thumb');
      expect(job.result?.originalUrl).toBe('flagged-orig');
      expect(job.result?.isFlagged).toBe(true);

      vi.restoreAllMocks();
    });

    it('pollDueJobs should fetch due jobs and update state', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'PENDING', nextPollAt: now - 1000 },
          'job2': { id: 'job2', status: 'PROCESSING', nextPollAt: now - 500 },
          'job3': { id: 'job3', status: 'PENDING', nextPollAt: now + 5000 }, // Not due
        }
      });

      mockFetch.mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          headers: { get: vi.fn().mockReturnValue('10') },
          clone: () => ({ json: () => Promise.resolve({}) }),
          json: () => Promise.resolve({
            jobs: [
              { id: 'job1', status: 'PROCESSING', retryAfterSeconds: 3 },
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
      expect(state.jobs['job1'].nextPollAt).toBe(now + 3000); // per-job retryAfterSeconds
      
      expect(state.jobs['job2'].status).toBe('COMPLETED');
      expect(state.jobs['job2'].result?.url).toBe('new_url');
      expect(state.jobs['job2'].result?.status).toBe('NEEDS_REVIEW');
      
      vi.restoreAllMocks();
    });

    it('fetchStyleProfiles should no-op on non-ok response', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      );
      await useJobStore.getState().fetchStyleProfiles();
      expect(useJobStore.getState().styleProfiles).toEqual([]);
    });

    it('fetchStyleProfiles should catch network errors', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('net')));
      await useJobStore.getState().fetchStyleProfiles();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('deleteStyleProfile should remove profile on success', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      useJobStore.setState({
        styleProfiles: [{ id: 'p1', name: 'a', createdAt: 1 }],
      });
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true }));
      await useJobStore.getState().deleteStyleProfile('p1');
      expect(useJobStore.getState().styleProfiles).toEqual([]);
    });

    it('deleteStyleProfile should no-op on failure', async () => {
      authState.currentUser = { getIdToken: () => Promise.resolve('tok') };
      useJobStore.setState({
        styleProfiles: [{ id: 'p1', name: 'a', createdAt: 1 }],
      });
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false }));
      await useJobStore.getState().deleteStyleProfile('p1');
      expect(useJobStore.getState().styleProfiles).toHaveLength(1);
    });

    it('uses local-only style profiles when unauthenticated', async () => {
      authState.currentUser = null;
      const file = new File(['hello'], 'local-style.jpg', { type: 'image/jpeg' });

      await useJobStore.getState().uploadStyleProfile(file);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useJobStore.getState().styleProfiles[0].isLocal).toBe(true);
      expect(useJobStore.getState().styleProfiles[0].name).toBe('local-style.jpg');

      // fetch loads from local storage, still no network
      useJobStore.setState({ styleProfiles: [] });
      await useJobStore.getState().fetchStyleProfiles();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useJobStore.getState().styleProfiles).toHaveLength(1);

      const id = useJobStore.getState().styleProfiles[0].id;
      await useJobStore.getState().deleteStyleProfile(id);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(useJobStore.getState().styleProfiles).toHaveLength(0);
    });

    it('scopes unauthenticated session rehydration with anon agency header', async () => {
      authState.currentUser = null;
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ jobs: [] }),
        })
      );

      await useJobStore.getState().rehydrateSession('anon-session');

      const call = mockFetch.mock.calls[0];
      expect(String(call[0])).toContain('/api/v1/jobs/active?session_id=anon-session');
      expect(call[1]?.headers?.['x-agency-id']).toMatch(/^anon_/);
      expect(call[1]?.headers?.Authorization).toBeUndefined();
    });

    it('scopes unauthenticated training uploads with anon agency header', async () => {
      authState.currentUser = null;
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true }));

      await useJobStore.getState().uploadTrainingPair(
        [new File([''], 'b1.jpg')],
        new File([''], 'final.jpg')
      );

      const call = mockFetch.mock.calls[0];
      expect(String(call[0])).toContain('/api/v1/training/upload');
      expect(call[1]?.headers?.['x-agency-id']).toMatch(/^anon_/);
      expect(call[1]?.headers?.Authorization).toBeUndefined();
    });
  });
});