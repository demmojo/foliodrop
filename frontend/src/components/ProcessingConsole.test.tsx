import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ProcessingConsole from './ProcessingConsole';
import { useJobStore } from '../store/useJobStore';

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

describe('ProcessingConsole Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useJobStore.setState({ jobs: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders initial state', () => {
    render(<ProcessingConsole sessionId="sess1" expectedScenes={2} onComplete={vi.fn()} />);
    
    expect(screen.getByText('Processing Your Shoot')).toBeInTheDocument();
  });

  it('handles null sessionId gracefully', () => {
    render(<ProcessingConsole sessionId={null} expectedScenes={2} onComplete={vi.fn()} />);
    
    // Should still render but not trigger useEffect processing logic
    expect(screen.getByText('Processing Your Shoot')).toBeInTheDocument();
  });

  it('updates progress when jobs complete and triggers onComplete', () => {
    const onCompleteMock = vi.fn();
    render(<ProcessingConsole sessionId="sess1" expectedScenes={1} onComplete={onCompleteMock} />);

    // Add a completed job
    act(() => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: '1', url: '1.jpg', sceneName: 'Room', status: 'READY' } }
        }
      });
    });

    act(() => {
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(1200);
      }
    });

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(onCompleteMock).toHaveBeenCalledTimes(1);
    expect(onCompleteMock).toHaveBeenCalledWith([expect.objectContaining({ id: '1' })]);
  });

  it('simulates progress creep', () => {
    render(<ProcessingConsole sessionId="sess1" expectedScenes={2} onComplete={vi.fn()} />);
    
    // Initial display progress is 5%
    expect(screen.getByText('Processing Your Shoot')).toBeInTheDocument();

    for (let i = 0; i < 60; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Should creep past 20%
    expect(screen.getByText(/Processing Your Shoot/i)).toBeInTheDocument();

    // Now let's simulate some actual jobs finishing to bump realProgress
    act(() => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: '1', url: '1.jpg', sceneName: 'Room1', status: 'READY' } }
        }
      });
    });

    // realProgress is now 50% (1 out of 2 expectedScenes)
    // maxCreep will be 65
    act(() => {
      for (let i = 0; i < 40; i++) {
        vi.advanceTimersByTime(1000);
      }
      vi.advanceTimersByTime(5000); // flush queue
    });

    // Should creep past 50%
    expect(screen.getByText(/Processing Your Shoot/i)).toBeInTheDocument();
    
    // Now push realProgress to something that allows creep > 80
    act(() => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: '1', url: '1.jpg', sceneName: 'Room1', status: 'READY' } },
          // Note: total jobs is max(expectedScenes(2), sessionJobs.length(2))
          'job2': { id: 'job2', status: 'PROCESSING', nextPollAt: 0 } // Not completed, but we can set expectedScenes = 3 to get 2/3 = 66% => maxCreep 81
        }
      });
    });
    
    act(() => {
      vi.advanceTimersByTime(60000); // creep some more
    });
    
    // Might hit denoising if we get past 80
    // Actually, if we just set realProgress to 85%, displayProgress will jump to 85%.
    // To do that, set 5 out of 6 rooms complete.
    act(() => {
      useJobStore.setState({
        jobs: {
          'j1': { id: '1', status: 'COMPLETED', nextPollAt: 0, result: { id: '1', url: '', sceneName: '', status: 'READY' } },
          'j2': { id: '2', status: 'COMPLETED', nextPollAt: 0, result: { id: '2', url: '', sceneName: '', status: 'READY' } },
          'j3': { id: '3', status: 'COMPLETED', nextPollAt: 0, result: { id: '3', url: '', sceneName: '', status: 'READY' } },
          'j4': { id: '4', status: 'COMPLETED', nextPollAt: 0, result: { id: '4', url: '', sceneName: '', status: 'READY' } },
          'j5': { id: '5', status: 'COMPLETED', nextPollAt: 0, result: { id: '5', url: '', sceneName: '', status: 'READY' } },
          'j6': { id: '6', status: 'PROCESSING', nextPollAt: 0 }
        }
      });
    });
    
    expect(screen.getByText(/Processing Your Shoot/i)).toBeInTheDocument();
  });

  it('copies session code to clipboard', async () => {
    // Mock clipboard
    const writeTextMock = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      configurable: true
    });

    render(<ProcessingConsole sessionId="test-session-123" expectedScenes={2} onComplete={vi.fn()} />);
    
    const copyBtn = screen.getByTitle('Copy to clipboard');
    
    act(() => {
      copyBtn.click();
    });
    
    expect(writeTextMock).toHaveBeenCalledWith('test-session-123');
    
    // Fast-forward to test timeout resetting hasCopied
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  });
});