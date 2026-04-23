import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SmartSaveSheet from './SmartSaveSheet';

describe('SmartSaveSheet Component', () => {
  let randomSpy: any;

  beforeEach(() => {
    vi.useFakeTimers();
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    vi.useRealTimers();
    randomSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<SmartSaveSheet isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders and simulates AI ready state', async () => {
    randomSpy.mockReturnValue(0.5);
    render(<SmartSaveSheet isOpen={true} itemTitle="Test.jpg" onClose={vi.fn()} />);
    
    expect(screen.getByText('Test.jpg')).toBeInTheDocument();
    
    // Fast forward for AI loading
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByText('Suggested Folders')).toBeInTheDocument();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Primary Bath')).toBeInTheDocument();
  });

  it('handles offline mode', () => {
    vi.stubGlobal('navigator', { onLine: false });

    render(<SmartSaveSheet isOpen={true} onClose={vi.fn()} />);
    
    expect(screen.getByText('Offline Mode')).toBeInTheDocument();
    expect(screen.getByText('Save to Default Folder')).toBeInTheDocument();
  });

  it('handles AI error mode', () => {
    randomSpy.mockReturnValue(0.95); // > 0.9 triggers error

    render(<SmartSaveSheet isOpen={true} onClose={vi.fn()} />);
    
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByText('Suggestions unavailable')).toBeInTheDocument();
    expect(screen.getByText('Save to Default Folder')).toBeInTheDocument();
  });

  it('handles saving a custom tag', async () => {
    randomSpy.mockReturnValue(0.5);
    const onCloseMock = vi.fn();
    render(<SmartSaveSheet isOpen={true} onClose={onCloseMock} />);
    
    act(() => {
      vi.advanceTimersByTime(1200); // Wait for AI
    });

    const input = screen.getByPlaceholderText('Or create a new folder...');
    act(() => {
      fireEvent.change(input, { target: { value: 'Custom Room' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    // Wait for save simulation
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.getByText('Saved to Custom Room')).toBeInTheDocument();

    // Auto-close timeout
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('handles saving an AI suggestion', async () => {
    randomSpy.mockReturnValue(0.5);
    const onCloseMock = vi.fn();
    render(<SmartSaveSheet isOpen={true} onClose={onCloseMock} />);
    
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    const btn = screen.getByText('Kitchen');
    act(() => {
      fireEvent.click(btn);
    });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.getByText('Saved to Kitchen')).toBeInTheDocument();
  });

  it('handles close button', () => {
    const onCloseMock = vi.fn();
    render(<SmartSaveSheet isOpen={true} onClose={onCloseMock} />);
    
    // Backdrop
    const backdrop = document.querySelector('.bg-black\\/40');
    fireEvent.click(backdrop!);
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    // X button
    const buttons = screen.getAllByRole('button');
    const xBtn = buttons[0]; // Assuming it's the first button (the close button)
    fireEvent.click(xBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(2);
  });

  it('handles custom tag submission with empty and valid strings', async () => {
    randomSpy.mockReturnValue(0.5);
    vi.useFakeTimers();
    const onCloseMock = vi.fn();
    render(<SmartSaveSheet isOpen={true} onClose={onCloseMock} />);
    
    await act(async () => {
      vi.advanceTimersByTime(1200); // Wait for ready state
    });

    const input = screen.getByPlaceholderText('Or create a new folder...');
    
    // Empty tag (should return early)
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    
    // Should still be in ready state
    expect(screen.getByText('Suggested Folders')).toBeInTheDocument();

    // Valid tag
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Custom Room' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    // Wait for the async save
    await act(async () => {
      vi.advanceTimersByTime(800); // Save time
    });

    expect(screen.getByText('Saved to Custom Room')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1500); // Auto close
    });

    expect(onCloseMock).toHaveBeenCalled();
  });
});