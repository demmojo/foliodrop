import { useState, useEffect, useCallback } from 'react';

type ProcessedHDR = {
  id: string;
  url: string; // The after/processed URL
  originalUrl?: string; // The before/raw URL
  listingGroupId: string;
  captureTime: string;
  roomName: string;
};

// Pure utility function to extract previews safely
export const extractHdrPreviews = (files: File[], expectedPhotos: number): File[] => {
  if (files.length === 0) return [];
  
  // Defensive math: default to groups of 3 if expectedPhotos calculation is weird
  const groupSize = Math.max(3, Math.floor(files.length / expectedPhotos)) || 3;
  const selectedFiles: File[] = [];

  for (let i = 0; i < files.length; i += groupSize) {
    // Attempt to pick a "middle" bracket to look somewhat like a mid-exposure, fallback to the first
    const middleOffset = Math.floor(groupSize / 2);
    const file = files[i + middleOffset] || files[i];
    if (file) {
      selectedFiles.push(file);
    }
  }

  return selectedFiles;
};

export function useImageProcessor() {
  const [processedPhotos, setProcessedPhotos] = useState<ProcessedHDR[]>([]);

  // Cleanup effect prevents memory leaks when component unmounts or photos change
  useEffect(() => {
    return () => {
      processedPhotos.forEach((photo) => {
        if (photo.url.startsWith('blob:')) {
          URL.revokeObjectURL(photo.url);
        }
        if (photo.originalUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(photo.originalUrl);
        }
      });
    };
  }, [processedPhotos]);

  const processMockFiles = useCallback((files: File[], statsPhotos: number) => {
    const selectedFiles = extractHdrPreviews(files, statsPhotos);
    
    let currentGroup = 1;
    const newPhotos: ProcessedHDR[] = selectedFiles.map((file, index) => {
      // Group every 5 photos into a property
      if (index > 0 && index % 5 === 0) {
        currentGroup++;
      }
      
      const objectUrl = URL.createObjectURL(file);
      return {
        id: crypto.randomUUID(), // Stable ID
        url: objectUrl, // After image (same in mock)
        originalUrl: objectUrl, // Before image (same in mock)
        listingGroupId: `group-${currentGroup}`,
        captureTime: new Date().toISOString(),
        roomName: `Room ${index + 1}`
      };
    });

    setProcessedPhotos(newPhotos);
    return newPhotos;
  }, []);

  return { 
    processedPhotos, 
    setProcessedPhotos, 
    processMockFiles 
  };
}