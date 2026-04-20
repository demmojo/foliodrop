import React, { useEffect, useRef } from 'react';
import BeforeAfterSlider from './BeforeAfterSlider';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

type ProcessedHDR = {
  id: string;
  url: string;
  originalUrl?: string;
  captureTime: string;
  roomName: string;
};

interface ExposureModalProps {
  photo: ProcessedHDR | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function ExposureModal({ photo, isOpen, onClose }: ExposureModalProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !photo) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const formattedTime = new Date(photo.captureTime).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className="w-full h-full flex flex-col bg-zinc-950 text-white animate-in zoom-in-95 duration-300"
      >
        {/* Header - Pro Utility aesthetic */}
        <div className="flex-none flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 py-3 bg-zinc-950 border-b border-zinc-800/60 z-10 gap-3 sm:gap-0">
          <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto overflow-hidden">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
              <h2 id="modal-title" className="text-white font-sans text-sm font-semibold tracking-wide uppercase truncate max-w-[150px] sm:max-w-xs">
                {photo.roomName}
              </h2>
            </div>
            
            <div className="hidden sm:flex items-center gap-4 text-muted font-mono text-[10px] tracking-widest uppercase">
              <span className="flex items-center gap-1.5 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formattedTime}
              </span>
              <div className="w-px h-3 bg-zinc-800 shrink-0"></div>
              <span className="shrink-0">HDR Fusion Engine</span>
              <div className="w-px h-3 bg-zinc-800 shrink-0"></div>
              <span className="text-accent flex items-center gap-1.5 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
                Critical Inspection
              </span>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="absolute sm:relative top-3 right-4 sm:top-auto sm:right-auto flex items-center gap-2 px-3 py-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-muted group"
            aria-label="Close modal"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">Close</span>
            <kbd className="hidden sm:inline-flex items-center justify-center font-sans text-[10px] bg-zinc-800/80 px-1.5 py-0.5 rounded border border-zinc-700/50 group-hover:bg-zinc-700/50 group-hover:border-zinc-600 transition-colors">{t('esc')}</kbd>
          </button>
        </div>

        {/* Content Area - Checkerboard background for image inspection */}
        <div 
          className="flex-1 min-h-0 relative bg-[#0a0a0a] cursor-crosshair"
          onClick={handleBackdropClick}
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, #111 25%, transparent 25%, transparent 75%, #111 75%, #111), repeating-linear-gradient(45deg, #111 25%, #0a0a0a 25%, #0a0a0a 75%, #111 75%, #111)`,
            backgroundPosition: `0 0, 10px 10px`,
            backgroundSize: `20px 20px`
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center p-8 md:p-12 pointer-events-none">
            {photo.originalUrl ? (
              <div className="w-full h-full max-w-7xl max-h-full mx-auto shadow-2xl shadow-black/50 ring-1 ring-surface/10 rounded-sm overflow-hidden pointer-events-auto">
                <BeforeAfterSlider 
                  beforeUrl={photo.originalUrl} 
                  afterUrl={photo.url} 
                  isMocked={photo.url.startsWith('blob:')}
                  objectFit="contain"
                />
              </div>
            ) : (
              <img 
                src={photo.url} 
                alt={photo.roomName}
                className={clsx(
                  "max-w-full max-h-full object-contain shadow-2xl shadow-black/50 ring-1 ring-surface/10 rounded-sm pointer-events-auto",
                  photo.url.startsWith('blob:') && "contrast-105 saturate-110 brightness-105"
                )}
                crossOrigin="anonymous"
              />
            )}
          </div>
        </div>

        {/* Pro Utility Footer */}
        <div className="flex-none px-4 sm:px-6 py-2 bg-zinc-950 border-t border-zinc-800/60 z-10 flex justify-between items-center overflow-x-auto surfacespace-nowrap hide-scrollbar">
          <div className="flex gap-4 sm:gap-6 text-muted font-mono text-[9px] uppercase tracking-widest min-w-max">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-muted"></span>
              {photo.originalUrl ? t('before_raw') : t('source_image')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-surface"></span>
              {photo.originalUrl ? t('after_fused') : t('processed_view')}
            </span>
          </div>
          <div className="hidden sm:flex gap-4 items-center min-w-max ml-4">
            <span className="text-zinc-600 font-mono text-[9px] tracking-widest uppercase">
              {t('source_image')}
            </span>
            <div className="w-px h-3 bg-zinc-800"></div>
            <span className="text-zinc-600 font-mono text-[9px] tracking-widest uppercase">
              {t('processed_view')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}