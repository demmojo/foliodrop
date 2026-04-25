import exifr from 'exifr';
import pLimit from 'p-limit';

export interface PhotoMeta {
  file: File;
  captureTime: number;
  previewUrl: string;
  exposureCompensation?: number;
  exposureTime?: number;
  fNumber?: number;
  iso?: number;
}

export interface PhotoGroup {
  id: string;
  photos: PhotoMeta[];
  previewUrl: string;
}

export async function parsePhotoMetadata(files: File[]): Promise<PhotoMeta[]> {
  const limit = pLimit(5); // Limit concurrency for mobile memory constraints

  const metaPromises = files.map(file => limit(async () => {
    let captureTime = file.lastModified;
    let exposureCompensation: number | undefined;
    let exposureTime: number | undefined;
    let fNumber: number | undefined;
    let iso: number | undefined;

    try {
      // Extract EXIF data
      const exifData = await exifr.parse(file, ['DateTimeOriginal', 'ExposureCompensation', 'ExposureTime', 'FNumber', 'ISO']);
      if (exifData) {
        if (exifData.DateTimeOriginal) {
          captureTime = exifData.DateTimeOriginal.getTime();
        }
        exposureCompensation = exifData.ExposureCompensation;
        exposureTime = exifData.ExposureTime;
        fNumber = exifData.FNumber;
        iso = exifData.ISO;
      }
    } catch (err) {
      // Fallback to lastModified if EXIF parsing fails or is missing
    }

    return {
      file,
      captureTime,
      previewUrl: URL.createObjectURL(file), // For showing thumbnails in the UI
      exposureCompensation,
      exposureTime,
      fNumber,
      iso,
    };
  }));

  return Promise.all(metaPromises);
}

export function groupPhotosIntoScenes(photos: PhotoMeta[], maxGapMs: number = 2500): PhotoGroup[] {
  // Sort photos by capture time, then by filename
  const sorted = [...photos].sort((a, b) => {
    if (a.captureTime !== b.captureTime) {
      return a.captureTime - b.captureTime;
    }
    return a.file.name.localeCompare(b.file.name);
  });
  
  const groups: PhotoGroup[] = [];
  let currentGroup: PhotoMeta[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const photo = sorted[i];
    
    if (currentGroup.length === 0) {
      currentGroup.push(photo);
    } else {
      const lastPhoto = currentGroup[currentGroup.length - 1];
      const gap = photo.captureTime - lastPhoto.captureTime;
      
      let isNewScene = false;

      // 1. Time gap > 2.5s usually means a new bracketed set
      if (gap > maxGapMs) {
        isNewScene = true;
      }
      // 2. If gap is very small but exposure compensation repeats, it's a new set
      else if (photo.exposureCompensation !== undefined && currentGroup.length >= 3) {
        if (photo.exposureCompensation === currentGroup[0].exposureCompensation) {
          isNewScene = true;
        }
      } else if (photo.exposureTime !== undefined && currentGroup.length >= 3) {
        if (photo.exposureTime === currentGroup[0].exposureTime) {
          isNewScene = true;
        }
      }

      if (isNewScene) {
        groups.push({
          id: crypto.randomUUID(),
          photos: currentGroup,
          previewUrl: currentGroup[Math.floor(currentGroup.length / 2)].previewUrl
        });
        currentGroup = [photo];
      } else {
        currentGroup.push(photo);
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push({
      id: crypto.randomUUID(),
      photos: currentGroup,
      previewUrl: currentGroup[Math.floor(currentGroup.length / 2)].previewUrl
    });
  }

  return groups;
}
