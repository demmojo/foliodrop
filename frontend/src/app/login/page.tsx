"use client";

import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, appleProvider } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [error, setError] = useState('');
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const router = useRouter();

  const handleGoogleLogin = async () => {
    if (!auth) {
      setError("Firebase not configured");
      return;
    }
    
    setLoadingGoogle(true);
    setError('');
    
    try {
      await signInWithPopup(auth, googleProvider);
      router.push('/');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to login with Google');
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleAppleLogin = async () => {
    if (!auth) {
      setError("Firebase not configured");
      return;
    }
    
    setLoadingApple(true);
    setError('');
    
    try {
      await signInWithPopup(auth, appleProvider);
      router.push('/');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to login with Apple');
    } finally {
      setLoadingApple(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="max-w-md w-full p-8 bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">Agency Login</h2>
          <p className="text-zinc-400 text-sm text-center">Sign in to access your self-trained Folio HDR processing</p>
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center">
            {error}
          </div>
        )}
        
        <div className="space-y-3">
          <button 
            onClick={handleGoogleLogin}
            disabled={loadingGoogle || loadingApple}
            className="w-full flex items-center justify-center gap-3 bg-white text-zinc-900 hover:bg-zinc-100 font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingGoogle ? (
              <span className="animate-pulse">Connecting...</span>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
              </>
            )}
          </button>
          
          <button 
            onClick={handleAppleLogin}
            disabled={loadingGoogle || loadingApple}
            className="w-full flex items-center justify-center gap-3 bg-black border border-zinc-700 text-white hover:bg-zinc-900 font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingApple ? (
              <span className="animate-pulse">Connecting...</span>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.04 2.26-.79 3.59-.79 2.11 0 3.63.85 4.54 2.22-3.8 1.88-2.92 6.54.91 8.01-.84 1.34-1.8 2.51-4.12 2.73zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                Continue with Apple
              </>
            )}
          </button>
        </div>
        
        <p className="mt-8 text-center text-xs text-zinc-500">
          Your agency style profiles are securely isolated.
        </p>
      </div>
    </div>
  );
}