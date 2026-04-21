import React, { useState } from 'react';
import clsx from 'clsx';

interface ParameterSliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  ghostValue?: number; // The VLM's original hallucinated value (if any)
  onChange?: (val: number) => void;
}

export default function ParameterSlider({ label, min, max, value, ghostValue, onChange }: ParameterSliderProps) {
  // Convert value to percentage for CSS
  const getPercent = (val: number) => {
    return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  };

  const currentPercent = getPercent(value);
  const ghostPercent = ghostValue !== undefined ? getPercent(ghostValue) : undefined;
  
  // We consider it hallucinated if the ghost value was outside our min/max bounds,
  // or if it was explicitly different. Pydantic drops it if it's out of bounds,
  // but if we extract it from telemetry we can see what it tried to do.
  const isHallucinated = ghostValue !== undefined && Math.abs(ghostValue - value) > 0.01;

  return (
    <div className="flex flex-col gap-1 w-full mb-3">
      <div className="flex justify-between items-center text-[9px] font-mono uppercase tracking-widest text-zinc-400 mb-1">
        <span>{label}</span>
        <span className={clsx(isHallucinated ? "text-red-400" : "text-zinc-300")}>
          {value.toFixed(2)}
        </span>
      </div>
      <div className="relative h-6 flex items-center group">
        <div className="absolute w-full h-1 bg-[#404040] rounded-sm overflow-hidden">
           <div 
             className="h-full bg-accent/50"
             style={{ width: `${currentPercent}%` }}
           />
        </div>
        
        {/* Ghost Marker (The hallucination) */}
        {ghostPercent !== undefined && isHallucinated && (
          <div 
            className="absolute w-0.5 h-3 bg-red-500/70 -ml-[1px] pointer-events-none z-0"
            style={{ left: `${ghostPercent}%` }}
            title={`VLM original value: ${ghostValue}`}
          />
        )}

        {/* Real Handle */}
        <input 
          type="range"
          min={min}
          max={max}
          step={0.01}
          value={value}
          onChange={(e) => onChange && onChange(parseFloat(e.target.value))}
          className="absolute w-full h-full opacity-0 cursor-pointer z-10"
        />
        
        {/* Visual Handle */}
        <div 
          className="absolute w-1.5 h-3.5 bg-zinc-300 rounded-[1px] shadow-sm -ml-[3px] pointer-events-none z-10 group-hover:bg-white transition-colors"
          style={{ left: `${currentPercent}%` }}
        />
      </div>
    </div>
  );
}
