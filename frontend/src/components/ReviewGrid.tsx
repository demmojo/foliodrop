'use client';

import React, { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

import BeforeAfterSlider from './BeforeAfterSlider';
import ExposureModal from './ExposureModal';

type ProcessedHDR = {
  id: string;
  url: string;
  originalUrl?: string;
  listingGroupId: string;
  captureTime: string;
  roomName: string;
};

export default function ReviewGrid({ 
  initialPhotos, 
  onExportListing,
  sessionId,
  initialExpiresAt
}: { 
  initialPhotos: ProcessedHDR[],
  onExportListing?: (groupId: string) => void,
  sessionId?: string,
  initialExpiresAt?: string
}) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<ProcessedHDR[]>(initialPhotos);
  const [exportingGroups, setExportingGroups] = useState<Set<string>>(new Set());
  const [selectedPhoto, setSelectedPhoto] = useState<ProcessedHDR | null>(null);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  React.useEffect(() => {
    setPhotos(initialPhotos);
  }, [initialPhotos]);

  React.useEffect(() => {
    if (initialExpiresAt) setExpiresAt(initialExpiresAt);
  }, [initialExpiresAt]);

  const handleShare = () => {
    if (!sessionId) return;
    const url = `${window.location.origin}/?session=${sessionId}`;
    navigator.clipboard.writeText(url);
    // Could add toast here
    // alert(t('link_copied')) -> better off handled by parent or a simple alert for now
    alert(t('link_copied'));
  };

  const handleResetTimer = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/extend`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setExpiresAt(data.expires_at);
        alert(t('timer_reset_success'));
      } else {
        alert(t('timer_reset_failed'));
      }
    } catch (error) {
      console.error("Failed to reset timer", error);
      alert(t('timer_reset_failed'));
    }
  };

  const getExpiryString = () => {
    if (!expiresAt) return `${t('expires_in')} 48h`;
    const hoursLeft = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60)));
    return `${t('expires_in')} ${hoursLeft}h`;
  };

  const handleSplit = (photoIndex: number) => {
    const newGroupId = `group-${Date.now()}`;
    const updatedPhotos = photos.map((photo, i) => {
      if (i >= photoIndex) {
        return { ...photo, listingGroupId: newGroupId };
      }
      return photo;
    });
    setPhotos(updatedPhotos);
  };

  const handleExport = async (groupId: string, displayId: string, groupPhotos: ProcessedHDR[]) => {
    setExportingGroups(prev => new Set(prev).add(groupId));
    
    try {
      const zip = new JSZip();
      
      // Fetch and add each photo to the zip
      for (let i = 0; i < groupPhotos.length; i++) {
        const photo = groupPhotos[i];
        try {
          const response = await fetch(photo.url);
          const blob = await response.blob();
          const extension = blob.type === 'image/png' ? 'png' : 'jpg';
          // Sanitize room name
          const safeName = photo.roomName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
          zip.file(`${safeName}_${i + 1}.${extension}`, blob);
        } catch (err) {
          console.error(`Failed to fetch photo ${photo.url}`, err);
          // Fallback content if fetch fails (e.g. CORS issues)
          zip.file(`${photo.roomName}.txt`, `Failed to download image from ${photo.url}`);
        }
      }
      
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `Property_${displayId}.zip`);
      
      if (onExportListing) onExportListing(displayId);
    } catch (error) {
      console.error("Export failed", error);
      alert("Failed to export ZIP file");
    } finally {
      setExportingGroups(prev => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  };

  const groupedListings = photos.reduce((acc, photo) => {
    if (!acc[photo.listingGroupId]) {
      acc[photo.listingGroupId] = [];
    }
    acc[photo.listingGroupId].push(photo);
    return acc;
  }, {} as Record<string, ProcessedHDR[]>);

  return (
    <div className="px-4 sm:px-8 md:px-16 max-w-[1600px] mx-auto space-y-16 md:space-y-24">
      {sessionId && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-surface border border-border p-4 shadow-sm mb-[-2rem] gap-4 sm:gap-0">
          <div className="flex items-center justify-between w-full sm:w-auto gap-4">
            <span className="text-muted font-sans text-[10px] tracking-[0.15em] uppercase font-semibold">
              Share Session
            </span>
            <button 
              onClick={handleShare}
              className="text-foreground font-sans text-xs font-medium hover:text-accent transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              {t('copy_link') || 'Copy Link'}
            </button>
          </div>
          <div className="flex items-center justify-between w-full sm:w-auto gap-4 sm:gap-6 mt-2 sm:mt-0 pt-3 sm:pt-0 border-t border-surface sm:border-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-muted font-mono text-[10px] uppercase tracking-widest">
                {getExpiryString()}
              </span>
            </div>
            <button 
              onClick={handleResetTimer}
              title={t('timer_tooltip')}
              className="bg-background border border-border text-foreground hover:bg-surface hover:border-zinc-300 dark:hover:border-zinc-600 px-3 sm:px-4 py-1.5 sm:py-2 text-[9px] sm:text-[10px] tracking-[0.1em] uppercase font-bold transition-all shrink-0"
            >
              {t('extend_session')}
            </button>
          </div>
        </div>
      )}

      {Object.entries(groupedListings).map(([groupId, groupPhotos], groupIndex) => {
        const displayId = String(groupIndex + 1).padStart(2, '0');
        const isExporting = exportingGroups.has(groupId);
        
        return (
          <div key={groupId} className="space-y-8">
            {/* The Split Line (Explicit Action) */}
            {groupIndex > 0 && (
              <div className="relative pt-8 pb-4">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center">
                  <button 
                    onClick={() => handleSplit(photos.findIndex(p => p.id === groupPhotos[0].id))}
                    className="bg-background text-muted px-4 py-1 text-[10px] tracking-[0.2em] uppercase font-sans border border-border hover:text-foreground hover:border-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground focus-visible:ring-offset-background"
                  >
                    {t('split_sequence')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-end justify-between border-b border-border pb-4">
              <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
                {t('property')} <span className="text-muted font-sans text-lg ml-2">{displayId}</span>
              </h2>
              <button 
                onClick={() => handleExport(groupId, displayId, groupPhotos)}
                disabled={isExporting}
                className="text-foreground font-sans text-xs tracking-[0.1em] uppercase hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground focus-visible:ring-offset-background"
              >
                {isExporting ? t('preparing_zip') : t('export_zip')}
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
              {groupPhotos.map((photo, indexInGroup) => {
                const originalIndex = photos.findIndex(p => p.id === photo.id);
                
                return (
                  <div key={photo.id} className="relative group">
                    <div className="aspect-[4/3] bg-surface overflow-hidden relative transition-all duration-300">
                      {photo.originalUrl ? (
                        <BeforeAfterSlider 
                          beforeUrl={photo.originalUrl} 
                          afterUrl={photo.url} 
                          isMocked={photo.url.startsWith('blob:')}
                        />
                      ) : (
                        <img 
                          src={photo.url} 
                          alt={photo.roomName}
                          // Apply a subtle CSS filter if it's a blob URL (mock data) to enhance believability
                          className={clsx(
                            "w-full h-full object-cover transition-transform duration-500 group-hover:scale-105",
                            photo.url.startsWith('blob:') && "contrast-105 saturate-110 brightness-105"
                          )}
                          crossOrigin="anonymous"
                          loading="lazy"
                        />
                      )}
                      
                      {/* Elegant Exposure Verification Icon */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all duration-300 z-30 pointer-events-none">
                        <button 
                          onClick={() => setSelectedPhoto(photo)}
                          className="w-8 h-8 bg-surface/90 backdrop-blur-md rounded-full flex items-center justify-center text-foreground hover:bg-foreground hover:text-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground focus-visible:ring-offset-surface pointer-events-auto" 
                          title={t('inspect_image')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                            <circle cx="12" cy="12" r="4" />
                            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    
                    <div className="mt-3 flex justify-between items-baseline">
                      <p className="text-foreground font-sans text-xs font-medium tracking-wide truncate pr-2">{photo.roomName}</p>
                      <p className="text-muted font-mono text-[9px] uppercase tracking-widest shrink-0">{new Date(photo.captureTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      
      <ExposureModal 
        photo={selectedPhoto} 
        isOpen={!!selectedPhoto} 
        onClose={() => setSelectedPhoto(null)} 
      />
    </div>
  );
}