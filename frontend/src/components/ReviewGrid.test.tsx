import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewGrid from './ReviewGrid';
import { ProcessedHDR } from '../store/useJobStore';

describe('ReviewGrid Component', () => {
  const mockPhotos: ProcessedHDR[] = [
    { id: '1', url: '1.jpg', thumbUrl: '1.jpg', originalUrl: '1_orig.jpg', roomName: 'Kitchen', status: 'READY', isFlagged: false },
    { id: '2', url: '2.jpg', thumbUrl: '2.jpg', originalUrl: '2_orig.jpg', roomName: 'Living Room', status: 'NEEDS_REVIEW', isFlagged: false },
    { id: '3', url: '3.jpg', thumbUrl: '3.jpg', originalUrl: '3_orig.jpg', roomName: 'Bedroom', status: 'READY', isFlagged: false }
  ];

  it('renders all photos', () => {
    const onConfirmMock = vi.fn();
    render(<ReviewGrid photos={mockPhotos} onConfirm={onConfirmMock} />);
    
    // Check if rooms are displayed
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Living Room')).toBeInTheDocument();
    expect(screen.getByText('Bedroom')).toBeInTheDocument();
  });
});