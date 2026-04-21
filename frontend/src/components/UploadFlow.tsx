'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import ProcessingConsole from './ProcessingConsole';
import ReviewGrid from './ReviewGrid';
import { useTranslation } from '../hooks/useTranslation';
import { useJobStore, ProcessedHDR } from '../store/useJobStore';

type FlowState = 'IDLE' | 'CONFIRMATION' | 'PROCESSING' | 'REVIEW';

export default function UploadFlow() {
  const { t } = useTranslation();
  const [flowState, setFlowState] = useState<FlowState>('IDLE');
  const [isDragging, setIsDragging] = useState(false);
  const [stats, setStats] = useState({ brackets: 0, photos: 0, properties: 1 });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [expectedRooms, setExpectedRooms] = useState(1);

  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('session');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  const { jobs, activeSessionId, setSessionId, rehydrateSession, addJobs, setJobs, quota, fetchQuota } = useJobStore();

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  // Derived state for processed photos
  const processedPhotos = Object.values(jobs)
    .filter(job => job.status === 'COMPLETED' || job.status === 'FLAGGED' || job.status === 'NEEDS_REVIEW' || job.status === 'READY')
    .map(job => job.result as ProcessedHDR)
    .filter(Boolean);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleResumeSession = useCallback(async (id: string) => {
    await rehydrateSession(id);
    setFlowState('REVIEW');
  }, [rehydrateSession]);

  useEffect(() => {
    if (urlSessionId) {
      handleResumeSession(urlSessionId);
    }
  }, [urlSessionId, handleResumeSession]);

  // Check if processing is done
  useEffect(() => {
    if (flowState === 'PROCESSING') {
       const allJobs = Object.values(jobs);
       if (allJobs.length > 0 && allJobs.every(j => ['COMPLETED', 'FLAGGED', 'FAILED', 'NEEDS_REVIEW', 'READY'].includes(j.status))) {
           setFlowState('REVIEW');
       }
    }
  }, [jobs, flowState]);

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
    const estRooms = Math.max(1, Math.floor(uploadedFiles.length / 5));
    if (quota && quota.used + estRooms > quota.limit) {
      alert(`Quota Exceeded! You have ${quota.limit - quota.used} runs remaining this month, but are trying to process ${estRooms} scenes.`);
      return;
    }

    setFlowState('PROCESSING');
    try {
      const sid = crypto.randomUUID();
      setSessionId(sid);
      
      const fileNames = uploadedFiles.map(f => f.name);
      
      // #region agent log
      fetch('http://127.0.0.1:7781/ingest/a6897ccc-a1f3-4fc8-8c4a-1b64d961de9c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'769fb2'},body:JSON.stringify({sessionId:'769fb2',location:'frontend/src/components/UploadFlow.tsx:124',message:'fetching upload urls',data:{api_url: API_URL},hypothesisId:'H2',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      const urlRes = await fetch(`${API_URL}/api/v1/upload-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, files: fileNames })
      });
      const urlData = await urlRes.json();
      
      // #region agent log
      fetch('http://127.0.0.1:7781/ingest/a6897ccc-a1f3-4fc8-8c4a-1b64d961de9c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'769fb2'},body:JSON.stringify({sessionId:'769fb2',location:'frontend/src/components/UploadFlow.tsx:130',message:'upload urls received',data:{urlData},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      await Promise.all(uploadedFiles.map(async (file, idx) => {
         const uploadData = urlData.urls[idx];
         if (uploadData.url.startsWith('http')) {
             await fetch(uploadData.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }});
         }
      }));

      // Generate Idempotency Key deterministic for the batch
      // Simple hash approximation for frontend without blocking thread
      const keyStr = `${sid}-${uploadedFiles[0]?.name}-${uploadedFiles.length}`;
      const msgUint8 = new TextEncoder().encode(keyStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const idempotencyKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const fileMeta = uploadedFiles.map(f => ({ name: f.name, timestamp: f.lastModified, size: f.size }));
      const finalizeRes = await fetch(`${API_URL}/api/v1/finalize-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, idempotency_key: idempotencyKey, files: fileMeta })
      });
      
      const finalizeData = await finalizeRes.json();
      if (finalizeData.job_ids) {
          addJobs(finalizeData.job_ids, sid);
      }

    } catch (err) {
      console.error(err);
      
      // #region agent log
      fetch('http://127.0.0.1:7781/ingest/a6897ccc-a1f3-4fc8-8c4a-1b64d961de9c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'769fb2'},body:JSON.stringify({sessionId:'769fb2',location:'frontend/src/components/UploadFlow.tsx:160',message:'upload failed',data:{error: err?.toString()},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      showToast("Upload failed");
      setFlowState('IDLE');
    }
  };

  const handleKeepItem = (id: string) => {
      setJobs({
          ...jobs,
          [id]: {
              ...jobs[id],
              result: {
                  ...jobs[id].result!,
                  isFlagged: false,
                  status: 'READY'
              }
          }
      });
  };

  const handleDiscardItem = (id: string) => {
      const newJobs = { ...jobs };
      delete newJobs[id];
      setJobs(newJobs);
  };

  const handleFinalExport = () => {
      const hasUnreviewed = processedPhotos.some(p => p.isFlagged || p.status === 'NEEDS_REVIEW' || p.status === 'FLAGGED');
      if (hasUnreviewed) {
          const proceed = window.confirm("You have unreviewed images in the queue. Exporting will discard them. Proceed?");
          if (!proceed) return;
      }
      const exportCount = processedPhotos.filter(p => !p.isFlagged && p.status === 'READY').length;
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
        <div className="w-full flex flex-col items-center">
          {quota && (
            <div className="mb-6 px-4 py-2 bg-secondary/30 border border-border/50 rounded-full text-sm flex items-center gap-2">
               <span className="text-muted-foreground">Monthly Usage:</span>
               <span className="font-semibold text-amber-600 dark:text-amber-400">{quota.used} / {quota.limit}</span>
               <span className="text-muted-foreground ml-1">HDR Scenes ($500 cap)</span>
            </div>
          )}
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
          sessionId={activeSessionId} 
          expectedRooms={expectedRooms}
          onComplete={() => setFlowState('REVIEW')} 
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
