import React, { useState, useRef, useEffect, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
  isMocked?: boolean;
  objectFit?: 'cover' | 'contain';
}

export default function BeforeAfterSlider({ beforeUrl, afterUrl, className, isMocked, objectFit = 'cover' }: BeforeAfterSliderProps) {
  const { t } = useTranslation();
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current || !isDragging) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const position = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(position);
  };

  const handleMouseMove = (e: globalThis.MouseEvent) => handleMove(e.clientX);
  const handleTouchMove = (e: globalThis.TouchEvent) => handleMove(e.touches[0].clientX);
  
  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging]);

  const startDrag = (e: ReactMouseEvent | ReactTouchEvent) => {
    setIsDragging(true);
    if ('clientX' in e) {
      handleMove(e.clientX);
    } else {
      handleMove(e.touches[0].clientX);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={clsx("relative w-full h-full overflow-hidden select-none", className)}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
    >
      {/* Before Image (Bottom Layer) */}
      <img 
        src={beforeUrl} 
        alt="Original Exposure"
        className={clsx("absolute inset-0 w-full h-full pointer-events-none", objectFit === 'cover' ? 'object-cover' : 'object-contain')}
        crossOrigin="anonymous"
        loading="lazy"
      />
      
      {/* After Image (Top Layer) - Clipped */}
      <div 
        className="absolute inset-0 w-full h-full"
        style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
      >
        <img 
          src={afterUrl} 
          alt="Fused HDR Result"
          className={clsx(
            "absolute inset-0 w-full h-full pointer-events-none",
            objectFit === 'cover' ? 'object-cover' : 'object-contain',
            isMocked && "contrast-105 saturate-110 brightness-105"
          )}
          crossOrigin="anonymous"
          loading="lazy"
        />
      </div>

      {/* Slider Handle */}
      <div 
        className="absolute top-0 bottom-0 w-1 bg-surface cursor-ew-resize hover:bg-accent transition-colors duration-200 z-10 shadow-[0_0_10px_rgba(0,0,0,0.5)] flex items-center justify-center -ml-0.5"
        style={{ left: `${sliderPosition}%` }}
      >
        <div className="w-8 h-8 rounded-full bg-surface shadow-md border border-border flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
      
      {/* Labels */}
      <div className="absolute top-4 left-4 z-20">
        <span className="bg-black/60 backdrop-blur-sm text-white px-2 py-1 text-[10px] uppercase tracking-widest font-mono rounded-sm">{t('before')}</span>
      </div>
      <div className="absolute top-4 right-4 z-20">
        <span className="bg-black/60 backdrop-blur-sm text-white px-2 py-1 text-[10px] uppercase tracking-widest font-mono rounded-sm">{t('after')}</span>
      </div>
    </div>
  );
}
