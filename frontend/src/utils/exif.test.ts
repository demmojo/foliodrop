import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePhotoMetadata, groupPhotosIntoScenes } from './exif';
import exifr from 'exifr';

vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(),
  },
}));

describe('exif utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn().mockImplementation((file: File) => `blob:${file.name}`);
  });

  describe('parsePhotoMetadata', () => {
    it('should parse EXIF data when available', async () => {
      const mockFile = new File([''], 'test.jpg', { lastModified: 1000 });
      const mockDate = new Date('2023-01-01T12:00:00Z');
      
      vi.mocked(exifr.parse).mockResolvedValueOnce({
        DateTimeOriginal: mockDate,
        ExposureCompensation: -1,
        ExposureTime: 0.01,
        FNumber: 8,
        ISO: 100,
      });

      const result = await parsePhotoMetadata([mockFile]);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        file: mockFile,
        captureTime: mockDate.getTime(),
        previewUrl: 'blob:test.jpg',
        exposureCompensation: -1,
        exposureTime: 0.01,
        fNumber: 8,
        iso: 100,
      });
      expect(exifr.parse).toHaveBeenCalledWith(mockFile, ['DateTimeOriginal', 'ExposureCompensation', 'ExposureTime', 'FNumber', 'ISO']);
    });

    it('should fallback to lastModified if EXIF parsing fails', async () => {
      const mockFile = new File([''], 'test.jpg', { lastModified: 2000 });
      vi.mocked(exifr.parse).mockRejectedValueOnce(new Error('Parse error'));

      const result = await parsePhotoMetadata([mockFile]);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        file: mockFile,
        captureTime: 2000,
        previewUrl: 'blob:test.jpg',
        exposureCompensation: undefined,
        exposureTime: undefined,
        fNumber: undefined,
        iso: undefined,
      });
    });

    it('should handle undefined EXIF data without throwing', async () => {
      const mockFile = new File([''], 'test.jpg', { lastModified: 3000 });
      vi.mocked(exifr.parse).mockResolvedValueOnce(undefined);

      const result = await parsePhotoMetadata([mockFile]);
      
      expect(result[0].captureTime).toBe(3000);
    });

    it('should handle EXIF data without DateTimeOriginal', async () => {
      const mockFile = new File([''], 'test.jpg', { lastModified: 4000 });
      vi.mocked(exifr.parse).mockResolvedValueOnce({
        ExposureCompensation: -2,
      });

      const result = await parsePhotoMetadata([mockFile]);
      
      expect(result[0].captureTime).toBe(4000);
      expect(result[0].exposureCompensation).toBe(-2);
    });
  });

  describe('groupPhotosIntoScenes', () => {
    beforeEach(() => {
      vi.stubGlobal('crypto', {
        randomUUID: () => Math.random().toString(36).substring(7),
      });
    });

    it('should group photos by capture time with default gap', () => {
      const photos = [
        { file: new File([''], '1.jpg'), captureTime: 1000, previewUrl: 'url1' },
        { file: new File([''], '2.jpg'), captureTime: 2000, previewUrl: 'url2' },
        { file: new File([''], '3.jpg'), captureTime: 15000, previewUrl: 'url3' },
        { file: new File([''], '4.jpg'), captureTime: 16000, previewUrl: 'url4' },
      ] as any;

      const groups = groupPhotosIntoScenes(photos);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].photos).toHaveLength(2);
      expect(groups[0].photos[0].captureTime).toBe(1000);
      expect(groups[0].photos[1].captureTime).toBe(2000);
      expect(groups[0].previewUrl).toBe('url2');
      
      expect(groups[1].photos).toHaveLength(2);
      expect(groups[1].photos[0].captureTime).toBe(15000);
      expect(groups[1].photos[1].captureTime).toBe(16000);
      expect(groups[1].previewUrl).toBe('url4');
    });

    it('should group photos based on repeating exposure compensation sequence', () => {
      const photos = [
        { file: new File([''], '1.jpg'), captureTime: 1000, exposureCompensation: -2, previewUrl: 'url1' },
        { file: new File([''], '2.jpg'), captureTime: 1100, exposureCompensation: 0, previewUrl: 'url2' },
        { file: new File([''], '3.jpg'), captureTime: 1200, exposureCompensation: 2, previewUrl: 'url3' },
        { file: new File([''], '4.jpg'), captureTime: 1300, exposureCompensation: -2, previewUrl: 'url4' },
        { file: new File([''], '5.jpg'), captureTime: 1400, exposureCompensation: 0, previewUrl: 'url5' },
        { file: new File([''], '6.jpg'), captureTime: 1500, exposureCompensation: 2, previewUrl: 'url6' },
      ] as any;

      // Small gap < 2500ms should still be split because of repeating sequence
      const groups = groupPhotosIntoScenes(photos);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].photos).toHaveLength(3);
      expect(groups[1].photos).toHaveLength(3);
    });

    it('should group photos based on repeating exposure time sequence', () => {
      const photos = [
        { file: new File([''], '1.jpg'), captureTime: 1000, exposureTime: 0.1, previewUrl: 'url1' },
        { file: new File([''], '2.jpg'), captureTime: 1100, exposureTime: 0.5, previewUrl: 'url2' },
        { file: new File([''], '3.jpg'), captureTime: 1200, exposureTime: 1.0, previewUrl: 'url3' },
        { file: new File([''], '4.jpg'), captureTime: 1300, exposureTime: 0.1, previewUrl: 'url4' },
        { file: new File([''], '5.jpg'), captureTime: 1400, exposureTime: 0.5, previewUrl: 'url5' },
        { file: new File([''], '6.jpg'), captureTime: 1500, exposureTime: 1.0, previewUrl: 'url6' },
      ] as any;

      const groups = groupPhotosIntoScenes(photos);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].photos).toHaveLength(3);
      expect(groups[1].photos).toHaveLength(3);
    });

    it('should group photos in chunks of 5 when captureTime is exactly same and no exposure data is available', () => {
      const photos = Array.from({ length: 12 }, (_, i) => ({
        file: new File([''], `${i.toString().padStart(4, '0')}.jpg`),
        captureTime: 1000, // all exactly the same
        previewUrl: `url${i}`
      })) as any;

      const groups = groupPhotosIntoScenes(photos);
      
      // Since chunking by 5 was removed, everything goes into one group if no exposure data or gap
      expect(groups).toHaveLength(1);
      expect(groups[0].photos).toHaveLength(12);
    });

    it('should sort photos by filename when captureTime is identical', () => {
      const photos = [
        { file: new File([''], 'c.jpg'), captureTime: 1000, previewUrl: 'urlc' },
        { file: new File([''], 'a.jpg'), captureTime: 1000, previewUrl: 'urla' },
        { file: new File([''], 'b.jpg'), captureTime: 1000, previewUrl: 'urlb' },
      ] as any;

      const groups = groupPhotosIntoScenes(photos);
      
      expect(groups).toHaveLength(1);
      expect(groups[0].photos[0].file.name).toBe('a.jpg');
      expect(groups[0].photos[1].file.name).toBe('b.jpg');
      expect(groups[0].photos[2].file.name).toBe('c.jpg');
    });

    it('should return empty array for empty photos array', () => {
      expect(groupPhotosIntoScenes([])).toHaveLength(0);
    });

    it('should use custom maxGapMs', () => {
      const photos = [
        { file: new File([''], '1.jpg'), captureTime: 1000, previewUrl: 'url1' },
        { file: new File([''], '2.jpg'), captureTime: 3000, previewUrl: 'url2' },
      ] as any;

      const groups = groupPhotosIntoScenes(photos, 1000);
      
      expect(groups).toHaveLength(2);
      expect(groups[0].photos).toHaveLength(1);
      expect(groups[1].photos).toHaveLength(1);
    });
  });
});