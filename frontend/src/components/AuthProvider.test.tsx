import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null }
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
}));

const TestComponent = () => {
  const { user, loading, getToken } = useAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="user">{user ? (user as any).email : 'null'}</div>
      <button data-testid="token-btn" onClick={async () => {
        const t = await getToken();
        document.getElementById('token-result')!.textContent = t || 'null';
      }}>Get Token</button>
      <div id="token-result"></div>
    </div>
  );
};

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides auth state and handles user change', async () => {
    let callback: any;
    (onAuthStateChanged as any).mockImplementation((_auth: any, cb: any) => {
      callback = cb;
      return () => {}; // unsubscribe function
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Initial state is loading=true because callback hasn't run
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('null');

    // Simulate auth state change
    await act(async () => {
      callback({ 
        email: 'test@example.com',
        getIdToken: async () => 'test-token'
      } as any);
    });

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('test@example.com');
    
    await act(async () => {
      screen.getByTestId('token-btn').click();
    });
    
    // allow tick for promise
    await new Promise(r => setTimeout(r, 0));
    
    expect(document.getElementById('token-result')?.textContent).toBe('test-token');
  });
  
  it('handles token error', async () => {
    let callback: any;
    (onAuthStateChanged as any).mockImplementation((_auth: any, cb: any) => {
      callback = cb;
      return () => {}; 
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await act(async () => {
      callback({ 
        email: 'test@example.com',
        getIdToken: async () => { throw new Error('fail'); }
      } as any);
    });
    
    await act(async () => {
      screen.getByTestId('token-btn').click();
    });
    
    await new Promise(r => setTimeout(r, 0));
    
    expect(document.getElementById('token-result')?.textContent).toBe('null');
  });
});
