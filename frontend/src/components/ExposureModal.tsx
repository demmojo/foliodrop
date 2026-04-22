import React, { useEffect, useRef } from 'react';
import BeforeAfterSlider from './BeforeAfterSlider';
import ParameterSlider from './ParameterSlider';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

type ProcessedHDR = {
  id: string;
  url: string;
  originalUrl?: string;
  captureTime: string;
  roomName: string;
  telemetry?: any[];
  parameters?: Record<string, number>;
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
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'a' || e.key === 'A') {
        // [A] to Approve
        console.log(`Approved: ${photo?.id}`);
        // Typically call an onApprove callback here
        onClose();
      } else if (e.key === 'r' || e.key === 'R') {
        // [R] to Reject
        console.log(`Rejected: ${photo?.id}`);
        // Typically call an onReject callback here
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
  }, [isOpen, onClose, photo]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90 animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        className="w-full h-full flex flex-col bg-zinc-950 text-zinc-100 animate-in zoom-in-95 duration-300"
      >
        {/* Header - Pro Utility aesthetic */}
        <div className="flex-none flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 py-3 bg-zinc-900 border-b border-zinc-800 z-10 gap-3 sm:gap-0">
          <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto overflow-hidden">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
              <h2 id="modal-title" className="text-white font-sans text-sm font-semibold tracking-wide uppercase truncate max-w-[150px] sm:max-w-xs">
                {photo.roomName}
              </h2>
            </div>
            
            <div className="hidden sm:flex items-center gap-4 text-zinc-400 font-mono text-[10px] tracking-widest uppercase">
              <span className="flex items-center gap-1.5 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formattedTime}
              </span>
              <div className="w-px h-3 bg-zinc-700 shrink-0"></div>
              <span className="shrink-0">{t('hdr_fusion_engine')}</span>
              <div className="w-px h-3 bg-zinc-700 shrink-0"></div>
              <span className="text-accent flex items-center gap-1.5 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
                {t('critical_inspection')}
              </span>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="absolute sm:relative top-3 right-4 sm:top-auto sm:right-auto flex items-center gap-2 px-3 py-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-muted group"
            aria-label="Close modal"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">{t('close') || 'Close'}</span>
            <kbd className="hidden sm:inline-flex items-center justify-center font-sans text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 group-hover:bg-zinc-700 group-hover:border-zinc-600 transition-colors">{t('esc')}</kbd>
          </button>
        </div>

        {/* Content Area & Sidebar */}
        <div className="flex-1 flex min-h-0 relative">
          
          {/* Image Area - Munsell N5 background for neutral image inspection */}
          <div 
            className="flex-1 min-w-0 relative bg-[#808080] cursor-crosshair"
            onClick={handleBackdropClick}
          >
            <div className="absolute inset-0 flex items-center justify-center p-8 md:p-12 pointer-events-none">
              {photo.originalUrl ? (
                <div className="w-full h-full max-w-7xl max-h-full mx-auto shadow-2xl shadow-black/50 ring-1 ring-surface/10 rounded-none overflow-hidden pointer-events-auto">
                  <BeforeAfterSlider 
                    beforeUrl={photo.originalUrl} 
                    afterUrl={photo.url} 
                    objectFit="contain"
                  />
                </div>
              ) : (
                <img 
                  src={photo.url} 
                  alt={photo.roomName}
                  className="max-w-full max-h-full object-contain shadow-2xl shadow-black/50 ring-1 ring-surface/10 rounded-sm pointer-events-auto"
                  crossOrigin="anonymous"
                />
              )}
            </div>
          </div>
          
          {/* HITL Parameters Sidebar */}
          <div className="w-72 bg-zinc-900 flex flex-col border-l border-zinc-800 shrink-0 overflow-y-auto z-10 shadow-2xl">
             <div className="p-4 border-b border-zinc-800">
               <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-300">HITL Editor</h3>
               <p className="text-[10px] text-zinc-400 mt-1">Adjust parameters. [A] to Approve, [R] to Reject.</p>
             </div>
             
             <div className="p-4 flex flex-col">
               {photo.parameters ? (
                 <>
                   <ParameterSlider label="Exposure (EV)" min={-3} max={3} value={photo.parameters.exposure_ev ?? 0} ghostValue={photo.telemetry?.[0]?.raw_output?.exposure_ev} />
                   <ParameterSlider label="Contrast Intensity" min={0} max={20} value={photo.parameters.contrast_intensity ?? 0} ghostValue={photo.telemetry?.[0]?.raw_output?.contrast_intensity} />
                   <ParameterSlider label="Contrast Midpoint" min={0} max={100} value={photo.parameters.contrast_midpoint ?? 50} ghostValue={photo.telemetry?.[0]?.raw_output?.contrast_midpoint} />
                   <ParameterSlider label="Warmth" min={0.5} max={2.0} value={photo.parameters.warmth ?? 1.0} ghostValue={photo.telemetry?.[0]?.raw_output?.warmth} />
                   <ParameterSlider label="Tint" min={0.5} max={2.0} value={photo.parameters.tint ?? 1.0} ghostValue={photo.telemetry?.[0]?.raw_output?.tint} />
                   <ParameterSlider label="Sharpness" min={-3} max={3} value={photo.parameters.sharpness ?? 0} ghostValue={photo.telemetry?.[0]?.raw_output?.sharpness} />
                   <ParameterSlider label="Rotation (°)" min={-45} max={45} value={photo.parameters.rotation_degrees ?? 0} ghostValue={photo.telemetry?.[0]?.raw_output?.rotation_degrees} />
                   <ParameterSlider label="Lens Barrel" min={-0.1} max={0.1} value={photo.parameters.barrel_distortion ?? 0} ghostValue={photo.telemetry?.[0]?.raw_output?.barrel_distortion} />
                 </>
               ) : (
                 <div className="text-xs text-zinc-400 text-center py-10">No VLM parameters available for this image.</div>
               )}
             </div>
          </div>
        </div>

        {/* Pro Utility Footer */}
        <div className="flex-none px-4 sm:px-6 py-2 bg-zinc-900 border-t border-zinc-800 z-10 flex justify-between items-center overflow-x-auto whitespace-nowrap hide-scrollbar">
          <div className="flex gap-4 sm:gap-6 text-zinc-400 font-mono text-[9px] uppercase tracking-widest min-w-max">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>
              {photo.originalUrl ? t('before_raw') : t('source_image')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-100"></span>
              {photo.originalUrl ? t('after_fused') : t('processed_view')}
            </span>
          </div>
          <div className="hidden sm:flex gap-4 items-center min-w-max ml-4">
            <span className="text-zinc-500 font-mono text-[9px] tracking-widest uppercase">
              {t('source_image')}
            </span>
            <div className="w-px h-3 bg-zinc-700"></div>
            <span className="text-zinc-500 font-mono text-[9px] tracking-widest uppercase">
              {t('processed_view')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}