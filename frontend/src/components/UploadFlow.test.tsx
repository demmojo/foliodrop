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
    });
    
    (global.fetch as any).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ session_id: 'test-session', urls: [{ url: 'http://upload' }] }),
      ok: true
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
      expect(screen.getByText(/Only JPEG, PNG, HEIC, and TIFF formats are supported/)).toBeInTheDocument();
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
      fireEvent.change(sessionCodeInput, { target: { value: 'test-code' } });
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
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: 'job1', url: 'test.jpg', roomName: 'Room', status: 'READY' } }
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
    
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    
    await waitFor(() => {
      expect(navigator.share).toHaveBeenCalled();
    });
  });

  it('shows error if upload fails', async () => {
    await act(async () => {
      render(<UploadFlow />);
    });
    
    // 0. Enter Session Code
    const textInputs = document.querySelectorAll('input[type="text"]');
    const sessionCodeInput = textInputs[0] as HTMLInputElement;
    await act(async () => {
      fireEvent.change(sessionCodeInput, { target: { value: 'test-code' } });
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

    // Setup API mock to fail initialization
    (global.fetch as any).mockImplementation((url: string) => {
       if (url.includes('/api/v1/sessions/validate')) {
         return Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true }) });
       }
       if (url.includes('/api/v1/upload-urls')) {
         return Promise.reject(new Error('Network error'));
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
        'job1': { id: 'job1', status: 'NEEDS_REVIEW', nextPollAt: 0, result: { id: 'job1', url: 'blob:http', roomName: 'Room', status: 'NEEDS_REVIEW', isFlagged: true } }
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

  it('handles zip fallback when native share fails', async () => {
    mockSearchParams.set('session', 'sess');
    // We can simulate the state reaching REVIEW with jobs
    useJobStore.setState({
      activeSessionId: 'sess',
      jobs: {
        'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: 'job1', url: 'blob:http', roomName: 'Room', status: 'READY', isFlagged: false } }
      }
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['test'], { type: 'image/jpeg' }))
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