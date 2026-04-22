import exifr from 'exifr';

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
  const metaPromises = files.map(async (file) => {
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
  });

  return Promise.all(metaPromises);
}

export function groupPhotosIntoScenes(photos: PhotoMeta[], maxGapMs: number = 10000): PhotoGroup[] {
  // Sort photos by capture time
  const sorted = [...photos].sort((a, b) => a.captureTime - b.captureTime);
  
  const groups: PhotoGroup[] = [];
  let currentGroup: PhotoMeta[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const photo = sorted[i];
    
    if (currentGroup.length === 0) {
      currentGroup.push(photo);
    } else {
      const lastPhoto = currentGroup[currentGroup.length - 1];
      const gap = photo.captureTime - lastPhoto.captureTime;
      
      // If the gap between photos is larger than maxGapMs (10 seconds),
      // we assume it's a new scene.
      if (gap > maxGapMs) {
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
