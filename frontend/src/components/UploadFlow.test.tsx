import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import UploadFlow from './UploadFlow';
import * as useImageProcessorModule from '../hooks/useImageProcessor';
import { useJobStore } from '../store/useJobStore';

vi.mock('file-saver', () => ({
  saveAs: vi.fn()
}));

vi.mock('jszip', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      folder: vi.fn().mockReturnValue({
        file: vi.fn()
      }),
      generateAsync: vi.fn().mockResolvedValue(new Blob(['zip']))
    }))
  };
});

// Mock fetch for API calls
global.fetch = vi.fn();

let mockSearchParams = new Map();

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key),
  }),
}));

// Mock exif utils
vi.mock('../utils/exif', () => ({
  parsePhotoMetadata: vi.fn().mockResolvedValue([{ file: new File([''], 'test.jpg'), captureTime: 123, previewUrl: 'blob:url' }]),
  groupPhotosIntoScenes: vi.fn().mockReturnValue([{
    id: 'group1',
    photos: [{ file: new File([''], 'test.jpg'), captureTime: 123, previewUrl: 'blob:url', exposureCompensation: 0, exposureTime: 0.01 }],
    previewUrl: 'blob:url'
  }])
}));

vi.mock('./ProcessingConsole', () => {
  return {
    default: ({ onComplete }: any) => (
      <div data-testid="mock-processing-console">
        <button data-testid="complete-processing" onClick={() => onComplete()}>Complete</button>
      </div>
    )
  };
});

vi.mock('./ReviewGrid', () => {
  return {
    default: ({ onConfirm, onKeepItem, onDiscardItem }: any) => (
      <div data-testid="mock-review-grid">
        <button data-testid="review-confirm" onClick={onConfirm}>Confirm Export</button>
        <button data-testid="review-keep" onClick={() => onKeepItem('job1')}>Keep</button>
        <button data-testid="review-discard" onClick={() => onDiscardItem('job1')}>Discard</button>
      </div>
    )
  };
});

