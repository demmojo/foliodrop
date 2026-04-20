import React, { useState, useEffect } from 'react';
import { Sparkles, WifiOff, AlertCircle, Check, Plus, Loader2, X, FolderInput } from 'lucide-react';

export default function SmartSaveSheet({ 
  isOpen, 
  onClose, 
  itemTitle = "Modern Kitchen Layout.jpg" 
}: {
  isOpen: boolean;
  onClose: () => void;
  itemTitle?: string;
}) {
  const [isOffline, setIsOffline] = useState(false);
  const [aiState, setAiState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success'>('idle');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState("");

  // Simulate network detection and Gemini API call
  useEffect(() => {
    if (!isOpen) return;
    
    // Reset states on open
    setAiState('loading');
    setSaveState('idle');
    setSelectedTag(null);
    setCustomTag("");

    // Simulate checking network
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
      return;
    }

    // Simulate Gemini processing time
    const timer = setTimeout(() => {
      // 10% chance to simulate an AI error for testing
      if (Math.random() > 0.9) {
        setAiState('error');
      } else {
        setAiState('ready');
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleSave = async (tag: string) => {
    if (!tag.trim()) return;
    
    setSelectedTag(tag);
    setSaveState('saving');
    
    // Simulate save API call
    await new Promise(resolve => setTimeout(resolve, 800));
    setSaveState('success');
    
    // Auto-close after success
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={saveState === 'saving' ? undefined : onClose}
      />

      {/* Bottom Sheet */}
      <div className="relative w-full bg-surface rounded-t-3xl shadow-2xl p-6 pb-8 transform transition-transform duration-300 ease-out">
        
        {/* Header & Context */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Saving to workspace</p>
            <h3 className="text-lg font-semibold text-foreground line-clamp-1">
              {itemTitle}
            </h3>
          </div>
          <button 
            onClick={onClose}
            disabled={saveState === 'saving'}
            className="p-2 -mr-2 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success State Takeover */}
        {saveState === 'success' ? (
          <div className="py-8 flex flex-col items-center justify-center animate-in fade-in duration-300">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-foreground font-medium">Saved to {selectedTag}</p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Suggestion Area */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                {isOffline ? (
                  <WifiOff className="w-4 h-4 text-gray-400" />
                ) : aiState === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                ) : (
                  <Sparkles className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-sm font-medium text-gray-700">
                  {isOffline ? 'Offline Mode' 
                    : aiState === 'error' ? 'Suggestions unavailable' 
                    : 'Suggested Folders'}
                </span>
              </div>

              {/* State: Offline / Error Fallback */}
              {(isOffline || aiState === 'error') && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-sm text-gray-600 mb-3">
                    {isOffline 
                      ? "You're offline. Save locally to your default folder or create a new one." 
                      : "We couldn't generate suggestions right now."}
                  </p>
                  <button 
                    onClick={() => handleSave("Default Folder")}
                    className="w-full py-2.5 px-4 bg-surface border border-border rounded-lg text-sm font-medium text-foreground hover:bg-background flex items-center justify-center gap-2"
                  >
                    <FolderInput className="w-4 h-4 text-gray-500" />
                    Save to Default Folder
                  </button>
                </div>
              )}

              {/* State: Loading Skeletons */}
              {!isOffline && aiState === 'loading' && (
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3].map((i) => (
                    <div 
                      key={i} 
                      className="h-10 w-24 bg-gray-100 rounded-lg animate-pulse" 
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              )}

              {/* State: AI Suggestions Ready */}
              {!isOffline && aiState === 'ready' && (
                <div className="flex flex-wrap gap-2">
                  {['Kitchen', 'Primary Bath', 'Lighting Fixtures'].map((tag) => {
                    const isSavingThis = saveState === 'saving' && selectedTag === tag;
                    const isDisabled = saveState === 'saving' && selectedTag !== tag;
                    
                    return (
                      <button
                        key={tag}
                        onClick={() => handleSave(tag)}
                        disabled={saveState === 'saving'}
                        className={`
                          relative h-10 px-4 rounded-lg text-sm font-medium transition-all active:scale-95
                          ${isSavingThis 
                            ? 'bg-gray-900 text-transparent' // Hide text to show spinner
                            : 'bg-gray-100 text-foreground hover:bg-gray-200'}
                          ${isDisabled ? 'opacity-40 cursor-not-allowed active:scale-100' : ''}
                        `}
                      >
                        {tag}
                        {isSavingThis && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Escape Hatch: Manual Entry */}
            <div className="pt-4 border-t border-gray-100">
              <label htmlFor="custom-tag" className="sr-only">Create custom folder</label>
              <div className="flex gap-2">
                <input
                  id="custom-tag"
                  type="text"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  placeholder="Or create a new folder..."
                  disabled={saveState === 'saving'}
                  className="flex-1 bg-gray-50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 disabled:opacity-50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave(customTag);
                  }}
                />
                <button
                  onClick={() => handleSave(customTag)}
                  disabled={!customTag.trim() || saveState === 'saving'}
                  className="px-4 py-2.5 bg-surface border border-border rounded-lg text-foreground hover:bg-background disabled:opacity-50 flex items-center justify-center transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}