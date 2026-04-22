import React, { useState, useRef, useEffect, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from '../hooks/useTranslation';

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
  objectFit?: 'cover' | 'contain';
}

export default function BeforeAfterSlider({ beforeUrl, afterUrl, className, objectFit = 'cover' }: BeforeAfterSliderProps) {
  const { t } = useTranslation();
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeImgRef = useRef<HTMLImageElement>(null);
  const afterImgRef = useRef<HTMLImageElement>(null);
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [afterLoaded, setAfterLoaded] = useState(false);

  const imagesLoaded = beforeLoaded && afterLoaded;

  // Check if images are already cached/loaded when mounted
  useEffect(() => {
    if (beforeImgRef.current?.complete) {
      setBeforeLoaded(true);
    }
    if (afterImgRef.current?.complete) {
      setAfterLoaded(true);
    }
  }, [beforeUrl, afterUrl]);

  const handleMove = (clientX: number) => {
    if (!containerRef.current || !isDragging) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const position = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(position);
  };

  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: globalThis.TouchEvent) => {
      // prevent default to avoid vertical scroll while swiping slider
      if (e.cancelable) e.preventDefault();
      handleMove(e.touches[0].clientX);
    };

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      className={clsx("relative w-full h-full overflow-hidden select-none bg-black/10", className)}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
    >
      {!imagesLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-30">
          <div className="w-8 h-8 border-4 border-muted border-t-accent rounded-full animate-spin"></div>
        </div>
      )}
      
      {/* Before Image (Bottom Layer) */}
      <img 
        ref={beforeImgRef}
        src={beforeUrl} 
        alt="Original Exposure"
        onLoad={() => setBeforeLoaded(true)}
        className={clsx(
          "absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-300",
          objectFit === 'cover' ? 'object-cover' : 'object-contain',
          imagesLoaded ? 'opacity-100' : 'opacity-0'
        )}
      />
      
      {/* After Image (Top Layer) - Clipped to the right */}
      <div 
        className={clsx(
          "absolute inset-0 w-full h-full transition-opacity duration-300",
          imagesLoaded ? 'opacity-100' : 'opacity-0'
        )}
        style={{ clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)` }}
      >
        <img 
          ref={afterImgRef}
          src={afterUrl} 
          alt="Fused HDR Result"
          onLoad={() => setAfterLoaded(true)}
          className={clsx(
            "absolute inset-0 w-full h-full pointer-events-none",
            objectFit === 'cover' ? 'object-cover' : 'object-contain'
          )}
        />
      </div>

      {/* Slider Handle */}
      <div 
        className={clsx(
          "absolute top-0 bottom-0 w-1 bg-surface cursor-ew-resize hover:bg-accent transition-all duration-300 z-10 shadow-[0_0_10px_rgba(0,0,0,0.5)] flex items-center justify-center -ml-0.5",
          imagesLoaded ? 'opacity-100' : 'opacity-0'
        )}
        style={{ left: `${sliderPosition}%` }}
      >
        <div className="w-8 h-8 rounded-full bg-surface shadow-md border border-border flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
      
      {/* Labels */}
      <div className={clsx("absolute top-4 left-4 z-20 pointer-events-none transition-opacity duration-300", imagesLoaded ? 'opacity-100' : 'opacity-0')}>
        <span className="bg-black/60 backdrop-blur-sm text-white px-2 py-1 text-[10px] uppercase tracking-widest font-mono rounded-sm">{t('before')}</span>
      </div>
      <div className={clsx("absolute top-4 right-4 z-20 pointer-events-none transition-opacity duration-300", imagesLoaded ? 'opacity-100' : 'opacity-0')}>
        <span className="bg-black/60 backdrop-blur-sm text-white px-2 py-1 text-[10px] uppercase tracking-widest font-mono rounded-sm">{t('after')}</span>
      </div>
    </div>
  );
}
