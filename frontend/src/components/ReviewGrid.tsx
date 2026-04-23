'use client';

import { useState } from 'react';
import clsx from 'clsx';
import BeforeAfterSlider from './BeforeAfterSlider';
import { ProcessedHDR } from '../store/useJobStore';

interface ReviewGridProps {
  photos: ProcessedHDR[];
  onConfirm: () => void;
  onDiscardItem?: (id: string) => void;
  onKeepItem?: (id: string) => void;
  onOverrideWithManualEdit?: (id: string, file: File) => void;
}

export default function ReviewGrid({ photos, onConfirm, onDiscardItem, onKeepItem, onOverrideWithManualEdit }: ReviewGridProps) {
  const [loupeImage, setLoupeImage] = useState<ProcessedHDR | null>(null);

  const reviewQueue = photos?.filter(p => p.isFlagged || p.status === 'NEEDS_REVIEW' || p.status === 'FLAGGED') || [];
  const cargoGrid = photos?.filter(p => !p.isFlagged && p.status === 'READY') || [];

  const handleImageError = async (e: React.SyntheticEvent<HTMLImageElement, Event>, originalUrl: string) => {
      // Very basic URL refresh logic
      const target = e.currentTarget;
      // Prevent infinite loops if the URL keeps failing
      if (target.dataset.retried) return;
      target.dataset.retried = "true";

      try {
          const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
          // We need to extract the raw path from the signed URL if possible, 
          // or we just assume we can call an endpoint to get a fresh one based on some path.
          // For simplicity, let's assume the backend provides a way if we pass the expired URL or path.
          // In a real implementation we would parse the path from URL.
          let blobPath = originalUrl;
          try {
             if (originalUrl && originalUrl.startsWith('http')) {
                 const urlObj = new URL(originalUrl);
                 blobPath = urlObj.pathname.slice(1); // Remove leading slash
             }
          } catch (e) {
             // Fallback
             console.error("Failed to parse originalUrl as URL", e);
          }

          const res = await fetch(`${API_URL}/api/v1/jobs/batch-signed-url`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blob_paths: [blobPath] })
          });
          const data = await res.json();
          if (data.urls && data.urls[0] && data.urls[0].url) {
              target.src = data.urls[0].url;
          }
      } catch (err) {
          console.error("Failed to refresh signed URL", err);
      }
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-background text-foreground font-sans">
      
      {/* REVIEW QUEUE (LEFT ON DESKTOP, TOP ON MOBILE) */}
      {reviewQueue.length > 0 && (
        <div className="w-full md:w-1/3 lg:w-1/4 border-b md:border-b-0 md:border-r border-border p-4 overflow-y-auto max-h-[45dvh] md:max-h-none bg-surface flex-shrink-0">
          <h3 className="text-xs uppercase tracking-widest text-warning mb-6 font-semibold">
            Needs Review ({reviewQueue.length})
          </h3>
          <div className="flex flex-col gap-6">
            {reviewQueue.map((photo) => (
              <div key={photo.id} className="group flex flex-col gap-2 p-3 bg-background rounded-md border border-border hover:border-warning/50 transition-colors">
                <div 
                   className="w-full aspect-[3/2] bg-black cursor-pointer overflow-hidden rounded relative"
                   onClick={() => setLoupeImage(photo)}
                >
                   {photo.thumbUrl || photo.url ? (
                       <img 
                          src={photo.thumbUrl || photo.url} 
                          alt={photo.sceneName || 'Room Image'} 
                          onError={(e) => handleImageError(e, photo.thumbUrl || photo.url || '')}
                          className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity" 
                       />
                   ) : (
                       <div data-testid="loading-placeholder" className="w-full h-full flex items-center justify-center text-muted text-xs">Loading...</div>
                   )}
                   <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                       <span className="text-white text-xs uppercase tracking-widest bg-black/60 px-2 py-1 rounded">Inspect</span>
                   </div>
                </div>
                
                <div className="flex justify-between items-center mt-1">
                    <span className="text-sm font-medium truncate pr-2">{photo.sceneName}</span>
                    <div className="flex gap-2 flex-shrink-0">
                        {onOverrideWithManualEdit && (
                            <label className="flex items-center justify-center text-xs px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded bg-info/10 text-info hover:bg-info/20 transition-colors cursor-pointer" title="Override with Manual Edit">
                                ✏️ Override
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                            onOverrideWithManualEdit(photo.id, e.target.files[0]);
                                        }
                                    }}
                                />
                            </label>
                        )}
                        {onKeepItem && (
                            <button onClick={() => onKeepItem(photo.id)} className="flex items-center justify-center text-xs px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded bg-muted/20 hover:bg-muted/40 transition-colors" title="Dismiss Flag">
                                ✓ Keep
                            </button>
                        )}
                        {onDiscardItem && (
                            <button onClick={() => onDiscardItem(photo.id)} className="flex items-center justify-center text-xs px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded bg-error/10 text-error hover:bg-error/20 transition-colors" title="Discard Image">
                                🗑️ Drop
                            </button>
                        )}
                    </div>
                </div>
                
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CARGO GRID (RIGHT ON DESKTOP, BOTTOM ON MOBILE) */}
      <div className={clsx("flex-1 p-4 pb-safe md:p-8 overflow-y-auto", reviewQueue.length === 0 && "w-full")}>
         <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-8 gap-4">
            <div>
                <h2 className="text-2xl font-light text-foreground tracking-tight">Ready for Export</h2>
                <p className="text-sm text-muted mt-1">{cargoGrid.length} images processed successfully.</p>
            </div>
            <button 
              onClick={onConfirm}
              className="bg-foreground text-background px-6 py-3 sm:py-2 rounded-full sm:rounded font-medium text-sm hover:opacity-90 transition-opacity uppercase tracking-wider w-full sm:w-auto shadow-sm"
            >
              Export Batch
            </button>
         </div>

         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cargoGrid.map((photo) => (
               <div key={photo.id} className="flex flex-col gap-2">
                 <div className="w-full aspect-[4/3] bg-surface border border-border rounded overflow-hidden group cursor-pointer" onClick={() => setLoupeImage(photo)}>
                    {(photo.thumbUrl || photo.url) && (
                        <img 
                            src={photo.thumbUrl || photo.url} 
                            alt={photo.sceneName || 'Room Image'} 
                            onError={(e) => handleImageError(e, photo.thumbUrl || photo.url || '')}
                            className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity" 
                        />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden group-hover:flex bg-black/10">
                        <span className="text-white text-xs uppercase tracking-widest bg-black/60 px-2 py-1 rounded shadow-sm backdrop-blur-sm relative z-10 hidden group-hover:block">Inspect</span>
                    </div>
                 </div>
                 <div className="text-xs text-muted font-medium px-1">{photo.sceneName}</div>
               </div>
            ))}
         </div>
         {cargoGrid.length === 0 && reviewQueue.length > 0 && (
             <div data-testid="review-all-msg" className="w-full h-48 md:h-64 flex items-center justify-center text-center px-4 text-muted border border-dashed border-border rounded-lg">
                 All images require review. Please check the queue.
             </div>
         )}
      </div>

      {/* LOUPE MODAL */}
      {loupeImage && (
          <div className="fixed inset-0 z-50 bg-black/95 flex flex-col dark text-foreground">
              <div className="flex justify-between items-center p-4 border-b border-white/10">
                  <div className="flex items-center gap-4">
                      <span className="text-white font-medium truncate max-w-[200px] md:max-w-none">{loupeImage.sceneName}</span>
                      {(loupeImage.isFlagged || loupeImage.status === 'NEEDS_REVIEW') && (
                          <span className="hidden sm:inline-block text-xs text-warning border border-warning/30 bg-warning/10 px-2 py-1 rounded">Needs Review</span>
                      )}
                  </div>
                  <button onClick={() => setLoupeImage(null)} className="text-white/60 hover:text-white text-3xl p-2 leading-none">&times;</button>
              </div>
              <div className="flex-1 overflow-hidden relative flex items-center justify-center p-4 md:p-8">
                 <div className="w-full max-w-6xl aspect-[3/2] relative bg-[#111]">
                    <BeforeAfterSlider 
                       beforeUrl={loupeImage.originalUrl || loupeImage.url} 
                       afterUrl={loupeImage.url} 
                    />
                 </div>
              </div>
              <div className="p-4 border-t border-white/10 flex justify-center gap-2 sm:gap-4 bg-[#111] pb-safe">
                 {onOverrideWithManualEdit && (
                     <label className="flex items-center justify-center min-h-[44px] px-4 sm:px-6 py-3 sm:py-2 bg-info/20 hover:bg-info/40 text-info rounded text-xs sm:text-sm transition-colors uppercase tracking-wider flex-1 sm:flex-none text-center cursor-pointer">
                         Override
                         <input 
                             type="file" 
                             accept="image/*" 
                             className="hidden" 
                             onChange={(e) => {
                                 if (e.target.files && e.target.files[0]) {
                                     onOverrideWithManualEdit(loupeImage.id, e.target.files[0]);
                                     setLoupeImage(null);
                                 }
                             }}
                         />
                     </label>
                 )}
                 {onKeepItem && (loupeImage.isFlagged || loupeImage.status === 'NEEDS_REVIEW') && (
                     <button 
                        onClick={() => { onKeepItem(loupeImage.id); }}
                        className="flex items-center justify-center min-h-[44px] px-4 sm:px-6 py-3 sm:py-2 bg-white/10 hover:bg-white/20 text-white rounded text-xs sm:text-sm transition-colors uppercase tracking-wider flex-1 sm:flex-none"
                     >
                         Keep
                     </button>
                 )}
                 {onDiscardItem && (
                     <button 
                        onClick={() => { onDiscardItem(loupeImage.id); setLoupeImage(null); }}
                        className="flex items-center justify-center min-h-[44px] px-4 sm:px-6 py-3 sm:py-2 bg-error/20 hover:bg-error/40 text-error rounded text-xs sm:text-sm transition-colors uppercase tracking-wider flex-1 sm:flex-none"
                     >
                         Discard
                     </button>
                 )}
              </div>
          </div>
      )}

    </div>
  );
}
