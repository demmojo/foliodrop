'use client';

import { useState } from 'react';
import clsx from 'clsx';
import BeforeAfterSlider from './BeforeAfterSlider';

interface ProcessedHDR {
  id: string;
  url: string;
  originalUrl?: string; 
  listingGroupId: string;
  captureTime: string;
  roomName: string;
  status?: string;
  isFlagged?: boolean;
  vlmReport?: {
      window_reasoning: string;
      window_score: number;
  };
}

interface ReviewGridProps {
  photos: ProcessedHDR[];
  onConfirm: () => void;
  onDiscardItem?: (id: string) => void;
  onKeepItem?: (id: string) => void;
}

export default function ReviewGrid({ photos, onConfirm, onDiscardItem, onKeepItem }: ReviewGridProps) {
  const [loupeImage, setLoupeImage] = useState<ProcessedHDR | null>(null);

  const reviewQueue = photos.filter(p => p.isFlagged || p.status === 'FLAGGED');
  const cargoGrid = photos.filter(p => !p.isFlagged && p.status !== 'FLAGGED');

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-[#222222] text-[#f5f5f5] font-sans">
      
      {/* REVIEW QUEUE (LEFT ON DESKTOP, TOP ON MOBILE) */}
      {reviewQueue.length > 0 && (
        <div className="w-full md:w-1/3 lg:w-1/4 border-b md:border-b-0 md:border-r border-white/10 p-4 md:overflow-y-auto bg-[#1A1A1A] flex-shrink-0">
          <h3 className="text-xs uppercase tracking-widest text-amber-500 mb-6 font-semibold">
            Needs Review ({reviewQueue.length})
          </h3>
          <div className="flex flex-col gap-6">
            {reviewQueue.map((photo) => (
              <div key={photo.id} className="group flex flex-col gap-2 p-3 bg-[#2D2D2D] rounded-md border border-white/5 hover:border-amber-500/50 transition-colors">
                <div 
                   className="w-full aspect-[3/2] bg-black cursor-pointer overflow-hidden rounded relative"
                   onClick={() => setLoupeImage(photo)}
                >
                   {photo.url ? (
                       <img src={photo.url} alt={photo.roomName} className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-opacity" />
                   ) : (
                       <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">Loading...</div>
                   )}
                   <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                       <span className="text-white text-xs uppercase tracking-widest bg-black/60 px-2 py-1 rounded">Inspect</span>
                   </div>
                </div>
                
                <div className="flex justify-between items-center mt-1">
                    <span className="text-sm font-medium truncate pr-2">{photo.roomName}</span>
                    <div className="flex gap-2 flex-shrink-0">
                        {onKeepItem && (
                            <button onClick={() => onKeepItem(photo.id)} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors" title="Dismiss Flag">
                                ✓ Keep
                            </button>
                        )}
                        {onDiscardItem && (
                            <button onClick={() => onDiscardItem(photo.id)} className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/40 transition-colors" title="Discard Image">
                                🗑️ Drop
                            </button>
                        )}
                    </div>
                </div>
                
                {photo.vlmReport && (
                    <details className="mt-1">
                        <summary className="text-xs text-white/50 cursor-pointer hover:text-white/80 outline-none list-none">
                            <span className="flex items-center gap-1">
                                <span className="text-amber-500/80">⚠️ QA Note</span> (Score: {photo.vlmReport.window_score})
                            </span>
                        </summary>
                        <p className="text-[10px] text-white/60 leading-relaxed mt-2 p-2 bg-black/30 rounded border-l-2 border-amber-500/30">
                            {photo.vlmReport.window_reasoning}
                        </p>
                    </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CARGO GRID (RIGHT ON DESKTOP, BOTTOM ON MOBILE) */}
      <div className={clsx("flex-1 p-4 md:p-8 overflow-y-auto", reviewQueue.length === 0 && "w-full")}>
         <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-8 gap-4">
            <div>
                <h2 className="text-2xl font-light text-white tracking-tight">Ready for Export</h2>
                <p className="text-sm text-white/40 mt-1">{cargoGrid.length} images processed successfully.</p>
            </div>
            <button 
              onClick={onConfirm}
              className="bg-white text-black px-6 py-3 sm:py-2 rounded-full sm:rounded font-medium text-sm hover:bg-white/90 transition-colors uppercase tracking-wider w-full sm:w-auto shadow-sm"
            >
              Export Batch
            </button>
         </div>

         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cargoGrid.map((photo) => (
               <div key={photo.id} className="flex flex-col gap-2">
                 <div className="w-full aspect-[4/3] bg-[#1A1A1A] rounded overflow-hidden">
                    {photo.url && <img src={photo.url} alt={photo.roomName} className="object-cover w-full h-full" />}
                 </div>
                 <div className="text-xs text-white/60 font-medium px-1">{photo.roomName}</div>
               </div>
            ))}
         </div>
         {cargoGrid.length === 0 && reviewQueue.length > 0 && (
             <div className="w-full h-48 md:h-64 flex items-center justify-center text-center px-4 text-white/20 border border-dashed border-white/10 rounded-lg">
                 All images require review. Please check the queue.
             </div>
         )}
      </div>

      {/* LOUPE MODAL */}
      {loupeImage && (
          <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
              <div className="flex justify-between items-center p-4 border-b border-white/10">
                  <div className="flex items-center gap-4">
                      <span className="text-white font-medium truncate max-w-[200px] md:max-w-none">{loupeImage.roomName}</span>
                      <span className="hidden sm:inline-block text-xs text-amber-500 border border-amber-500/30 bg-amber-500/10 px-2 py-1 rounded">Needs Review</span>
                  </div>
                  <button onClick={() => setLoupeImage(null)} className="text-white/60 hover:text-white text-3xl p-2 leading-none">&times;</button>
              </div>
              <div className="flex-1 overflow-hidden relative flex items-center justify-center p-4 md:p-8">
                 <div className="w-full max-w-6xl aspect-[3/2] relative bg-[#111]">
                    <BeforeAfterSlider 
                       beforeImage={loupeImage.originalUrl || loupeImage.url} 
                       afterImage={loupeImage.url} 
                    />
                 </div>
              </div>
              <div className="p-4 border-t border-white/10 flex justify-center gap-2 sm:gap-4 bg-[#111] pb-safe">
                 {onKeepItem && (
                     <button 
                        onClick={() => { onKeepItem(loupeImage.id); setLoupeImage(null); }}
                        className="px-4 sm:px-6 py-3 sm:py-2 bg-white/10 hover:bg-white/20 text-white rounded text-xs sm:text-sm transition-colors uppercase tracking-wider flex-1 sm:flex-none"
                     >
                         Keep
                     </button>
                 )}
                 {onDiscardItem && (
                     <button 
                        onClick={() => { onDiscardItem(loupeImage.id); setLoupeImage(null); }}
                        className="px-4 sm:px-6 py-3 sm:py-2 bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded text-xs sm:text-sm transition-colors uppercase tracking-wider flex-1 sm:flex-none"
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
