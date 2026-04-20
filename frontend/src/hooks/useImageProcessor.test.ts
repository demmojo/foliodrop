import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractHdrPreviews, useImageProcessor } from './useImageProcessor';
import { renderHook, act } from '@testing-library/react';

describe('extractHdrPreviews', () => {
  it('returns empty array if no files', () => {
    expect(extractHdrPreviews([], 1)).toEqual([]);
  });

  it('selects middle bracket correctly for group size 3', () => {
    const files = [
      new File([''], '1.jpg'),
      new File([''], '2.jpg'),
      new File([''], '3.jpg'),
      new File([''], '4.jpg'),
      new File([''], '5.jpg'),
      new File([''], '6.jpg'),
    ];
    // statsPhotos = 2 -> files.length (6) / 2 = 3 (groupSize)
    const result = extractHdrPreviews(files, 2);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('2.jpg'); // index 1
    expect(result[1].name).toBe('5.jpg'); // index 4
  });

  it('handles remainder correctly', () => {
    const files = [
      new File([''], '1.jpg'),
      new File([''], '2.jpg'),
      new File([''], '3.jpg'),
      new File([''], '4.jpg'),
    ];
    // statsPhotos = 1 -> groupSize = 4
    // middle of 4 is index 2
    const result = extractHdrPreviews(files, 1);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('3.jpg');
  });

  it('handles empty missing middle offset gracefully', () => {
    const files = [
      new File([''], '1.jpg')
    ];
    // statsPhotos = 1 -> groupSize = 3 (Math.max)
    const result = extractHdrPreviews(files, 1);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('1.jpg'); // falls back to first file
  });
});

describe('useImageProcessor', () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    global.URL.createObjectURL = vi.fn((file: Blob) => {
      const url = `blob:mock-url-${(file as File).name}`;
      createdUrls.push(url);
      return url;
    });
    global.URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    // @ts-ignore
    if (!global.crypto) global.crypto = {};
    if (!global.crypto.randomUUID) {
      global.crypto.randomUUID = () => `uuid-${Math.random()}`;
    }
  });

  it('generates mock photos and cleans up blob urls on unmount', () => {
    const { result, unmount } = renderHook(() => useImageProcessor());

    act(() => {
      result.current.processMockFiles([
        new File([''], '1.jpg'),
        new File([''], '2.jpg'),
        new File([''], '3.jpg')
      ], 1);
    });

    expect(result.current.processedPhotos.length).toBe(1);
    expect(result.current.processedPhotos[0].url).toBe('blob:mock-url-2.jpg');
    expect(createdUrls.length).toBe(1);

    unmount();

    expect(revokedUrls).toContain('blob:mock-url-2.jpg');
  });

  it('groups every 5 photos into a new property', () => {
    const { result } = renderHook(() => useImageProcessor());
    const files: File[] = [];
    // To get 6 photos out, we need 6 * 3 = 18 files minimum since default group size is 3
    for(let i=1; i<=18; i++) {
        files.push(new File([''], `${i}.jpg`));
    }
    
    act(() => {
      result.current.processMockFiles(files, 6);
    });

    expect(result.current.processedPhotos.length).toBe(6);
    expect(result.current.processedPhotos[0].listingGroupId).toBe('group-1');
    expect(result.current.processedPhotos[4].listingGroupId).toBe('group-1');
    expect(result.current.processedPhotos[5].listingGroupId).toBe('group-2');
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
