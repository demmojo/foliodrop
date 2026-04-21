import { useState, useEffect, useCallback } from 'react';

type ProcessedHDR = {
  id: string;
  url: string; // The after/processed URL
  originalUrl?: string; // The before/raw URL
  listingGroupId: string;
  captureTime: string;
  roomName: string;
  telemetry?: any[];
  parameters?: Record<string, number>;
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

  return { 
    processedPhotos, 
    setProcessedPhotos 
  };
}