import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useImageProcessor } from './useImageProcessor';
import { renderHook, act } from '@testing-library/react';

describe('useImageProcessor', () => {
  let revokedUrls: string[] = [];

  beforeEach(() => {
    revokedUrls = [];
    global.URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
  });

  it('sets and gets processed photos', () => {
    const { result } = renderHook(() => useImageProcessor());

    act(() => {
      result.current.setProcessedPhotos([{
        id: '1',
        url: 'https://example.com/1.jpg',
        listingGroupId: 'group-1',
        captureTime: new Date().toISOString(),
        roomName: 'Test Room'
      }]);
    });

    expect(result.current.processedPhotos.length).toBe(1);
    expect(result.current.processedPhotos[0].roomName).toBe('Test Room');
  });

  it('cleans up blob urls on unmount', () => {
    const { result, unmount } = renderHook(() => useImageProcessor());

    act(() => {
      result.current.setProcessedPhotos([{
        id: '1',
        url: 'blob:mock-url-123.jpg',
        originalUrl: 'blob:mock-url-before-123.jpg',
        listingGroupId: 'group-1',
        captureTime: new Date().toISOString(),
        roomName: 'Blob Room'
      }]);
    });

    unmount();

    expect(revokedUrls).toContain('blob:mock-url-123.jpg');
    expect(revokedUrls).toContain('blob:mock-url-before-123.jpg');
  });

  it('does not revoke non-blob urls', () => {
    const { result, unmount } = renderHook(() => useImageProcessor());

    act(() => {
      result.current.setProcessedPhotos([{
        id: '1',
        url: 'https://example.com/1.jpg',
        listingGroupId: 'group-1',
        captureTime: new Date().toISOString(),
        roomName: 'Test'
      }]);
    });

    unmount();
    expect(revokedUrls).not.toContain('https://example.com/1.jpg');
  });
});
