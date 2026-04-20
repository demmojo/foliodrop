'use client';

import { useEffect, useRef } from 'react';
import { useImageStore } from '@/store/useImageStore';

export default function WebGLCanvas() {
  const glRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;

    // Initialize WebGL2 with display-p3
    let gl: WebGL2RenderingContext | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gl = canvas.getContext('webgl2', { colorSpace: 'display-p3' } as any) as WebGL2RenderingContext;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      console.warn('display-p3 not supported, falling back to srgb');
      gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    }

    if (!gl) return;

    // Setup basic WebGL (stub for actual HDR shader)
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const unsubscribe = useImageStore.subscribe((state) => {
      // In a real implementation, we would update uniforms here
      // e.g. gl.uniform1f(exposureLocation, state.exposure);
      console.log('Transient state update for WebGL:', state);
    });

    return () => {
      unsubscribe();
      // Explicitly lose context to prevent browser exhaustion
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };
  }, []);

  return (
    <canvas 
      ref={glRef} 
      width={800} 
      height={600} 
      className="w-full h-auto bg-black rounded-lg shadow-2xl"
    />
  );
}
