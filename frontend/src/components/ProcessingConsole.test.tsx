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
    render(<ProcessingConsole sessionId="sess1" expectedRooms={2} onComplete={vi.fn()} />);
    
    expect(screen.getByText('Processing Your Shoot')).toBeInTheDocument();
    expect(screen.getByText('Aligning structural details...')).toBeInTheDocument();
  });

  it('updates progress when jobs complete and triggers onComplete', () => {
    const onCompleteMock = vi.fn();
    render(<ProcessingConsole sessionId="sess1" expectedRooms={1} onComplete={onCompleteMock} />);

    // Add a completed job
    act(() => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: '1', url: '1.jpg', roomName: 'Room', status: 'READY' } }
        }
      });
    });

    expect(screen.getByText('Finalizing exports...')).toBeInTheDocument();

    // Fast-forward timeout
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onCompleteMock).toHaveBeenCalledTimes(1);
    expect(onCompleteMock).toHaveBeenCalledWith([expect.objectContaining({ id: '1' })]);
  });

  it('simulates progress creep', () => {
    render(<ProcessingConsole sessionId="sess1" expectedRooms={2} onComplete={vi.fn()} />);
    
    // Initial display progress is 5%
    expect(screen.getByText('Aligning structural details...')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60000); // Wait 60 seconds
    });

    // Should creep past 20%
    expect(screen.getByText('Fusing dynamic range...')).toBeInTheDocument();

    // Now let's simulate some actual jobs finishing to bump realProgress
    act(() => {
      useJobStore.setState({
        jobs: {
          'job1': { id: 'job1', status: 'COMPLETED', nextPollAt: 0, result: { id: '1', url: '1.jpg', roomName: 'Room1', status: 'READY' } }
        }
      });
    });

    // realProgress is now 50% (1 out of 2 expectedRooms)
    // maxCreep will be 65
    act(() => {
      vi.advanceTimersByTime(30000); // Wait 30 more seconds
    });

    // Should creep past 50%
    expect(screen.getByText('Generative tone mapping...')).toBeInTheDocument();
  });
});