'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import ProcessingConsole from './ProcessingConsole';
import ReviewGrid from './ReviewGrid';
import { useTranslation } from '../hooks/useTranslation';

type FlowState = 'IDLE' | 'CONFIRMATION' | 'PROCESSING' | 'REVIEW';

type ProcessedHDR = {
  id: string;
  url: string;
  originalUrl?: string; 
  listingGroupId: string;
  captureTime: string;
  roomName: string;
  status?: string;
  isFlagged?: boolean;
  vlmReport?: any;
};

export default function UploadFlow() {
  const { t } = useTranslation();
  const [flowState, setFlowState] = useState<FlowState>('IDLE');
  const [isDragging, setIsDragging] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // We manage the final array of processed photos here now
  const [processedPhotos, setProcessedPhotos] = useState<ProcessedHDR[]>([]);
  
  const [stats, setStats] = useState({ brackets: 0, photos: 0, properties: 1 });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [expectedRooms, setExpectedRooms] = useState(1);

  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('session');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleResumeSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/session/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSessionId(id);
        setProcessedPhotos(data.photos || []);
        setFlowState('REVIEW');
      } else {
        showToast(t('error_session_not_found') || "Session not found");
      }
    } catch (error) {
      showToast(t('error_resume_session') || "Error resuming session");
    }
  }, [API_URL, t]);

  useEffect(() => {
    if (urlSessionId) {
      handleResumeSession(urlSessionId);
    }
  }, [urlSessionId, handleResumeSession]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const allFiles = Array.from(e.target.files || []);
    const files = allFiles.filter(file => file.type.startsWith('image/'));
    
    if (files.length === 0) {
        if (allFiles.length > 0) showToast("Only images are supported");
        return;
    }
    
    setUploadedFiles(files);
    
    // Very naive heuristic for expected rooms: assume 5 brackets per room
    const estRooms = Math.max(1, Math.floor(files.length / 5));
    setExpectedRooms(estRooms);
    
    setStats({
      brackets: files.length,
      photos: estRooms,
      properties: 1
    });
    setFlowState('CONFIRMATION');
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const allFiles = Array.from(e.dataTransfer?.files || []);
    const files = allFiles.filter(file => file.type.startsWith('image/'));
    
    if (files.length === 0) {
        if (allFiles.length > 0) showToast("Only images are supported");
        return;
    }
    
    setUploadedFiles(files);
    
    // Very naive heuristic for expected rooms: assume 5 brackets per room
    const estRooms = Math.max(1, Math.floor(files.length / 5));
    setExpectedRooms(estRooms);
    
    setStats({
      brackets: files.length,
      photos: estRooms,
      properties: 1
    });
    setFlowState('CONFIRMATION');
  }, []);

  const processUpload = async () => {
    setFlowState('PROCESSING');
    try {
      const sid = crypto.randomUUID();
      setSessionId(sid);
      
      // 1. Get presigned URLs
      const fileNames = uploadedFiles.map(f => f.name);
      const urlRes = await fetch(`${API_URL}/api/v1/upload-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, files: fileNames })
      });
      const urlData = await urlRes.json();

      // 2. Upload directly to GCP (Mocked in local, real in prod)
      await Promise.all(uploadedFiles.map(async (file, idx) => {
         const uploadData = urlData.urls[idx];
         if (uploadData.url.startsWith('http')) {
             await fetch(uploadData.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }});
         }
      }));

      // 3. Finalize Job (Backend groups by Time/EXIF and queues Cloud Tasks)
      const fileMeta = uploadedFiles.map(f => ({ name: f.name, timestamp: f.lastModified, size: f.size }));
      await fetch(`${API_URL}/api/v1/finalize-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, files: fileMeta })
      });

    } catch (err) {
      console.error(err);
      showToast("Upload failed");
      setFlowState('IDLE');
    }
  };

  const handleProcessingComplete = (results: ProcessedHDR[] = []) => {
    setProcessedPhotos(results);
    setFlowState('REVIEW');
  };

  // Actions for Review Queue
  const handleKeepItem = (id: string) => {
      setProcessedPhotos(prev => prev.map(p => 
          p.id === id ? { ...p, isFlagged: false, status: 'READY' } : p
      ));
  };

  const handleDiscardItem = (id: string) => {
      setProcessedPhotos(prev => prev.filter(p => p.id !== id));
  };

  const handleFinalExport = () => {
      const hasUnreviewed = processedPhotos.some(p => p.isFlagged || p.status === 'FLAGGED');
      if (hasUnreviewed) {
          const proceed = window.confirm("You have unreviewed images in the queue. Exporting will discard them. Proceed?");
          if (!proceed) return;
      }
      const exportCount = processedPhotos.filter(p => !p.isFlagged && p.status !== 'FLAGGED').length;
      showToast(`Exporting batch of ${exportCount} images...`);
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
      {/* TOAST */}
      {toastMessage && (
        <div className="fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-md shadow-lg z-50 animate-in slide-in-from-top-4">
          {toastMessage}
        </div>
      )}

      {flowState === 'IDLE' && (
        <div 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={clsx(
            "w-full max-w-4xl p-8 md:p-24 border-2 border-dashed rounded-xl transition-all duration-300 flex flex-col items-center justify-center text-center",
            isDragging ? "border-amber-500 bg-amber-500/5 scale-[1.02]" : "border-border/50 bg-secondary/20 hover:border-border hover:bg-secondary/30"
          )}
        >
           <h2 className="text-2xl font-light tracking-tight mb-2">Drop bracketed photos here</h2>
           <p className="text-muted-foreground text-sm mb-6">We'll group, align, and fuse them automatically.</p>
           
           <div className="relative">
             <input 
               type="file" 
               multiple 
               accept="image/*" 
               id="mobile-file-upload" 
               className="hidden" 
               onChange={handleFileInput} 
             />
             <label 
               htmlFor="mobile-file-upload" 
               className="px-6 py-3 bg-foreground text-background hover:bg-foreground/90 transition-colors rounded-full font-medium cursor-pointer text-sm uppercase tracking-wider shadow-sm"
             >
               Browse Photos
             </label>
           </div>
        </div>
      )}

      {flowState === 'CONFIRMATION' && (
        <div className="w-full max-w-md bg-secondary/30 border border-border/50 rounded-xl p-8 animate-in zoom-in-95">
           <h2 className="text-2xl font-light mb-6">Batch Summary</h2>
           <div className="space-y-4 mb-8 text-sm">
              <div className="flex justify-between border-b border-border/50 pb-2">
                 <span className="text-muted-foreground">Total Files</span>
                 <span className="font-medium">{stats.brackets}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                 <span className="text-muted-foreground">Estimated Rooms</span>
                 <span className="font-medium">{stats.photos}</span>
              </div>
           </div>
           <div className="flex gap-4">
              <button onClick={() => setFlowState('IDLE')} className="flex-1 py-3 px-4 rounded border border-border hover:bg-secondary transition-colors text-sm uppercase tracking-wider">Cancel</button>
              <button onClick={processUpload} className="flex-1 py-3 px-4 rounded bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium text-sm uppercase tracking-wider">Process Batch</button>
           </div>
        </div>
      )}

      {flowState === 'PROCESSING' && (
        <ProcessingConsole 
          sessionId={sessionId} 
          expectedRooms={expectedRooms}
          onComplete={handleProcessingComplete} 
        />
      )}

      {flowState === 'REVIEW' && (
        <div className="w-full h-[calc(100vh-64px)] absolute top-16 left-0 overflow-hidden">
            <ReviewGrid 
               photos={processedPhotos} 
               onConfirm={handleFinalExport}
               onDiscardItem={handleDiscardItem}
               onKeepItem={handleKeepItem}
            />
        </div>
      )}
    </div>
  );
}
