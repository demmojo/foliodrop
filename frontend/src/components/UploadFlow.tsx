'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import ProcessingConsole from './ProcessingConsole';
import ReviewGrid from './ReviewGrid';
import { useTranslation } from '../hooks/useTranslation';
import { useJobStore, ProcessedHDR } from '../store/useJobStore';
import { parsePhotoMetadata, groupPhotosIntoScenes, PhotoGroup, PhotoMeta } from '../utils/exif';
import pLimit from 'p-limit';
import { UploadCloud, Layers, Loader2, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';

type FlowState = 'IDLE' | 'PARSING' | 'CONFIRMATION' | 'UPLOADING' | 'PROCESSING' | 'REVIEW';

export default function UploadFlow() {
  const { t } = useTranslation();
  const [flowState, setFlowState] = useState<FlowState>('IDLE');
  const [isDragging, setIsDragging] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const [photoGroups, setPhotoGroups] = useState<PhotoGroup[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<PhotoMeta[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ total: number; completed: number; failed: number }>({ total: 0, completed: 0, failed: 0 });

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
    setTimeout(() => setToastMessage(null), 5000);
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
       // Ensure we only transition if we have jobs and ALL of them are in a final/reviewable state.
       if (allJobs.length > 0 && allJobs.every(j => ['COMPLETED', 'FLAGGED', 'FAILED', 'NEEDS_REVIEW', 'READY'].includes(j.status))) {
           setFlowState('REVIEW');
       }
    }
  }, [jobs, flowState]);

  // Global drag handling for the "Apple Pro" full-window drag drop feel
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (flowState === 'IDLE') setIsDragging(true);
    };
    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 || e.clientY === 0) { // Ensures we truly left the window
        setIsDragging(false);
      }
    };
    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [flowState]);

  const processSelectedFiles = async (allFiles: File[]) => {
    const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/tiff'];
    const files = allFiles.filter(file => SUPPORTED_TYPES.includes(file.type));
    
    if (files.length === 0) {
        if (allFiles.length > 0) showToast("Only JPEG, PNG, and TIFF formats are supported. Please convert RAW files.");
        return;
    }

    if (files.length !== allFiles.length) {
      showToast(`Ignored ${allFiles.length - files.length} unsupported files. Only JPEG/PNG/TIFF allowed.`);
    }
    
    setFlowState('PARSING');
    
    try {
      const metas = await parsePhotoMetadata(files);
      setUploadedFiles(metas);
      const groups = groupPhotosIntoScenes(metas);
      setPhotoGroups(groups);
      setFlowState('CONFIRMATION');
    } catch (err) {
      console.error(err);
      showToast("Failed to parse image metadata.");
      setFlowState('IDLE');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    processSelectedFiles(Array.from(e.target.files || []));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processSelectedFiles(Array.from(e.dataTransfer?.files || []));
  };

  const processUploadBatch = async () => {
    const estRooms = photoGroups.length;
    if (quota && quota.used + estRooms > quota.limit) {
      showToast(`Quota Exceeded! You have ${quota.limit - quota.used} runs remaining, but are trying to process ${estRooms} scenes.`);
      return;
    }

    setFlowState('UPLOADING');
    setUploadProgress({ total: uploadedFiles.length, completed: 0, failed: 0 });

    try {
      const sid = crypto.randomUUID();
      setSessionId(sid);
      
      // Ensure unique filenames by prefixing index
      const filePayloads = uploadedFiles.map((meta, idx) => {
         const uniqueName = `${idx.toString().padStart(4, '0')}_${meta.file.name}`;
         return { uniqueName, file: meta.file, meta };
      });
      
      const fileNames = filePayloads.map(fp => fp.uniqueName);
      
      const urlRes = await fetch(`${API_URL}/api/v1/upload-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, files: fileNames })
      });
      const urlData = await urlRes.json();

      // Concurrency limit to prevent network saturation and timeouts
      const limit = pLimit(4);
      const uploadPromises = filePayloads.map((fp, idx) => limit(async () => {
         const uploadData = urlData.urls[idx];
         if (uploadData && uploadData.url.startsWith('http')) {
             const res = await fetch(uploadData.url, { method: 'PUT', body: fp.file, headers: { 'Content-Type': fp.file.type }});
             if (!res.ok) {
                throw new Error(`Upload failed with status ${res.status}`);
             }
             setUploadProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
         }
      })).map(p => p.catch(err => {
         console.error("File upload error:", err);
         setUploadProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
      }));

      await Promise.all(uploadPromises);

      // Check if we had too many failures
      if (uploadProgress.failed > 0) {
         showToast(`${uploadProgress.failed} files failed to upload. Processing the rest.`);
      }

      setFlowState('PROCESSING');
      // #region agent log
      try {
        fetch('http://127.0.0.1:7781/ingest/a6897ccc-a1f3-4fc8-8c4a-1b64d961de9c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'daa93d'},body:JSON.stringify({sessionId:'daa93d',hypothesisId:'H4',location:'frontend/UploadFlow.tsx:processUploadBatch',message:'transitioning to PROCESSING',data:{},timestamp:Date.now()})}).catch(()=>{});
      } catch(e) {}
      // #endregion

      const keyStr = `${sid}-${uploadedFiles.length}-${Date.now()}`;
      const msgUint8 = new TextEncoder().encode(keyStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const idempotencyKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Pass the *unique* names so the backend can group the correct blobs
      const fileMeta = filePayloads.map(fp => ({ 
        name: fp.uniqueName, 
        timestamp: fp.meta.captureTime, 
        size: fp.file.size 
      }));

      const finalizeRes = await fetch(`${API_URL}/api/v1/finalize-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, idempotency_key: idempotencyKey, files: fileMeta })
      });
      
      const finalizeData = await finalizeRes.json();
      if (finalizeData.job_ids) {
          addJobs(finalizeData.job_ids, sid);
      } else if (finalizeData.error) {
          throw new Error(finalizeData.error);
      }

    } catch (err) {
      console.error(err);
      showToast("Pipeline initialization failed. Please try again.");
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
      showToast(`Preparing ${exportCount} images for download...`);
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4 pb-12 pt-8">
      {/* GLOBAL DRAG OVERLAY */}
      {isDragging && flowState === 'IDLE' && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center transition-all duration-300"
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center gap-6 animate-in zoom-in-95 pointer-events-none">
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center border border-white/20 shadow-2xl shadow-white/5">
              <UploadCloud className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-3xl font-medium text-white tracking-tight">Drop folders to import</h2>
            <p className="text-white/60 font-medium">RAW processing currently not supported. Drop JPEGs/TIFFs.</p>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toastMessage && (
        <div className="fixed top-24 right-8 bg-surface border border-border text-foreground px-6 py-4 rounded-lg shadow-2xl z-50 animate-in slide-in-from-top-4 flex items-center gap-3">
          <Info className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* QUOTA HEADER */}
      {(flowState === 'IDLE' || flowState === 'CONFIRMATION') && quota && (
        <div className="mb-8 px-5 py-2 bg-surface border border-border shadow-sm rounded-full text-xs font-medium flex items-center gap-3 text-muted tracking-wide uppercase">
            <span>Monthly Allotment</span>
            <span className="text-foreground bg-foreground/5 px-2 py-0.5 rounded">{quota.used} / {quota.limit} Scenes</span>
        </div>
      )}

      {/* STATE: IDLE */}
      {flowState === 'IDLE' && (
        <div className="w-full flex flex-col items-center animate-in fade-in duration-700">
          <div className="w-full max-w-3xl aspect-[16/9] md:aspect-[21/9] bg-surface border border-border shadow-sm rounded-2xl flex flex-col items-center justify-center text-center p-8 relative overflow-hidden group">
            
            <div className="absolute inset-0 bg-gradient-to-b from-foreground/[0.02] to-transparent pointer-events-none" />
            
            <UploadCloud className="w-12 h-12 text-muted mb-6 group-hover:text-foreground/80 transition-colors duration-500" />
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight mb-3 text-foreground">Import bracketed sets</h2>
            <p className="text-muted text-sm md:text-base mb-8 max-w-md mx-auto leading-relaxed">
              Auto-grouping powered by EXIF metadata. Drop JPEG or TIFF shoot folders here.
            </p>
            
            <div className="relative z-10">
              <input 
                type="file" 
                multiple 
                accept="image/jpeg, image/png, image/tiff" 
                id="file-upload" 
                className="hidden" 
                onChange={handleFileInput} 
              />
              <label 
                htmlFor="file-upload" 
                className="px-8 py-3.5 bg-foreground text-background hover:opacity-90 transition-all rounded-full font-semibold cursor-pointer text-sm shadow-sm active:scale-95 block"
              >
                Browse Files
              </label>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-4xl text-center px-4">
             <div className="flex flex-col items-center gap-3">
                <Layers className="w-6 h-6 text-muted" />
                <h3 className="text-sm font-semibold text-foreground">Intelligent Grouping</h3>
                <p className="text-xs text-muted leading-relaxed">Time-based EXIF detection automatically organizes your 3, 5, or 7 bracket sets instantly.</p>
             </div>
             <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded flex items-center justify-center border border-muted text-muted text-[10px] font-bold">HDR</div>
                <h3 className="text-sm font-semibold text-foreground">Zero-Halo Fusion</h3>
                <p className="text-xs text-muted leading-relaxed">Structural OpenCV alignment ensures window pulls and deep shadows remain perfectly sharp.</p>
             </div>
             <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-muted" />
                <h3 className="text-sm font-semibold text-foreground">MLS Optimized Output</h3>
                <p className="text-xs text-muted leading-relaxed">Final images are intelligently tone-mapped and sized for pristine Multiple Listing Service delivery.</p>
             </div>
          </div>
        </div>
      )}

      {/* STATE: PARSING */}
      {flowState === 'PARSING' && (
        <div className="flex flex-col items-center justify-center py-24 animate-in fade-in">
           <Loader2 className="w-8 h-8 text-muted animate-spin mb-6" />
           <h2 className="text-xl font-medium tracking-tight mb-2 text-foreground">Analyzing EXIF Data</h2>
           <p className="text-muted text-sm">Organizing {uploadedFiles.length} files into structural groups...</p>
        </div>
      )}

      {/* STATE: CONFIRMATION (Intelligent Queue View) */}
      {flowState === 'CONFIRMATION' && (
        <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
           <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6 border-b border-border pb-6">
              <div>
                 <h2 className="text-3xl font-medium tracking-tight text-foreground mb-2">Ready to Process</h2>
                 <p className="text-muted">
                    <strong className="text-foreground">{photoGroups.length} Scenes</strong> detected from {uploadedFiles.length} files.
                 </p>
              </div>
              <div className="flex gap-3">
                 <button onClick={() => setFlowState('IDLE')} className="px-6 py-3 rounded-full border border-border hover:bg-muted/5 text-foreground transition-colors text-sm font-medium tracking-wide">
                    Cancel
                 </button>
                 <button onClick={processUploadBatch} className="px-6 py-3 rounded-full bg-foreground text-background hover:opacity-90 transition-all font-semibold text-sm shadow-sm active:scale-95">
                    Generate {photoGroups.length} Final Images
                 </button>
              </div>
           </div>
           
           <div className="bg-surface border border-border shadow-sm rounded-xl p-6 overflow-hidden">
              <div className="flex flex-col gap-8 max-h-[60vh] overflow-y-auto pr-2 pb-4 custom-scrollbar">
                 {photoGroups.map((group, idx) => {
                    // Sort photos from darkest to lightest
                    // We can estimate brightness by exposureCompensation, or exposureTime
                    const sortedPhotos = [...group.photos].sort((a, b) => {
                        const evA = a.exposureCompensation ?? 0;
                        const evB = b.exposureCompensation ?? 0;
                        if (evA !== evB) return evA - evB;
                        
                        const timeA = a.exposureTime ?? 0;
                        const timeB = b.exposureTime ?? 0;
                        return timeA - timeB;
                    });

                    return (
                        <div key={group.id} className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Scene {idx + 1}</h3>
                                <span className="text-xs text-muted bg-foreground/5 px-2 py-1 rounded">{group.photos.length} brackets</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                                {sortedPhotos.map((photo, pIdx) => (
                                    <div key={pIdx} className="flex flex-col gap-2">
                                        <div className="aspect-[3/2] rounded-lg overflow-hidden border border-border bg-black shadow-sm">
                                            <img src={photo.previewUrl} alt={`Bracket ${pIdx + 1}`} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex flex-col gap-0.5 px-1">
                                            <span className="text-xs font-medium text-foreground">
                                                {photo.exposureCompensation !== undefined 
                                                    ? `${photo.exposureCompensation > 0 ? '+' : ''}${photo.exposureCompensation} EV` 
                                                    : '0 EV'}
                                            </span>
                                            <div className="text-[10px] text-muted flex flex-wrap gap-x-2">
                                                {photo.exposureTime && <span>{photo.exposureTime >= 1 ? photo.exposureTime : `1/${Math.round(1 / photo.exposureTime)}`}s</span>}
                                                {photo.fNumber && <span>f/{photo.fNumber}</span>}
                                                {photo.iso && <span>ISO {photo.iso}</span>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                 })}
              </div>
           </div>
           
           <div className="mt-6 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg text-sm text-amber-600 dark:text-amber-500">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <p>Please review the scene groupings above. If the algorithm grouped a bathroom with a hallway, your camera&apos;s clock or burst speed may be irregular. If so, cancel and upload them separately.</p>
           </div>
        </div>
      )}

      {/* STATE: UPLOADING */}
      {flowState === 'UPLOADING' && (
         <div className="w-full max-w-2xl flex flex-col items-center justify-center py-24 animate-in fade-in">
            <h2 className="text-2xl font-medium tracking-tight mb-8 text-foreground">Uploading Shoot Data</h2>
            
            <div className="w-full bg-surface border border-border h-3 rounded-full overflow-hidden mb-4 shadow-inner">
               <div 
                  className="h-full bg-foreground transition-all duration-300 ease-out" 
                  style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}
               />
            </div>
            
            <div className="flex justify-between w-full text-sm font-medium">
               <span className="text-muted">Chunking & Transferring...</span>
               <span className="text-foreground font-mono">{uploadProgress.completed} / {uploadProgress.total}</span>
            </div>
            
            <p className="mt-8 text-xs text-muted text-center flex items-center gap-2 bg-surface px-4 py-2 rounded-full border border-border">
               <Info className="w-4 h-4" />
               Please leave this window open until the upload completes.
            </p>
         </div>
      )}

      {/* STATE: PROCESSING */}
      {flowState === 'PROCESSING' && (
        <ProcessingConsole 
          sessionId={activeSessionId} 
          expectedRooms={photoGroups.length || 1}
          onComplete={() => setFlowState('REVIEW')} 
        />
      )}

      {/* STATE: REVIEW */}
      {flowState === 'REVIEW' && (
        <div className="w-full h-[calc(100vh-64px)] absolute top-16 left-0 overflow-hidden bg-background">
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
