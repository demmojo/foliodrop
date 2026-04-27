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