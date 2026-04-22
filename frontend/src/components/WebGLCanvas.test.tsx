import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import WebGLCanvas from './WebGLCanvas';
import { useImageStore } from '../store/useImageStore';

describe('WebGLCanvas', () => {
  it('renders and initializes webgl', () => {
    const clearColorMock = vi.fn();
    const clearMock = vi.fn();
    const loseContextMock = vi.fn();

    const getContextMock = vi.fn().mockReturnValue({
      clearColor: clearColorMock,
      clear: clearMock,
      COLOR_BUFFER_BIT: 1,
      getExtension: vi.fn().mockReturnValue({ loseContext: loseContextMock })
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContextMock as any);

    const { unmount } = render(<WebGLCanvas />);
    
    expect(getContextMock).toHaveBeenCalled();
    expect(clearColorMock).toHaveBeenCalledWith(0.1, 0.1, 0.1, 1.0);
    expect(clearMock).toHaveBeenCalled();

    unmount();
    expect(loseContextMock).toHaveBeenCalled();
  });
});