describe('UploadFlow Component', () => {
  beforeEach(() => {
    mockSearchParams.clear();
    vi.clearAllMocks();
    useJobStore.setState({
      jobs: {},
      activeSessionId: null,
      quota: { used: 0, limit: 100 },
      styleProfiles: [],
      toastMessage: null,
      flowState: 'IDLE',
      uploadedFiles: [],
      photoGroups: []
    });
    
    // Provide a robust default fetch mock to prevent unhandled promise rejections
    // and missing json() properties from causing cascaded failures in rehydrateSession.
    (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/api/v1/quota')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
        }
        if (url.includes('/api/v1/jobs/active') || url.includes('/api/v1/sessions/')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it('renders initial dropzone state', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    expect(screen.getByText('Import bracketed sets')).toBeInTheDocument();
  });

  it('handles file selection and transitions to confirmation', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'hello.jpg', { type: 'image/jpeg' });
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    
    // Should transition to confirmation
    await waitFor(() => {
      expect(screen.getByText('Ready to Process')).toBeInTheDocument();
    });
    
    // Shows the parsed scene
    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(screen.getByText('1 brackets')).toBeInTheDocument();
  });

  it('rejects unsupported files and shows toast', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    
    await waitFor(() => {
      expect(screen.getByText(/RAW processing is currently not supported/)).toBeInTheDocument();
    });
    
    // Stays in IDLE
    expect(screen.getByText('Import bracketed sets')).toBeInTheDocument();
  });

  it('handles full flow: idle -> parsing -> confirmation -> uploading -> processing -> review', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    
    // 0. Enter Session Code
    const textInputs = document.querySelectorAll('input[type="text"]');
    const sessionCodeInput = textInputs[0] as HTMLInputElement;
    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'unique-flow-code' } });
    });

    // 1. Select files
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    
    // 2. Wait for confirmation
    await waitFor(() => {
      expect(screen.getByText('Ready to Process')).toBeInTheDocument();
    });
    
    // Setup API mocks for upload and finalize
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/v1/quota')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
      }
      if (url.includes('/api/v1/sessions/validate')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true }) });
      }
      if (url.includes('/api/v1/upload-urls')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ session_id: 'sess', urls: [{ url: 'http://upload' }] }) });
      }
      if (url.includes('http://upload')) {
        return Promise.resolve({ ok: true });
      }
      if (url.includes('/api/v1/finalize-job')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_ids: ['job1'] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob()) });
    });

    // 3. Click "Generate"
    const generateBtn = screen.getByText(/Generate 1 Final Images/i);
    await act(async () => {
      fireEvent.click(generateBtn);
      // Wait for promises
      await new Promise(r => setTimeout(r, 0));
    });

    // Wait for PROCESSING state
    await waitFor(() => {
      expect(screen.getByTestId('mock-processing-console')).toBeInTheDocument();
    });

    // 4. Simulate processing completion
    await act(async () => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: 'job1', url: 'test.jpg', sceneName: 'Room', status: 'READY' } }
        }
      });
    });

    // Should transition to REVIEW
    await waitFor(() => {
      expect(screen.getByTestId('mock-review-grid')).toBeInTheDocument();
    });

    // 5. Review grid confirm
    const confirmBtn = screen.getByTestId('review-confirm');
    
    // Mock navigator.canShare and navigator.share
    Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true });
    
    // Also mock the window confirm
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    
    await waitFor(() => {
      expect(navigator.share).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
  });

  it('shows error if upload fails', async () => {
    // Reset state
    useJobStore.setState({ activeSessionId: null, jobs: {}, quota: null, flowState: 'IDLE' });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    // 0. Enter Session Code
    const textInputs = document.querySelectorAll('input[type="text"]');
    const sessionCodeInput = textInputs[0] as HTMLInputElement;
    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'unique-flow-code-fail' } });
    });

    // Reset fetch mock for the upload failure part
    (global.fetch as any).mockImplementation((url: string) => {
       if (url.includes('/api/v1/upload-urls')) {
         return Promise.reject(new Error('Network error'));
       }
       if (url.includes('/api/v1/jobs/active')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: [] }) });
       }
       return Promise.resolve({ ok: true, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob()) });
    });

    // 1. Select files
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    
    // 2. Wait for confirmation
    await waitFor(() => {
      expect(screen.getByText('Ready to Process')).toBeInTheDocument();
    });

    // 3. Click "Generate"
    const generateBtn = screen.getByText(/Generate 1 Final Images/i);
    await act(async () => {
      fireEvent.click(generateBtn);
      // Wait for promises
      await new Promise(r => setTimeout(r, 0));
    });

    // Should show error and return to IDLE
    await waitFor(() => {
      expect(screen.getByText('Pipeline initialization failed. Please try again.')).toBeInTheDocument();
    });
  });

  it('handles keep and discard items', async () => {
    mockSearchParams.set('session', 'sess');
    useJobStore.setState({
      activeSessionId: 'sess',
      jobs: {
        'job1': { id: 'job1', status: 'NEEDS_REVIEW', nextPollAt: 0, result: { id: 'job1', url: 'blob:http', sceneName: 'Room', status: 'NEEDS_REVIEW', isFlagged: true } }
      }
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('mock-review-grid')).toBeInTheDocument();
    });

    // Keep
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-keep'));
    });
    
    expect(useJobStore.getState().jobs['job1'].result?.isFlagged).toBe(false);

    // Discard
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-discard'));
    });

    expect(useJobStore.getState().jobs['job1']).toBeUndefined();
  });

  it('handles branch coverage for sorting photos with missing exposure data', async () => {
    // Create photos where one has missing exposure data to hit the fallback sorting paths
    const photoGroupWithMissingData = {
      id: 'group1',
      photos: [
        { file: new File([], '1.jpg'), previewUrl: 'blob:http', timestamp: 1000 }, // No exposure data
        { file: new File([], '2.jpg'), previewUrl: 'blob:http', timestamp: 2000, exposureCompensation: 0, exposureTime: 0.1 },
        { file: new File([], '3.jpg'), previewUrl: 'blob:http', timestamp: 3000, exposureCompensation: 1, exposureTime: 0.5 },
        { file: new File([], '4.jpg'), previewUrl: 'blob:http', timestamp: 4000, exposureCompensation: 0 } // missing exposureTime, same compensation
      ],
      previewUrl: 'blob:http'
    };

    // To hit the lines (631-638) we need to be in CONFIRMATION state
    // We can use the mock EXIF logic to generate this
    const exifProcessor = await import('../utils/exif');
    vi.mocked(exifProcessor.groupPhotosIntoScenes).mockReturnValueOnce([photoGroupWithMissingData as any]);

    render(<UploadFlow />);

    const dropzone = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'dummy.jpg', { type: 'image/jpeg' });
    
    await act(async () => {
      fireEvent.change(dropzone, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText('Ready to Process')).toBeInTheDocument();
    });

    // Verify the EV rendering which is also partially uncovered
    expect(screen.getAllByText('0 EV').length).toBeGreaterThan(0);
    expect(screen.getByText('+1 EV')).toBeInTheDocument();
  });

  it('handles complete export failure (e.g. all fetches fail)', async () => {
    mockSearchParams.set('session', 'sess');
    useJobStore.setState({
      activeSessionId: 'sess',
      jobs: {
        'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: 'job1', url: 'blob:http', sceneName: 'Room', status: 'READY', isFlagged: false } }
      }
    });

    // Mock fetch to simulate image download failures
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // IMPORTANT: Make sure this mock fetch provides json() and ok:true for the quota/rehydrate calls that happen on mount
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/v1/quota')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
      }
      if (url.includes('/api/v1/sessions/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: {} }) });
      }
      return Promise.rejectedValue(new Error('Download failed'));
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('mock-review-grid')).toBeInTheDocument();
    });

    const confirmBtn = screen.getByTestId('review-confirm');
    await act(async () => {
      fireEvent.click(confirmBtn);
      await new Promise(r => setTimeout(r, 0));
    });

    // Check for error toast
    await waitFor(() => {
      expect(screen.getByText('Failed to export images.')).toBeInTheDocument();
    });
    
    consoleSpy.mockRestore();
  });

  it('shows error for short session code on blur', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    
    const sessionCodeInput = screen.getByTestId('session-code-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'short' } });
      fireEvent.blur(sessionCodeInput);
    });

    await waitFor(() => {
      expect(screen.getByText("Must be at least 6 characters.")).toBeInTheDocument();
    });
  });
  it('shows recent sessions and can resume from them', async () => {
    // Set up local storage with some sessions
    const pastSessions = [
      { id: 'sess-old-1', date: Date.now() - 100000, count: 5 },
      { id: 'sess-old-2', date: Date.now() - 200000, count: 10 },
      { id: 'sess-old-3', date: Date.now() - 300000, count: 15 } // To test 'show all'
    ];
    localStorage.setItem('hdr_recent_sessions', JSON.stringify(pastSessions));

    // IMPORTANT: Make sure this mock fetch provides json() and ok:true for the quota/rehydrate calls that happen on mount
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/v1/quota')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
      }
      if (url.includes('/api/v1/sessions/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<UploadFlow />);

    // The first 2 sessions should be visible
    expect(screen.getByText('sess-old-1')).toBeInTheDocument();
    
    // Test expanding the list
    const showMoreBtn = screen.getByText(/Show \d+ more rooms/i);
    await act(async () => {
      fireEvent.click(showMoreBtn);
    });

    // Should now show the 3rd session
    expect(screen.getByText('sess-old-3')).toBeInTheDocument();

    // Click to resume
    const resumeBtn = screen.getByTestId('resume-session-sess-old-3');
    await act(async () => {
      fireEvent.click(resumeBtn);
    });

    // Should trigger rehydrate (via mock in setup, fetch is called)
    expect(global.fetch).toHaveBeenCalled();
  });

  it('shows welcome back prompt if hdr_session_code exists in localStorage', async () => {
    localStorage.setItem('hdr_session_code', 'welcome-back-code');
    
    (global.fetch as any).mockImplementation((url: string) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<UploadFlow />);
    });

    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByText('welcome-back-code')).toBeInTheDocument();

    const continueBtn = screen.getByText(/Continue in welcome-back-code/i);
    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Prompt should disappear and rehydrate should be called
    expect(screen.queryByText('Welcome Back')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalled();
  });

  it('shows welcome back prompt and handles starting a new room', async () => {
    localStorage.setItem('hdr_session_code', 'welcome-back-code');
    
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url: string) => {
      if (url.includes('/api/v1/sessions/generate')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'new-session-123' }) } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    await act(async () => {
      render(<UploadFlow />);
    });

    expect(screen.getByText('Welcome Back')).toBeInTheDocument();

    const startNewBtn = screen.getByText('Start a New Session');
    await act(async () => {
      fireEvent.click(startNewBtn);
    });

    // Prompt should disappear and generate should be called
    expect(screen.queryByText('Welcome Back')).not.toBeInTheDocument();
    
    await new Promise(r => setTimeout(r, 0));
    
    const generateCall = fetchSpy.mock.calls.find(call => String(call[0]).includes('/api/v1/sessions/generate'));
    expect(generateCall).toBeTruthy();
    
    fetchSpy.mockRestore();
  });

  it('handles Complete action in Processing Console to Review', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    
    // Setup API mocks
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/v1/quota')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
      }
      if (url.includes('/api/v1/sessions/validate')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true }) });
      }
      if (url.includes('/api/v1/upload-urls')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ session_id: 'sess', urls: [{ url: 'http://upload' }] }) });
      }
      if (url.includes('http://upload')) {
        return Promise.resolve({ ok: true });
      }
      if (url.includes('/api/v1/finalize-job')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_ids: ['job1'] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob()) });
    });

    // We can simulate state transition directly or through the flow
    // Entering flow
    const textInputs = document.querySelectorAll('input[type="text"]');
    const sessionCodeInput = textInputs[0] as HTMLInputElement;
    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'test-code' } });
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText('Ready to Process')).toBeInTheDocument();
    });

    const generateBtn = screen.getByText(/Generate 1 Final Images/i);
    await act(async () => {
      fireEvent.click(generateBtn);
      await new Promise(r => setTimeout(r, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-processing-console')).toBeInTheDocument();
    });

    // Mock completion
    await act(async () => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: 'job1', url: 'test.jpg', sceneName: 'Room', status: 'READY' } }
        }
      });
      // Click the mocked button from the ProcessingConsole mock
      fireEvent.click(screen.getByTestId('complete-processing'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-review-grid')).toBeInTheDocument();
    });
  });

  it('handles resume session via Enter key', async () => {
    // Reset Zustand state first
    useJobStore.setState({
      activeSessionId: null,
      jobs: {},
      quota: null,
      flowState: 'IDLE'
    });
    
    // Setup API mock
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url: string) => {
      if (url.includes('/api/v1/jobs/active')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: [] }) } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    const sessionCodeInput = screen.getByTestId('session-code-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'session-enter' } });
    });

    await act(async () => {
      fireEvent.keyDown(sessionCodeInput, { key: 'Enter', code: 'Enter' });
    });

    // Wait a tick
    await new Promise(r => setTimeout(r, 0));
    
    // Check if fetch was called with the specific active jobs endpoint for session-enter
    const activeJobsCall = fetchSpy.mock.calls.find(call => String(call[0]).includes('/api/v1/jobs/active?session_id=session-enter'));
    expect(activeJobsCall).toBeTruthy();
    
    fetchSpy.mockRestore();
  });

  it('handles resume session via Resume button', async () => {
    useJobStore.setState({ activeSessionId: null, flowState: 'IDLE' });
    
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url: string) => {
      if (url.includes('/api/v1/jobs/active')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: [] }) } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    const sessionCodeInput = screen.getByTestId('session-code-input') as HTMLInputElement;
    const resumeBtn = screen.getByTestId('resume-button');

    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'session-btn' } });
    });

    await act(async () => {
      fireEvent.click(resumeBtn);
    });

    await new Promise(r => setTimeout(r, 0));
    
    const activeJobsCall = fetchSpy.mock.calls.find(call => String(call[0]).includes('/api/v1/jobs/active?session_id=session-btn'));
    expect(activeJobsCall).toBeTruthy();
    
    fetchSpy.mockRestore();
  });

  it('handles starting a new room', async () => {
    useJobStore.setState({ activeSessionId: null, flowState: 'IDLE' });
    
    // Reset any pending session code state manually since we are outside the component
    localStorage.removeItem('hdr_session_code');

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url: string) => {
      if (url.includes('/api/v1/sessions/generate')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'new-session-123' }) } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    // Clear initial mount fetches
    fetchSpy.mockClear();

    const startNewBtn = screen.getByText('Start a new room');

    await act(async () => {
      fireEvent.click(startNewBtn);
    });

    // Give state effect a moment to run
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    
    // Check if fetch was called with generate
    const generateCall = fetchSpy.mock.calls.filter(call => String(call[0]).includes('/api/v1/sessions/generate'));
    expect(generateCall.length).toBeGreaterThan(0);
    
    fetchSpy.mockRestore();
  });

  it('handles drag and drop overlay', async () => {
    // Reset state to ensure we are in IDLE
    useJobStore.setState({
      flowState: 'IDLE',
      uploadedFiles: [],
      photoGroups: [],
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    // Trigger dragover on window to show the overlay
    await act(async () => {
      const event = new Event('dragover', { bubbles: true });
      window.dispatchEvent(event);
    });

    let dragOverlay = screen.queryByTestId('drag-overlay');
    expect(dragOverlay).toBeInTheDocument();

    // Trigger dragleave to hide it
    await act(async () => {
      const event = new MouseEvent('dragleave', { bubbles: true, clientX: 0, clientY: 0 });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('drag-overlay')).not.toBeInTheDocument();
    });

    // Trigger dragover again to show it
    await act(async () => {
      const event = new Event('dragover', { bubbles: true });
      window.dispatchEvent(event);
    });

    dragOverlay = screen.getByTestId('drag-overlay');
    
    // Simulate drop on the overlay itself
    await act(async () => {
      fireEvent.drop(dragOverlay, {
        dataTransfer: { files: [] }
      });
    });
    
    await waitFor(() => {
        expect(screen.queryByTestId('drag-overlay')).not.toBeInTheDocument();
    });
  });

  it('handles toast messages', async () => {
    // Render in IDLE
    (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/api/v1/quota')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
        }
        if (url.includes('/api/v1/jobs/active') || url.includes('/api/v1/sessions/')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: [] }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<UploadFlow />);
    });
    
    // Force a toast by rejecting a file (which sets the state internally)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // The component should now have set the toast message state and rendered it
    const toast = await screen.findByTestId('toast-message');
    expect(toast).toBeInTheDocument();
    expect(toast.textContent).toContain('RAW processing is currently not supported');
  });


  it('handles zip fallback when native share fails', async () => {
    // Reset Zustand state first
    useJobStore.setState({
      activeSessionId: null,
      jobs: {},
      quota: null,
      flowState: 'IDLE'
    });
    
    mockSearchParams.set('session', 'sess');
    // We can simulate the state reaching REVIEW with jobs
    useJobStore.setState({
      activeSessionId: 'sess',
      flowState: 'REVIEW',
      jobs: {
        'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: 'job1', url: 'blob:http', sceneName: 'Room', status: 'READY', isFlagged: false } }
      }
    });

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/v1/quota')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ used: 0, limit: 100 }) });
      }
      if (url.includes('/api/v1/sessions/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: {} }) });
      }
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: 'image/jpeg' }))
      });
    });

    Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new Error('Failed share')), configurable: true });
    
    await act(async () => {
      render(<UploadFlow />);
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('mock-review-grid')).toBeInTheDocument();
    });

    const confirmBtn = screen.getByTestId('review-confirm');
    await act(async () => {
      fireEvent.click(confirmBtn);
      await new Promise(r => setTimeout(r, 0));
    });
    
    // Check if zip fallback toast is shown (or if saveAs is called)
    await waitFor(() => {
      expect(screen.getByText('Download complete!')).toBeInTheDocument();
    });
  });
});