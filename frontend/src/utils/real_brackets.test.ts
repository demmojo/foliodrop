import { describe, it, expect } from 'vitest';
import { parsePhotoMetadata, groupPhotosIntoScenes } from './exif';
import fs from 'fs';
import path from 'path';

describe('Real Brackets Grouping', () => {
  it('correctly parses and groups the example brackets', async () => {
    // In vitest with jsdom, __dirname might not be reliable, let's use process.cwd()
    const bracketsDir = path.join(process.cwd(), '../example_brackets');
    if (!fs.existsSync(bracketsDir)) {
      console.warn(`example_brackets not found at ${bracketsDir}, skipping`);
      return;
    }
    
    const files = fs.readdirSync(bracketsDir).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg'));
    expect(files.length).toBeGreaterThan(0);
    
    // Create File objects
    const fileObjects = files.map(filename => {
      const buffer = fs.readFileSync(path.join(bracketsDir, filename));
      return new File([buffer], filename, { type: 'image/jpeg' });
    });
    
    // 1. Parse metadata
    const metaList = await parsePhotoMetadata(fileObjects);
    
    expect(metaList.length).toBe(files.length);
    
    // Verify some EXIF got extracted
    const withTime = metaList.filter(m => m.captureTime > 0);
    expect(withTime.length).toBeGreaterThan(0);
    
    // 2. Group into scenes
    const groups = groupPhotosIntoScenes(metaList);
    
    // Based on our analysis, we expect 4 groups of 5 photos each
    expect(groups.length).toBe(4);
    for (const group of groups) {
      expect(group.photos.length).toBe(5);
    }
  });
});
