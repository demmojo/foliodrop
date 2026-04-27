import { auth } from '@/lib/firebase';

const LOCAL_ANON_ID_KEY = 'folio_local_anon_id';

export const getLocalAnonAgencyId = (): string => {
  if (typeof window === 'undefined') return 'anon_server';
  const existing = window.localStorage.getItem(LOCAL_ANON_ID_KEY);
  if (existing) return existing;
  const generated = `anon_${Math.random().toString(36).slice(2, 12)}`;
  window.localStorage.setItem(LOCAL_ANON_ID_KEY, generated);
  return generated;
};

interface HeaderOptions {
  includeContentTypeJson?: boolean;
}

export const getScopedAuthHeaders = async (options?: HeaderOptions): Promise<Record<string, string>> => {
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
  const headers: Record<string, string> = {};

  if (options?.includeContentTypeJson) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  // Unauthenticated users are isolated by a local anonymous namespace.
  headers['x-agency-id'] = getLocalAnonAgencyId();
  return headers;
};
