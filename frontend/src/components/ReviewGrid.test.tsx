import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewGrid from './ReviewGrid';

describe('ReviewGrid Component', () => {
  const mockPhotos = [
    { id: '1', url: '1.jpg', listingGroupId: 'group-1', captureTime: '2026-01-01T12:00:00Z', roomName: 'Kitchen' },
    { id: '2', url: '2.jpg', listingGroupId: 'group-1', captureTime: '2026-01-01T12:05:00Z', roomName: 'Living Room' },
    { id: '3', url: '3.jpg', listingGroupId: 'group-1', captureTime: '2026-01-01T14:00:00Z', roomName: 'Bedroom' }
  ];

  it('renders all photos in one listing initially', () => {
    render(<ReviewGrid initialPhotos={mockPhotos} />);
    expect(screen.getByText('Property')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.queryByText('02')).not.toBeInTheDocument();
    
    // Check if rooms are displayed
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Living Room')).toBeInTheDocument();
    expect(screen.getByText('Bedroom')).toBeInTheDocument();
  });
});