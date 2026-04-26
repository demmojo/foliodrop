import React, { useState, useRef } from 'react';
import { useJobStore } from '@/store/useJobStore';
import { ImageOff } from 'lucide-react';

export const AgencySettings: React.FC = () => {
  const { styleProfiles, uploadStyleProfile, uploadTrainingPair, fetchStyleProfiles, deleteStyleProfile } = useJobStore();
  
  const [isUploadingStyle, setIsUploadingStyle] = useState(false);
  const [isUploadingTraining, setIsUploadingTraining] = useState(false);
  const [isDeletingStyle, setIsDeletingStyle] = useState<string | null>(null);
  const [failedThumbIds, setFailedThumbIds] = useState<Record<string, true>>({});
  const [retriedThumbIds, setRetriedThumbIds] = useState<Record<string, true>>({});
  
  const styleInputRef = useRef<HTMLInputElement>(null);
  
  React.useEffect(() => {
    fetchStyleProfiles();
  }, [fetchStyleProfiles]);

  // For training pairs
  const [trainingBrackets, setTrainingBrackets] = useState<File[]>([]);
  const [trainingFinalEdit, setTrainingFinalEdit] = useState<File | null>(null);

  const handleThumbError = async (profileId: string) => {
    if (retriedThumbIds[profileId]) {
      setFailedThumbIds((prev) => ({ ...prev, [profileId]: true }));
      return;
    }

    setRetriedThumbIds((prev) => ({ ...prev, [profileId]: true }));
    await fetchStyleProfiles();
  };

  const handleStyleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setIsUploadingStyle(true);
      await uploadStyleProfile(e.target.files[0]);
      setIsUploadingStyle(false);
      if (styleInputRef.current) styleInputRef.current.value = '';
    }
  };

  const handleTrainingSubmit = async () => {
    if (trainingBrackets.length > 0 && trainingFinalEdit) {
      setIsUploadingTraining(true);
      await uploadTrainingPair(trainingBrackets, trainingFinalEdit);
      setTrainingBrackets([]);
      setTrainingFinalEdit(null);
      setIsUploadingTraining(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-6 max-w-2xl mx-auto w-full space-y-8 shadow-sm">
      <div>
        <h2 className="text-xl font-bold tracking-tight mb-2 text-foreground">Agency Settings</h2>
        <p className="text-sm text-muted mb-6">
          Configure global style profiles and upload explicit training pairs for personalized style training.
        </p>
      </div>

      {/* Style Profile Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted">Style Profiles</h3>
        
        {styleProfiles.length > 0 ? (
          <ul className="space-y-2 mb-4">
            {styleProfiles.map(profile => (
              <li key={profile.id} className="flex items-center justify-between p-3 bg-background rounded-md text-sm border border-border/50 group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 shrink-0 rounded-md border border-border/50 bg-muted/20 overflow-hidden flex items-center justify-center">
                    {profile.url && !failedThumbIds[profile.id] ? (
                      <img
                        src={profile.url}
                        alt={`${profile.name} style profile preview`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onError={() => {
                          void handleThumbError(profile.id);
                        }}
                      />
                    ) : (
                      <ImageOff className="w-4 h-4 text-muted" aria-hidden="true" />
                    )}
                  </div>
                  <span className="font-medium text-foreground truncate">{profile.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted">
                    {new Date(profile.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={async () => {
                      setIsDeletingStyle(profile.id);
                      await deleteStyleProfile(profile.id);
                      setIsDeletingStyle(null);
                    }}
                    disabled={isDeletingStyle === profile.id}
                    className="text-xs text-red-500/80 hover:text-red-600 opacity-70 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                  >
                    {isDeletingStyle === profile.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted italic mb-4">No style profiles uploaded yet.</p>
        )}

        <div>
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={styleInputRef}
            onChange={handleStyleUpload}
          />
          <button 
            onClick={() => styleInputRef.current?.click()}
            disabled={isUploadingStyle}
            className="px-4 py-2 bg-foreground text-background rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isUploadingStyle ? 'Uploading...' : 'Upload Style Profile'}
          </button>
        </div>
      </section>

      <hr className="border-border" />

      {/* Explicit Training Pairs Section */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted">Upload Training Pair</h3>
        <p className="text-xs text-muted mb-4">
          Provide raw brackets and the final manual edit to teach the system your preferred style.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 border border-dashed border-border hover:border-foreground/30 transition-colors rounded-md text-center">
            <label className="block cursor-pointer">
              <span className="text-sm font-medium text-foreground block mb-1">Raw Brackets</span>
              <span className="text-xs text-muted block mb-3">Select multiple exposure brackets</span>
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    setTrainingBrackets(Array.from(e.target.files));
                  }
                }}
              />
              <div className="px-3 py-1.5 bg-background border border-border/50 rounded text-xs font-medium inline-block hover:bg-muted/10 transition-colors text-foreground">
                Select Files ({trainingBrackets.length} selected)
              </div>
            </label>
          </div>

          <div className="p-4 border border-dashed border-border hover:border-foreground/30 transition-colors rounded-md text-center">
            <label className="block cursor-pointer">
              <span className="text-sm font-medium text-foreground block mb-1">Final Edit</span>
              <span className="text-xs text-muted block mb-3">Your manually edited HDR image</span>
              <input 
                type="file" 
                accept="image/*" 
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setTrainingFinalEdit(e.target.files[0]);
                  }
                }}
              />
              <div className="px-3 py-1.5 bg-background border border-border/50 rounded text-xs font-medium inline-block hover:bg-muted/10 transition-colors text-foreground">
                Select File {trainingFinalEdit ? `(${trainingFinalEdit.name})` : ''}
              </div>
            </label>
          </div>
        </div>

        <div className="pt-2">
          <button 
            onClick={handleTrainingSubmit}
            disabled={isUploadingTraining || trainingBrackets.length === 0 || !trainingFinalEdit}
            className="w-full px-4 py-2 bg-foreground text-background rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isUploadingTraining ? 'Uploading...' : 'Submit Training Pair'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default AgencySettings;
