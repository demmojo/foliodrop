'use client';

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
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
import { getScopedAuthHeaders } from '@/lib/requestHeaders';

type FlowState = 'IDLE' | 'PARSING' | 'CONFIRMATION' | 'UPLOADING' | 'PROCESSING' | 'REVIEW';

export default function UploadFlow() {
  const { t } = useTranslation();
  const [flowState, setFlowState] = useState<FlowState>('IDLE');
  const [isDragging, setIsDragging] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const [photoGroups, setPhotoGroups] = useState<PhotoGroup[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<PhotoMeta[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ total: number; completed: number; failed: number }>({ total: 0, completed: 0, failed: 0 });
  const [recentSessions, setRecentSessions] = useState<{id: string, date: number, count: number}[]>([]);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessionCode, setSessionCode] = useState<string>('');
  const [sessionCodeError, setSessionCodeError] = useState<string | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [pendingSessionCode, setPendingSessionCode] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('session');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  const { jobs, activeSessionId, setSessionId, rehydrateSession, addJobs, setJobs, quota, fetchQuota } = useJobStore();

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('hdr_recent_sessions');
      if (stored) setRecentSessions(JSON.parse(stored));
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (flowState === 'IDLE' && !activeSessionId && !sessionCode && !showResumePrompt && !pendingSessionCode) {
      const storedSessionCode = localStorage.getItem('hdr_session_code');
      if (storedSessionCode) {
        setPendingSessionCode(storedSessionCode);
        setShowResumePrompt(true);
      } else {
        const fetchSession = async () => {
          try {
            const headers = await getScopedAuthHeaders();

            const res = await fetch(`${API_URL}/api/v1/sessions/generate`, { headers });
            if (res.ok) {
              const data = await res.json();
              if (data.code) {
                setSessionCode(data.code);
                localStorage.setItem('hdr_session_code', data.code);
              }
            }
          } catch (e) {
            console.error("Failed to generate session", e);
          }
        };
        fetchSession();
      }
    }
  }, [flowState, activeSessionId, sessionCode, showResumePrompt, pendingSessionCode, API_URL]);

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
    localStorage.setItem('hdr_session_code', id);
    await rehydrateSession(id);
    
    const currentJobs = useJobStore.getState().jobs;
    const allJobs = Object.values(currentJobs);
    
    if (allJobs.length > 0 && allJobs.some(j => ['PENDING', 'PROCESSING'].includes(j.status))) {
        setFlowState('PROCESSING');
    } else {
        setFlowState('REVIEW');
    }
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

  const generateThumbnail = async (file: File): Promise<string> => {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxDim = 256;
            let w = img.width;
            let h = img.height;
            if (w > h) {
                if (w > maxDim) { h *= maxDim / w; w = maxDim; }
            } else {
                if (h > maxDim) { w *= maxDim / h; h = maxDim; }
            }
            canvas.width = w;
            canvas.height = h;
            ctx?.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            // Fallback for HEIC or unsupported
            resolve('');
        };
        img.src = url;
    });
  };

  const processSelectedFiles = async (allFiles: File[]) => {
    const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/heic', 'image/heif'];
    const files = allFiles.filter(file => {
      if (SUPPORTED_TYPES.includes(file.type)) return true;
      // Fallback for browsers that don't correctly report HEIC MIME type
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ext === 'heic' || ext === 'heif';
    });
    
    if (files.length === 0) {
        if (allFiles.length > 0) showToast(t('raw_not_supported'));
        return;
    }

    if (files.length !== allFiles.length) {
      showToast(t('ignored_unsupported_files').replace('{count}', String(allFiles.length - files.length)));
    }
    
    setFlowState('PARSING');
    
    try {
      const metas = await parsePhotoMetadata(files);
      setUploadedFiles(metas);
      
      const sorted = [...metas].sort((a,b) => a.captureTime - b.captureTime);
      const noExposureData = sorted.every(m => m.exposureCompensation === undefined && m.exposureTime === undefined);
      
      // If we don't have exposure data and there are more than 5 photos, it's very likely they are multiple brackets 
      // but without EXIF data we can't reliably group them just by time (due to download/transfer delays).
      // So we use the visual AI fallback instead of blindly chunking by 5.
      if (noExposureData && sorted.length > 5) {
          showToast(t('missing_exif_using_visual_ai'));
          
          const thumbnails = await Promise.all(sorted.map(async (meta) => {
              const b64 = await generateThumbnail(meta.file);
              return { name: meta.file.name, thumbnail: b64, meta };
          }));
          
          const validThumbnails = thumbnails.filter(t => t.thumbnail);
          
          if (validThumbnails.length === thumbnails.length) {
              try {
                  const headers = await getScopedAuthHeaders({ includeContentTypeJson: true });

                  const res = await fetch(`${API_URL}/api/v1/group-photos`, {
                      method: 'POST',
                      headers,
                      body: JSON.stringify({ files: validThumbnails.map(t => ({ name: t.name, thumbnail: t.thumbnail })) })
                  });
                  if (res.ok) {
                      const data = await res.json();
                      if (data.groups && Array.isArray(data.groups)) {
                          const geminiGroups = data.groups.map((groupNames: string[], index: number) => {
                              const groupMetas = groupNames.map(name => sorted.find(m => m.file.name === name)).filter(Boolean) as PhotoMeta[];
                              return {
                                  id: `gemini-scene-${index}-${crypto.randomUUID()}`,
                                  photos: groupMetas,
                                  previewUrl: groupMetas.length > 0 ? groupMetas[Math.floor(groupMetas.length / 2)].previewUrl : ''
                              };
                          }).filter((g: any) => g.photos.length > 0);
                          
                          setPhotoGroups(geminiGroups);
                          setFlowState('CONFIRMATION');
                          return;
                      }
                  }
              } catch (e) {
                  console.error("Gemini grouping failed, using fallback", e);
              }
          }
      }
      
      const groups = groupPhotosIntoScenes(metas);
      setPhotoGroups(groups);
      setFlowState('CONFIRMATION');
    } catch (err) {
      console.error(err);
      showToast(t('failed_parse_metadata'));
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
    const estScenes = photoGroups.length;
    if (quota && quota.used + estScenes > quota.limit) {
      showToast(
        t('quota_exceeded_message')
          .replace('{remaining}', String(quota.limit - quota.used))
          .replace('{scenes}', String(estScenes))
      );
      return;
    }

    setFlowState('UPLOADING');
    setUploadProgress({ total: uploadedFiles.length, completed: 0, failed: 0 });

    try {
      if (sessionCode.length < 6) {
         showToast(t('room_code_min_chars'));
         setFlowState('IDLE');
         return;
      }
      
      const sid = sessionCode;
      setSessionId(sid);
      localStorage.setItem('hdr_session_code', sid);
      
      const newSession = { id: sid, date: Date.now(), count: estScenes };
      const updatedSessions = [newSession, ...recentSessions].slice(0, 20);
      setRecentSessions(updatedSessions);
      try {
        localStorage.setItem('hdr_recent_sessions', JSON.stringify(updatedSessions));
      } catch (e) {}
      
      // Ensure unique filenames by prefixing index
      const filePayloads = uploadedFiles.map((meta, idx) => {
         const uniqueName = `${idx.toString().padStart(4, '0')}_${meta.file.name}`;
         return { uniqueName, file: meta.file, meta };
      });
      
      const fileNames = filePayloads.map(fp => fp.uniqueName);
      
      const headers = await getScopedAuthHeaders({ includeContentTypeJson: true });

      const urlRes = await fetch(`${API_URL}/api/v1/upload-urls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: sid, files: fileNames })
      });
      const urlData = await urlRes.json();

      // Concurrency limit to prevent network saturation and timeouts
      const limit = pLimit(4);
      let failedUploads = 0;
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
         failedUploads += 1;
         setUploadProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
      }));

      await Promise.all(uploadPromises);

      // Check if we had too many failures
      if (failedUploads > 0) {
         showToast(t('files_failed_upload').replace('{count}', String(failedUploads)));
      }

      setFlowState('PROCESSING');

      const keyStr = `${sid}-${uploadedFiles.length}-${Date.now()}`;
      const msgUint8 = new TextEncoder().encode(keyStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const idempotencyKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Pass the *unique* names so the backend can group the correct blobs
      const groupedFiles = photoGroups.map((group, idx) => {
          return {
              name: `Scene ${idx + 1}`,
              files: group.photos.map(p => {
                  const fp = filePayloads.find(f => f.file === p.file);
                  return fp ? fp.uniqueName : p.file.name;
              }).filter(Boolean)
          };
      });

      const finalizeRes = await fetch(`${API_URL}/api/v1/finalize-job`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: sid, idempotency_key: idempotencyKey, groups: groupedFiles })
      });
      
      const finalizeData = await finalizeRes.json();
      if (finalizeData.job_ids) {
          // Find the middle bracket's previewUrl for each group
          const initialThumbUrls = photoGroups.map(group => {
              const photos = group.photos;
              if (!photos || photos.length === 0) return undefined;
              const middleIndex = Math.floor(photos.length / 2);
              return photos[middleIndex]?.previewUrl;
          });
          
          addJobs(finalizeData.job_ids, sid, initialThumbUrls as string[]);
      } else if (finalizeData.error) {
          throw new Error(finalizeData.error);
      }

    } catch (err) {
      console.error(err);
      showToast(t('pipeline_init_failed'));
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
      
      if (Object.keys(newJobs).length === 0) {
          setFlowState('IDLE');
          setSessionId(null);
          setSessionCode('');
          setPendingSessionCode(null);
          setPhotoGroups([]);
          setUploadedFiles([]);
          localStorage.removeItem('hdr_session_code');
          // Clear query params if any
          if (window.location.search) {
              window.history.pushState({}, '', window.location.pathname);
          }
      }
  };

  const handleFinalExport = async () => {
      const hasUnreviewed = processedPhotos.some(p => p.isFlagged || p.status === 'NEEDS_REVIEW' || p.status === 'FLAGGED');
      if (hasUnreviewed) {
          const proceed = window.confirm(t('confirm_export_with_unreviewed'));
          if (!proceed) return;
      }
      
      const readyPhotos = processedPhotos.filter(p => !p.isFlagged && p.status === 'READY');
      const exportCount = readyPhotos.length;
      
      if (exportCount === 0) {
          showToast(t('no_images_ready_for_export'));
          return;
      }

      showToast(t('preparing_images_for_export').replace('{count}', String(exportCount)));
      
      try {
          // Fetch all images
          const limit = pLimit(3); // Download max 3 in parallel
          const downloadedFiles: File[] = [];
          
          await Promise.all(readyPhotos.map(photo => limit(async () => {
              const url = photo.url;
              if (!url) return;
              
              try {
                  const response = await fetch(url);
                  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                  const blob = await response.blob();
                  
                  // determine extension from blob type or default to jpg
                  let ext = 'jpg';
                  if (blob.type === 'image/png') ext = 'png';
                  else if (blob.type === 'image/tiff') ext = 'tiff';
                  else if (blob.type === 'image/webp') ext = 'webp';
                  
                  // fallback to original name if available or generated room name
                  let filename = photo.sceneName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                  if (!filename) filename = `scene_${photo.id}`;
                  
                  // Ensure uniqueness by appending short id
                  filename = `${filename}_${photo.id.substring(0,6)}.${ext}`;
                  
                  const file = new File([blob], filename, { type: blob.type });
                  downloadedFiles.push(file);
              } catch (err) {
                  console.error(`Failed to download ${url}:`, err);
              }
          })));
          
          if (downloadedFiles.length === 0) {
              throw new Error("No files were successfully downloaded.");
          }

          // Try native Web Share API first (best for iOS/Android camera roll saving)
          if (navigator.share && navigator.canShare) {
              const shareData = {
                  files: downloadedFiles,
                  title: t('folio_export_title')
              };
              
              if (navigator.canShare(shareData)) {
                  try {
                      await navigator.share(shareData);
                      showToast(t('export_successful'));
                      return; // Exit early if share succeeds
                  } catch (err: unknown) {
                      // If user aborted the share sheet, do not fallback to ZIP. Just exit.
                      const error = err as Error;
                      if (error.name === 'AbortError' || (error.message && error.message.toLowerCase().includes('abort'))) {
                          return;
                      }
                      console.error("Native share failed, falling back to ZIP:", err);
                      // Fall through to ZIP
                  }
              }
          }
          
          // Fallback to ZIP
          showToast(t('zipping_images'));
          const zip = new JSZip();
          const folder = zip.folder("folio-export");
          
          if (!folder) throw new Error("Failed to create ZIP folder");

          for (const file of downloadedFiles) {
              folder.file(file.name, file);
          }
          
          const content = await zip.generateAsync({ type: "blob" });
          saveAs(content, `folio_export_${new Date().getTime()}.zip`);
          showToast(t('download_complete'));
      } catch (err) {
          console.error("Export failed", err);
          showToast(t('failed_export_images'));
      }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)] px-4 pb-safe pt-safe sm:pb-12 sm:pt-8 relative">

      {/* RESUME PROMPT */}
      {showResumePrompt && pendingSessionCode && flowState === 'IDLE' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center transition-all duration-300">
          <div className="bg-surface border border-border shadow-2xl rounded-2xl p-8 max-w-md w-full mx-4 flex flex-col items-center text-center animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-full bg-foreground/5 flex items-center justify-center mb-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground tracking-tight mb-2">{t('welcome_back')}</h2>
            <p className="text-muted text-sm leading-relaxed mb-8">
              {t('resume_prompt_prefix')} <strong>{pendingSessionCode}</strong>. {t('resume_prompt_suffix')}
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => {
                  setSessionCode(pendingSessionCode);
                  setShowResumePrompt(false);
                  handleResumeSession(pendingSessionCode);
                }}
                className="w-full py-3 bg-foreground text-background rounded-full font-semibold shadow-sm hover:opacity-90 active:scale-95 transition-all"
              >
                {t('continue_in_session').replace('{session}', pendingSessionCode)}
              </button>
              <button
              onClick={() => {
                localStorage.removeItem('hdr_session_code');
                setPendingSessionCode(null);
                setShowResumePrompt(false);
                setJobs({});
                setPhotoGroups([]);
                setUploadedFiles([]);
                // Let the useEffect handle the generation
              }}
              className="w-full py-3 bg-surface border border-border text-foreground rounded-full font-semibold hover:bg-muted/5 active:scale-95 transition-all"
            >
              {t('start_new_session')}
            </button>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL DRAG OVERLAY */}
      {isDragging && flowState === 'IDLE' && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center transition-all duration-300"
          onDrop={(e) => {
             e.preventDefault();
             e.stopPropagation();
             handleDrop(e);
          }}
          data-testid="drag-overlay"
        >
          <div className="flex flex-col items-center gap-6 animate-in zoom-in-95 pointer-events-none">
            <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center border border-white/20 shadow-2xl shadow-white/5">
              <UploadCloud className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-3xl font-medium text-white tracking-tight">{t('import_exposures')}</h2>
            <p className="text-white/60 font-medium">{t('supports_formats')}</p>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toastMessage && (
        <div data-testid="toast-message" className="fixed top-24 right-8 bg-surface border border-border text-foreground px-6 py-4 rounded-lg shadow-2xl z-50 animate-in slide-in-from-top-4 flex items-center gap-3">
          <Info className="w-5 h-5 text-warning" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* QUOTA HEADER */}
      {(flowState === 'IDLE' || flowState === 'CONFIRMATION') && quota && (
        <div className="mb-8 px-5 py-2 bg-surface border border-border shadow-sm rounded-full text-xs font-medium flex items-center gap-3 text-muted tracking-wide uppercase">
            <span>{t('properties_detected')}</span>
            <span className="text-foreground bg-foreground/5 px-2 py-0.5 rounded">{quota.used} / {quota.limit} {t('final_compositions')}</span>
        </div>
      )}

      {/* STATE: IDLE */}
      {flowState === 'IDLE' && (
        <div className="w-full flex flex-col items-center animate-in fade-in duration-700">
          <div className="w-full max-w-3xl min-h-[300px] md:aspect-[21/9] bg-surface border border-border shadow-sm rounded-2xl flex flex-col items-center justify-center text-center p-6 sm:p-8 relative overflow-hidden group">
            
            <div className="absolute inset-0 bg-gradient-to-b from-foreground/[0.02] to-transparent pointer-events-none" />
            
            <UploadCloud className="w-12 h-12 text-muted mb-4 sm:mb-6 group-hover:text-foreground/80 transition-colors duration-500" />
            <h2 className="text-2xl md:text-3xl font-medium tracking-tight mb-2 sm:mb-3 text-foreground">{t('import_exposures')}</h2>
            <p className="text-muted text-sm md:text-base mb-6 sm:mb-8 max-w-md mx-auto leading-relaxed">
              {t('drop_brackets')}
            </p>
            
            <div className="relative z-10 w-full sm:w-auto">
              <input 
                type="file" 
                multiple 
                accept="image/*, .heic, .heif" 
                id="file-upload" 
                className="hidden" 
                onChange={handleFileInput} 
              />
              <label 
                htmlFor="file-upload" 
                className="px-8 py-3.5 bg-foreground text-background hover:opacity-90 transition-all rounded-full font-semibold cursor-pointer text-sm shadow-sm active:scale-95 flex items-center justify-center min-h-[44px] w-full sm:w-auto"
              >
                {t('browse_files')}
              </label>
            </div>
          </div>
          
          <div className="mt-16 w-full max-w-md pt-8 border-t border-border flex flex-col items-center gap-4 relative z-10">
            <h3 className="text-sm font-medium text-foreground">{t('session_id')}</h3>
                <div className="flex w-full max-w-[400px] gap-2 items-center justify-center">
              <input
                type="text"
                value={sessionCode}
                onChange={(e) => {
                  setSessionCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  setSessionCodeError(null);
                }}
                onBlur={() => {
                  if (!sessionCode || sessionCode.length < 3) {
                    setSessionCodeError(t('must_be_at_least_3_chars'));
                  }
                }}
                placeholder={t('session_id')}
                className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 font-mono text-center"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (sessionCode) handleResumeSession(sessionCode);
                  }
                }}
                data-testid="session-code-input"
              />
              <button
                data-testid="resume-button"
                onClick={() => {
                  if (sessionCode) handleResumeSession(sessionCode);
                }}
                className="px-6 py-2.5 bg-foreground text-background rounded-lg text-sm font-semibold shadow-sm hover:opacity-90 active:scale-95 transition-all whitespace-nowrap"
              >
                {t('resume')}
              </button>
            </div>
            {sessionCodeError && <p className="text-xs text-warning mt-1" data-testid="session-code-error">{sessionCodeError}</p>}
            <p className="text-[11px] text-muted text-center max-w-[300px] mt-1">
              {t('session_help_text')}
            </p>

            <button
              onClick={() => {
                localStorage.removeItem('hdr_session_code');
                localStorage.removeItem('hdr_room_code');
                setSessionCode('');
                setSessionId(null);
                setPendingSessionCode(null);
                setJobs({});
                setPhotoGroups([]);
                setUploadedFiles([]);
                // Let the useEffect handle the generation
              }}
              className="text-xs text-foreground/70 hover:text-foreground underline underline-offset-2 transition-colors mt-2"
            >
              {t('start_new_room')}
            </button>

            {recentSessions.length > 0 && (
              <div className="w-full mt-6 flex flex-col gap-2">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 text-center">{t('recent_sessions')}</h4>
                <div className="flex flex-col gap-2 relative">
                  {recentSessions.slice(0, showAllSessions ? recentSessions.length : 2).map((session, i) => (
                    <button
                      key={session.id}
                      data-testid={`resume-session-${session.id}`}
                      onClick={() => handleResumeSession(session.id)}
                      className={clsx(
                        "flex items-center justify-between px-4 py-3 bg-surface border border-border rounded-lg hover:bg-muted/5 transition-all text-left group relative z-10",
                        !showAllSessions && i === 1 && recentSessions.length > 2 && "opacity-40 hover:opacity-100"
                      )}
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                        <span className="text-xs text-muted font-mono">{session.id}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium bg-foreground/5 text-foreground px-2 py-1 rounded border border-border/50">
                          {session.count} {session.count === 1 ? t('scene_singular') : t('scene_plural')}
                        </span>
                        <div className="w-6 h-6 rounded-full bg-foreground/5 border border-border/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-foreground text-xs font-medium">→</span>
                        </div>
                      </div>
                    </button>
                  ))}
                  
                  {!showAllSessions && recentSessions.length > 2 && (
                    <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
                  )}
                </div>
                
                {!showAllSessions && recentSessions.length > 2 && (
                  <button
                    data-testid="show-more-sessions"
                    onClick={() => setShowAllSessions(true)}
                    className="text-xs text-muted hover:text-foreground font-medium mt-2 transition-colors py-1 z-30"
                  >
                    {t('show_more_sessions').replace('{count}', String(recentSessions.length - 2))}
                  </button>
                )}
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-4xl text-center px-4">
             <div className="flex flex-col items-center gap-3">
                <Layers className="w-6 h-6 text-muted" />
                <h3 className="text-sm font-semibold text-foreground">{t('intelligent_grouping_title')}</h3>
                <p className="text-xs text-muted leading-relaxed">{t('intelligent_grouping_body')}</p>
             </div>
             <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded flex items-center justify-center border border-muted text-muted text-[10px] font-bold">AI</div>
                <h3 className="text-sm font-semibold text-foreground">{t('generative_hybrid_title')}</h3>
                <p className="text-xs text-muted leading-relaxed">{t('generative_hybrid_body')}</p>
             </div>
             <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-muted" />
                <h3 className="text-sm font-semibold text-foreground">{t('mls_optimized_output_title')}</h3>
                <p className="text-xs text-muted leading-relaxed">{t('mls_optimized_output_body')}</p>
             </div>
          </div>
        </div>
      )}

      {/* STATE: PARSING */}
      {flowState === 'PARSING' && (
        <div className="flex flex-col items-center justify-center py-24 animate-in fade-in">
           <Loader2 className="w-8 h-8 text-muted animate-spin mb-6" />
           <h2 className="text-xl font-medium tracking-tight mb-2 text-foreground">{t('status_aligning')}</h2>
           <p className="text-muted text-sm">{t('processing')} {uploadedFiles.length}…</p>
        </div>
      )}

      {/* STATE: CONFIRMATION (Intelligent Queue View) */}
      {flowState === 'CONFIRMATION' && (
        <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
           <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6 border-b border-border pb-6">
              <div>
                 <h2 className="text-3xl font-medium tracking-tight text-foreground mb-2">{t('ready_for_fusion')}</h2>
                 <p className="text-muted">
                    <strong className="text-foreground">{photoGroups.length}</strong> {t('sequence_identified')} ({uploadedFiles.length})
                 </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                 <button onClick={() => setFlowState('IDLE')} className="w-full sm:w-auto px-6 py-3 min-h-[44px] rounded-full border border-border hover:bg-muted/5 text-foreground transition-colors text-sm font-medium tracking-wide">
                    {t('cancel')}
                 </button>
                 <button onClick={processUploadBatch} className="w-full sm:w-auto px-6 py-3 min-h-[44px] rounded-full bg-foreground text-background hover:opacity-90 transition-all font-semibold text-sm shadow-sm active:scale-95">
                    {t('commence_processing')} {photoGroups.length}
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
                                <h3 className="text-sm font-semibold text-foreground">{t('scene_label').replace('{index}', String(idx + 1))}</h3>
                                <span className="text-xs text-muted bg-foreground/5 px-2 py-1 rounded">
                                  {group.photos.length} {t('brackets_label')}
                                </span>
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
           
           <div className="mt-6 flex items-start gap-3 bg-warning/10 border border-warning/20 p-4 rounded-lg text-sm text-warning">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <p>{t('review_scene_groupings_warning')}</p>
           </div>
        </div>
      )}

      {/* STATE: UPLOADING */}
      {flowState === 'UPLOADING' && (
         <div className="w-full max-w-2xl flex flex-col items-center justify-center py-24 animate-in fade-in">
            <h2 className="text-2xl font-medium tracking-tight mb-8 text-foreground">{t('crafting_imagery')}</h2>
            
            <div className="w-full bg-surface border border-border h-3 rounded-full overflow-hidden mb-4 shadow-inner">
               <div 
                  className="h-full bg-foreground transition-all duration-300 ease-out" 
                  style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}
               />
            </div>
            
            <div className="flex justify-between w-full text-sm font-medium">
               <span className="text-muted">{t('processing')}...</span>
               <span className="text-foreground font-mono">{uploadProgress.completed} / {uploadProgress.total}</span>
            </div>
            
            <p className="mt-8 text-xs text-muted text-center flex items-center gap-2 bg-surface px-4 py-2 rounded-full border border-border">
               <Info className="w-4 h-4" />
               {t('upload_keep_window_open')}
            </p>
         </div>
      )}

      {/* STATE: PROCESSING */}
      {flowState === 'PROCESSING' && (
        <ProcessingConsole 
          sessionId={activeSessionId} 
          expectedScenes={photoGroups.length || 1}
          onComplete={() => setFlowState('REVIEW')} 
        />
      )}

      {/* STATE: REVIEW */}
      {flowState === 'REVIEW' && (
        <div className="w-full h-[calc(100dvh-64px)] absolute top-16 left-0 overflow-hidden bg-background flex flex-col">
            <ReviewGrid 
               photos={processedPhotos} 
               onConfirm={handleFinalExport}
               onDiscardItem={handleDiscardItem}
               onKeepItem={handleKeepItem}
               onStartNewSession={() => {
                  setFlowState('IDLE');
                  setSessionId(null);
                  setSessionCode('');
                  setPendingSessionCode(null);
                  setPhotoGroups([]);
                  setUploadedFiles([]);
                  localStorage.removeItem('hdr_session_code');
                  if (window.location.search) {
                      window.history.pushState({}, '', window.location.pathname);
                  }
               }}
            />
        </div>
      )}
    </div>
  );
}
