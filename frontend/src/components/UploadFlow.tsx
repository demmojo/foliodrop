'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import ProcessingConsole from './ProcessingConsole';
import ReviewGrid from './ReviewGrid';
import { useImageProcessor } from '../hooks/useImageProcessor';
import { useTranslation } from '../hooks/useTranslation';

type FlowState = 'IDLE' | 'CONFIRMATION' | 'PROCESSING' | 'REVIEW';
// ... type ProcessedHDR is defined in the hook, but we can redefine or import it. We'll leave it locally for now.
type ProcessedHDR = {
  id: string;
  url: string;
  originalUrl?: string;
  listingGroupId: string;
  captureTime: string;
  roomName: string;
};

export default function UploadFlow() {
  const { t } = useTranslation();
  const [flowState, setFlowState] = useState<FlowState>('IDLE');
  const [isDragging, setIsDragging] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { processedPhotos, setProcessedPhotos, processMockFiles } = useImageProcessor();
  const [stats, setStats] = useState({ brackets: 0, photos: 0, properties: 0 });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [initialExpiresAt, setInitialExpiresAt] = useState<string | undefined>();
  const [showResumeInput, setShowResumeInput] = useState(false);
  const [resumeInput, setResumeInput] = useState('');

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
        if (data.expires_at) {
          setInitialExpiresAt(data.expires_at);
        }
        setProcessedPhotos(data.photos || []);
        setFlowState('REVIEW');
      } else {
        showToast(t('error_session_not_found'));
      }
    } catch (error) {
      showToast(t('error_resume_session'));
    }
  }, [API_URL, setProcessedPhotos]);

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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    // Filter to only accept image MIME types to prevent processing broken files
    const allFiles = Array.from(e.dataTransfer?.files || []);
    const files = allFiles.filter(file => file.type.startsWith('image/'));
    
    if (files.length === 0) {
        if (allFiles.length > 0) {
            showToast(t('error_only_images'));
        }
        return;
    }
    
    if (files.length > 0) {
      setUploadedFiles(files);
      setStats({
        brackets: files.length,
        photos: Math.floor(files.length / 5) || 1,
        properties: Math.floor(files.length / 25) || 1
      });
      setFlowState('CONFIRMATION');

      // Create session and upload files
      try {
        const sessionRes = await fetch(`${API_URL}/api/session`, { method: "POST" });
        const { session_id } = await sessionRes.json();
        setSessionId(session_id);

        const urlsRes = await fetch(`${API_URL}/api/upload-urls?session_id=${session_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: files.map(f => f.name) })
        });
        
        const { urls } = await urlsRes.json();
        
        // In a real app we'd PUT the files to the signed URLs here.
        // Doing the real upload now:
        await Promise.all(
          files.map((file, index) => 
            fetch(urls[index], {
              method: "PUT",
              headers: { "Content-Type": file.type },
              body: file
            })
          )
        );
      } catch (err) {
        console.error("Failed to setup session", err);
      }
    }
  }, [API_URL]);

  const startProcessing = async () => {
    setFlowState('PROCESSING');
    
    if (!sessionId) {
      // Simulate backend response for demonstration using real local files if available
      setTimeout(() => {
        if (uploadedFiles.length > 0) {
          processMockFiles(uploadedFiles, stats.photos);
        } else {
           setProcessedPhotos([{
            id: '1', url: 'https://placehold.co/1200x800/eeeeee/999999?text=Interior+View', 
            listingGroupId: 'group-1', 
            captureTime: new Date().toISOString(), 
            roomName: 'Main Living Area'
          }, {
            id: '2', url: 'https://placehold.co/1200x800/e0e0e0/888888?text=Kitchen', 
            listingGroupId: 'group-1', 
            captureTime: new Date().toISOString(), 
            roomName: 'Chef\'s Kitchen'
          }]);
        }
        setFlowState('REVIEW');
      }, 5000); 
      return;
    }

    try {
      await fetch(`${API_URL}/api/jobs/${sessionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms: ["kitchen"] })
      });
    } catch (err) {
      console.error("Failed to start processing", err);
    }
  };

  const handleExportAll = async () => {
    setIsExportingAll(true);
    try {
      const { default: JSZip } = await import('jszip');
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();
      
      for (let i = 0; i < processedPhotos.length; i++) {
        const photo = processedPhotos[i];
        try {
          const response = await fetch(photo.url);
          const blob = await response.blob();
          const extension = blob.type === 'image/png' ? 'png' : 'jpg';
          const safeName = photo.roomName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
          const folderName = `Property_${photo.listingGroupId}`;
          zip.folder(folderName)?.file(`${safeName}_${i + 1}.${extension}`, blob);
        } catch (err) {
          console.error(`Failed to fetch photo ${photo.url}`, err);
          zip.file(`${photo.roomName}.txt`, `Failed to download image from ${photo.url}`);
        }
      }
      
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `All_Properties.zip`);
      showToast("All properties exported to ZIP successfully.");
    } catch (error) {
      console.error("Export failed", error);
      showToast("Failed to export all properties.");
    } finally {
      setIsExportingAll(false);
    }
  };

  // Render Toast
  const renderToast = () => (
    <div className={clsx(
      "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
      toastMessage ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
    )}>
      <div className="bg-foreground text-background px-6 py-4 shadow-2xl flex items-center gap-4 border border-border">
        <div className="w-1.5 h-1.5 bg-surface rounded-full animate-pulse" />
        <span className="font-sans text-xs tracking-[0.1em] uppercase">{toastMessage}</span>
      </div>
    </div>
  );

  if (flowState === 'PROCESSING') {
    return (
      <div className="w-full h-full min-h-[70vh] bg-background flex flex-col items-center justify-center">
        <ProcessingConsole 
          sessionId={sessionId} 
          onComplete={(realDataFromBackend) => {
            // ALWAYS prefer real backend data if provided
            if (realDataFromBackend && Array.isArray(realDataFromBackend) && realDataFromBackend.length > 0) {
              setProcessedPhotos(realDataFromBackend);
            } 
            // Fallback to local simulation only if offline/no backend data
            else if (uploadedFiles.length > 0) {
              processMockFiles(uploadedFiles, stats.photos);
            } 
            // Fallback to placeholders if all else fails
            else {
               setProcessedPhotos([{
                id: '1', url: 'https://placehold.co/1200x800/eeeeee/999999?text=Interior+View', 
                listingGroupId: 'group-1', 
                captureTime: new Date().toISOString(), 
                roomName: 'Main Living Area'
              }, {
                id: '2', url: 'https://placehold.co/1200x800/e0e0e0/888888?text=Kitchen', 
                listingGroupId: 'group-1', 
                captureTime: new Date().toISOString(), 
                roomName: 'Chef\'s Kitchen'
              }]);
            }
            
            setFlowState('REVIEW');
          }} 
        />
      </div>
    );
  }

  if (flowState === 'REVIEW') {
    return (
      <div className="w-full min-h-[70vh] bg-background flex flex-col animate-in fade-in duration-1000">
        {renderToast()}
        <header className="px-4 md:px-8 lg:px-16 py-6 md:py-8 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-border/60 bg-background sticky top-0 z-40 shadow-sm gap-4 md:gap-0">
          <div className="w-full md:w-auto">
            <div className="text-muted font-sans text-[10px] font-bold tracking-[0.2em] uppercase mb-2">{t('project_review')}</div>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">{t('curated_exposures')}</h1>
          </div>
          <button 
            onClick={handleExportAll}
            disabled={isExportingAll}
            className="w-full md:w-auto bg-accent text-white font-sans text-[10px] font-bold tracking-[0.1em] uppercase px-8 py-3.5 hover:bg-blue-700 transition-colors disabled:opacity-70 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:ring-offset-background shadow-sm rounded-sm"
          >
            {isExportingAll ? t('preparing_zip') : t('export_all')}
          </button>
        </header>
        
        <div className="flex-1 py-8 md:py-12">
          <ReviewGrid 
            initialPhotos={processedPhotos} 
            sessionId={sessionId || undefined}
            initialExpiresAt={initialExpiresAt}
            onExportListing={(id) => {
              showToast(`Property ${id} exported to ZIP successfully.`);
            }} 
          />
        </div>
      </div>
    );
  }

  return (
    <div 
      className={clsx(
        "flex-1 w-full relative transition-colors duration-200 ease-out flex flex-col items-center justify-center min-h-[70vh] px-4 sm:px-8 bg-background",
        isDragging && flowState === 'IDLE' ? "bg-surface" : ""
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="dropzone"
    >
      <div className={clsx(
        "absolute inset-0 border border-border m-4 sm:m-6 md:m-12 transition-all duration-200 ease-out flex items-center justify-center",
        flowState === 'IDLE' 
          ? "scale-100 opacity-100" 
          : "scale-[0.98] opacity-0 pointer-events-none",
        isDragging && flowState === 'IDLE' && "border-zinc-400 scale-[0.99] bg-surface/50"
      )}>
        {flowState === 'IDLE' && (
          <div className="text-center animate-in fade-in duration-300 pointer-events-none max-w-3xl mx-auto px-4 sm:px-6 w-full">
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-4 sm:mb-6 tracking-tight leading-[1.1]">
              Import Exposures
            </h2>
            <p className="text-muted font-sans tracking-wide text-sm md:text-base max-w-md mx-auto leading-relaxed">
              Drag and drop your bracketed sequences. Our engine will align, fuse, and color-grade to architectural standards.
            </p>

            {/* Manual Resume UI */}
            <div className="pointer-events-auto mt-8 sm:mt-12">
              {showResumeInput ? (
                <div className="flex flex-col sm:flex-row justify-center items-stretch sm:items-center gap-2 max-w-xs mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <input 
                    type="text" 
                    value={resumeInput}
                    onChange={(e) => setResumeInput(e.target.value)}
                    placeholder={t('session_id')}
                    className="flex-1 border border-border px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-foreground focus:border-transparent transition-all shadow-sm w-full"
                  />
                  <button 
                    onClick={() => handleResumeSession(resumeInput)}
                    className="bg-foreground text-background px-6 py-3 text-[10px] font-bold tracking-[0.15em] uppercase hover:bg-foreground/90 transition-colors shadow-sm w-full sm:w-auto"
                  >
                    Load
                  </button>
                </div>
              ) : (
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowResumeInput(true); }}
                  className="text-muted font-sans text-[10px] tracking-[0.15em] uppercase hover:text-foreground transition-colors border-b border-transparent hover:border-foreground pb-0.5"
                >
                  Resume Previous Session
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={clsx(
        "relative z-10 p-6 sm:p-10 md:p-16 max-w-xl w-full transition-[opacity,transform] duration-200 ease-out bg-background will-change-transform shadow-sm border border-border/50 md:shadow-none md:border-none",
        flowState === 'CONFIRMATION' 
          ? "opacity-100 scale-100 translate-y-0" 
          : "opacity-0 scale-95 translate-y-4 pointer-events-none absolute"
      )}>
        <div className="text-center mb-12">
          <div className="text-muted font-sans text-[10px] tracking-[0.2em] uppercase mb-4 font-semibold">Sequence Identified</div>
          <h3 className="text-3xl font-bold text-foreground tracking-tight">{t('ready_for_fusion')}</h3>
        </div>
        
        <div className="space-y-4 mb-12 font-sans bg-surface border border-border p-6 shadow-sm">
          <div className="flex justify-between border-b border-surface pb-3">
            <span className="text-muted text-xs tracking-[0.05em] uppercase font-semibold">{t('raw_brackets')}</span>
            <span className="text-foreground font-mono text-sm">{stats.brackets}</span>
          </div>
          <div className="flex justify-between border-b border-surface pb-3">
            <span className="text-muted text-xs tracking-[0.05em] uppercase font-semibold">{t('final_compositions')}</span>
            <span className="text-foreground font-mono text-sm">{stats.photos}</span>
          </div>
          <div className="flex justify-between pb-1">
            <span className="text-muted text-xs tracking-[0.05em] uppercase font-semibold">{t('properties_detected')}</span>
            <span className="text-foreground font-mono text-sm">{stats.properties}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={startProcessing}
            data-testid="begin-processing"
            className="w-full py-4 bg-accent text-white font-sans text-[10px] font-bold tracking-[0.15em] uppercase hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent focus-visible:ring-offset-background shadow-sm"
          >
            Commence Processing
          </button>
          <button 
            onClick={() => setFlowState('IDLE')}
            className="w-full py-3 text-muted font-sans text-xs tracking-[0.1em] uppercase hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground focus-visible:ring-offset-background"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}