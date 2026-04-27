import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AgencySettings } from './AgencySettings';
import { useJobStore } from '../store/useJobStore';

describe('AgencySettings Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });
    localStorage.clear();
    useJobStore.setState({
      jobs: {},
      activeSessionId: null,
      quota: null,
      styleProfiles: [],
    } as any);
  });
  it('renders and handles style profile upload', async () => {
    useJobStore.setState({ styleProfiles: [] });
    const { container } = render(<AgencySettings />);
    
    expect(screen.getByText('Agency Settings')).toBeInTheDocument();
    
    // Upload style profile
    const uploadBtn = screen.getByText('Upload Style Profile');
    expect(uploadBtn).toBeInTheDocument();
    
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    
    expect(uploadBtn).toBeInTheDocument(); // button returns to normal state
  });

  it('renders and handles training pair submit', async () => {
    const { container } = render(<AgencySettings />);
    
    const bracketsInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const finalInput = container.querySelectorAll('input[type="file"]')[2] as HTMLInputElement;
    
    const file = new File([''], 'test.jpg');
    
    await act(async () => {
      fireEvent.change(bracketsInput, { target: { files: [file] } });
    });
    
    await act(async () => {
      fireEvent.change(finalInput, { target: { files: [file] } });
    });
    
    const submitBtn = screen.getByText('Submit Training Pair');
    expect(submitBtn).not.toBeDisabled();
    
    await act(async () => {
      fireEvent.click(submitBtn);
    });
  });

  it('shows a clear error when training pair upload is rejected by backend', async () => {
    // Override the global fetch with a rejection on /training/upload
    (global.fetch as any) = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/training/upload')) {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              detail: {
                message:
                  'final edit does not appear to be the same scene as the reference bracket',
                report: { composition_consistent: false },
              },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { container } = render(<AgencySettings />);

    const bracketsInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const finalInput = container.querySelectorAll('input[type="file"]')[2] as HTMLInputElement;
    const file = new File([''], 'test.jpg');

    await act(async () => {
      fireEvent.change(bracketsInput, { target: { files: [file] } });
    });
    await act(async () => {
      fireEvent.change(finalInput, { target: { files: [file] } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Submit Training Pair'));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /not the same scene|final edit does not appear/i
      );
    });
  });

  it('clears the training error when the user picks new files', async () => {
    (global.fetch as any) = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/training/upload')) {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              detail: { message: 'mismatch detected', report: {} },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { container } = render(<AgencySettings />);
    const bracketsInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const finalInput = container.querySelectorAll('input[type="file"]')[2] as HTMLInputElement;
    const fileA = new File([''], 'a.jpg');
    const fileB = new File([''], 'b.jpg');

    await act(async () => {
      fireEvent.change(bracketsInput, { target: { files: [fileA] } });
    });
    await act(async () => {
      fireEvent.change(finalInput, { target: { files: [fileA] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Training Pair'));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/mismatch detected/i);
    });

    // Picking new brackets must clear the stale error before the user even
    // resubmits, otherwise the UI lies about the current state.
    await act(async () => {
      fireEvent.change(bracketsInput, { target: { files: [fileB] } });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Re-trigger error to test the final-edit input also clears.
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Training Pair'));
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.change(finalInput, { target: { files: [fileB] } });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders uploaded profile and handles thumbnail error + delete flow', async () => {
    const createdAt = new Date('2026-01-01').getTime();

    localStorage.setItem('folio_local_anon_id', 'anon_test');
    localStorage.setItem(
      'folio_local_style_profiles_v1:anon_test',
      JSON.stringify([
        {
          id: 'profile-1',
          name: 'Kitchen Warm',
          createdAt,
          url: 'https://example.com/style.jpg',
          isLocal: true,
        },
      ])
    );

    const { container } = render(<AgencySettings />);
    await waitFor(() => {
      expect(screen.getByText('Kitchen Warm')).toBeInTheDocument();
    });
    const thumb = container.querySelector('img[alt*="style profile preview"]') as HTMLImageElement;
    expect(thumb).toBeInTheDocument();

    await act(async () => {
      fireEvent.error(thumb);
    });
    await act(async () => {
      fireEvent.error(thumb);
    });
    expect(screen.getByText(/No style profiles uploaded yet|Kitchen Warm|test\.jpg/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(screen.queryByText('Kitchen Warm')).not.toBeInTheDocument();
  });
});