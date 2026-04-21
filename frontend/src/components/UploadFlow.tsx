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
        <div className="fixed top-24 right-8 bg-[#2A2A2A] border border-white/10 text-white px-6 py-4 rounded-lg shadow-2xl z-50 animate-in slide-in-from-top-4 flex items-center gap-3">
          <Info className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* QUOTA HEADER */}
      {(flowState === 'IDLE' || flowState === 'CONFIRMATION') && quota && (
        <div className="mb-8 px-5 py-2 bg-[#1C1C1E] border border-white/5 shadow-inner shadow-black/20 rounded-full text-xs font-medium flex items-center gap-3 text-white/50 tracking-wide uppercase">
            <span>Monthly Allotment</span>
            <span className="text-white bg-white/10 px-2 py-0.5 rounded">{quota.used} / {quota.limit} Scenes</span>
        </div>
      )}

      {/* STATE: IDLE */}
      {flowState === 'IDLE' && (
        <div className="w-full flex flex-col items-center animate-in fade-in duration-700">
          <div className="w-full max-w-3xl aspect-[16/9] md:aspect-[21/9] bg-[#141415] border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_20px_40px_rgba(0,0,0,0.4)] rounded-2xl flex flex-col items-center justify-center text-center p-8 relative overflow-hidden group">
            
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
            
            <UploadCloud className="w-12 h-12 text-white/20 mb-6 group-hover:text-white/40 transition-colors duration-500" />
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight mb-3 text-white">Import bracketed sets</h2>
            <p className="text-white/40 text-sm md:text-base mb-8 max-w-md mx-auto leading-relaxed">
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
                className="px-8 py-3.5 bg-white text-black hover:bg-white/90 transition-all rounded-full font-semibold cursor-pointer text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95 block"
              >
                Browse Files
              </label>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-4xl text-center px-4">
             <div className="flex flex-col items-center gap-3">
                <Layers className="w-6 h-6 text-white/30" />
                <h3 className="text-sm font-semibold text-white/80">Intelligent Grouping</h3>
                <p className="text-xs text-white/40 leading-relaxed">Time-based EXIF detection automatically organizes your 3, 5, or 7 bracket sets instantly.</p>
             </div>
             <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded flex items-center justify-center border border-white/30 text-white/30 text-[10px] font-bold">HDR</div>
                <h3 className="text-sm font-semibold text-white/80">Zero-Halo Fusion</h3>
                <p className="text-xs text-white/40 leading-relaxed">Structural OpenCV alignment ensures window pulls and deep shadows remain perfectly sharp.</p>
             </div>
             <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-white/30" />
                <h3 className="text-sm font-semibold text-white/80">MLS Optimized Output</h3>
                <p className="text-xs text-white/40 leading-relaxed">Final images are intelligently tone-mapped and sized for pristine Multiple Listing Service delivery.</p>
             </div>
          </div>
        </div>
      )}

      {/* STATE: PARSING */}
      {flowState === 'PARSING' && (
        <div className="flex flex-col items-center justify-center py-24 animate-in fade-in">
           <Loader2 className="w-8 h-8 text-white/50 animate-spin mb-6" />
           <h2 className="text-xl font-medium tracking-tight mb-2">Analyzing EXIF Data</h2>
           <p className="text-white/40 text-sm">Organizing {uploadedFiles.length} files into structural groups...</p>
        </div>
      )}

      {/* STATE: CONFIRMATION (Intelligent Queue View) */}
      {flowState === 'CONFIRMATION' && (
        <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
           <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6 border-b border-white/10 pb-6">
              <div>
                 <h2 className="text-3xl font-medium tracking-tight text-white mb-2">Ready to Process</h2>
                 <p className="text-white/50">
                    <strong className="text-white">{photoGroups.length} Scenes</strong> detected from {uploadedFiles.length} files.
                 </p>
              </div>
              <div className="flex gap-3">
                 <button onClick={() => setFlowState('IDLE')} className="px-6 py-3 rounded-full border border-white/10 hover:bg-white/5 text-white transition-colors text-sm font-medium tracking-wide">
                    Cancel
                 </button>
                 <button onClick={processUploadBatch} className="px-6 py-3 rounded-full bg-white text-black hover:bg-white/90 transition-all font-semibold text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95">
                    Generate {photoGroups.length} Final Images
                 </button>
              </div>
           </div>
           
           <div className="bg-[#141415] border border-white/5 shadow-inner rounded-xl p-6 overflow-hidden">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 max-h-[60vh] overflow-y-auto pr-2 pb-4 custom-scrollbar">
                 {photoGroups.map((group, idx) => (
                    <div key={group.id} className="flex flex-col gap-2 group">
                       <div className="relative aspect-[3/2] rounded-lg overflow-hidden border border-white/10 bg-black shadow-lg">
                          {/* Stack effect */}
                          <div className="absolute inset-0 bg-white/5 translate-x-1 translate-y-1 rounded-lg -z-10" />
                          <div className="absolute inset-0 bg-white/5 translate-x-2 translate-y-2 rounded-lg -z-20" />
                          
                          <img src={group.previewUrl} alt={`Scene ${idx + 1}`} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                          
                          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono font-medium text-white border border-white/10">
                             {group.photos.length} brackets
                          </div>
                       </div>
                       <div className="text-xs font-medium text-white/60 px-1">Scene {idx + 1}</div>
                    </div>
                 ))}
              </div>
           </div>
           
           <div className="mt-6 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg text-sm text-amber-500/90">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <p>Please review the scene groupings above. If the algorithm grouped a bathroom with a hallway, your camera's clock or burst speed may be irregular. If so, cancel and upload them separately.</p>
           </div>
        </div>
      )}

      {/* STATE: UPLOADING */}
      {flowState === 'UPLOADING' && (
         <div className="w-full max-w-2xl flex flex-col items-center justify-center py-24 animate-in fade-in">
            <h2 className="text-2xl font-medium tracking-tight mb-8">Uploading Shoot Data</h2>
            
            <div className="w-full bg-[#1C1C1E] border border-white/5 h-3 rounded-full overflow-hidden mb-4 shadow-inner">
               <div 
                  className="h-full bg-white transition-all duration-300 ease-out" 
                  style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}
               />
            </div>
            
            <div className="flex justify-between w-full text-sm font-medium">
               <span className="text-white/40">Chunking & Transferring...</span>
               <span className="text-white font-mono">{uploadProgress.completed} / {uploadProgress.total}</span>
            </div>
            
            <p className="mt-8 text-xs text-white/30 text-center flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full">
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
        <div className="w-full h-[calc(100vh-64px)] absolute top-16 left-0 overflow-hidden bg-black">
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
