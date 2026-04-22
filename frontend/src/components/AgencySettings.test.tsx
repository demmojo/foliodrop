import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AgencySettings } from './AgencySettings';
import { useJobStore } from '../store/useJobStore';

describe('AgencySettings Component', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });
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
});