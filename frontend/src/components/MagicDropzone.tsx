'use client';

import { useEffect, useState } from 'react';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/react/dashboard';
import AwsS3 from '@uppy/aws-s3';
import GoldenRetriever from '@uppy/golden-retriever';
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';

export default function MagicDropzone() {
  const [uppy, setUppy] = useState<Uppy | null>(null);

  useEffect(() => {
    // Generate a temporary session ID or get from URL/storage
    const sessionId = 'session-' + Math.random().toString(36).substr(2, 9);
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    const uppyInstance = new Uppy({
      id: 'real-estate-hdr',
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: 50,
        allowedFileTypes: ['image/jpeg', 'image/png', 'image/heic'],
      },
    })
      .use(GoldenRetriever) // Saves state if browser crashes
      .use(AwsS3, {
        shouldUseMultipart: false,
        limit: 4,
        getUploadParameters(file) {
          // This would normally call our Next.js API route to get a signed URL
          // For now, we stub it.
          return {
            method: 'PUT',
            url: `https://storage.googleapis.com/fake-bucket/${sessionId}/${file.name}`,
            headers: {
              'Content-Type': file.type,
            },
          };
        },
      });

    uppyInstance.on('complete', (result) => {
      console.log('Upload complete!', result.successful);
      // Trigger finalization to backend
      fetch(`${API_URL}/api/jobs/${sessionId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms: ['LivingRoom'] }),
      });
    });

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUppy(uppyInstance);

    return () => {
        uppyInstance.destroy();
      };
  }, []);

  if (!uppy) return null;

  return (
    <div className="w-full mt-6">
      <Dashboard
        uppy={uppy}
        theme="dark"
        width="100%"
        height={350}
        proudlyDisplayPoweredByUppy={false}
        note="Upload up to 50 photos (10 brackets of 5). 12MP limit."
      />
    </div>
  );
}
