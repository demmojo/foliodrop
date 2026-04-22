import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReviewGrid from './ReviewGrid';
import { ProcessedHDR } from '../store/useJobStore';

// Mock BeforeAfterSlider
vi.mock('./BeforeAfterSlider', () => ({
  default: () => <div data-testid="mock-before-after-slider">Slider</div>
}));

describe('ReviewGrid Component', () => {
  const mockPhotos: ProcessedHDR[] = [
    { id: '1', url: '1.jpg', thumbUrl: '1.jpg', originalUrl: '1_orig.jpg', roomName: 'Kitchen', status: 'READY', isFlagged: false },
    { id: '2', url: '2.jpg', thumbUrl: '2.jpg', originalUrl: '2_orig.jpg', roomName: 'Living Room', status: 'NEEDS_REVIEW', isFlagged: false, vlmReport: { window_score: 'Bad', reason: 'Too bright' } },
    { id: '3', url: '3.jpg', thumbUrl: '3.jpg', originalUrl: '3_orig.jpg', roomName: 'Bedroom', status: 'READY', isFlagged: false }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all photos correctly into queue and grid', () => {
    const onConfirmMock = vi.fn();
    render(<ReviewGrid photos={mockPhotos} onConfirm={onConfirmMock} />);
    
    // In queue
    expect(screen.getByText('Living Room')).toBeInTheDocument();
    
    // In grid
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Bedroom')).toBeInTheDocument();
  });

  it('handles action callbacks for queue items', () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    const onOverride = vi.fn();

    render(
      <ReviewGrid 
        photos={mockPhotos} 
        onConfirm={vi.fn()} 
        onKeepItem={onKeep}
        onDiscardItem={onDiscard}
        onOverrideWithManualEdit={onOverride}
      />
    );

    // Keep button
    const keepBtn = screen.getByText('✓ Keep');
    fireEvent.click(keepBtn);
    expect(onKeep).toHaveBeenCalledWith('2');

    // Discard button
    const discardBtn = screen.getByText('🗑️ Drop');
    fireEvent.click(discardBtn);
    expect(onDiscard).toHaveBeenCalledWith('2');

    // Override input
    const inputs = document.querySelectorAll('input[type="file"]');
    const input = inputs[0] as HTMLInputElement;
    const file = new File([''], 'test.jpg');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onOverride).toHaveBeenCalledWith('2', file);
  });

  it('can open and close the loupe modal', () => {
    render(<ReviewGrid photos={mockPhotos} onConfirm={vi.fn()} />);

    // Click on image container to open loupe
    const imageContainer = screen.getByText('Inspect').closest('div')?.parentElement;
    if (imageContainer) {
      fireEvent.click(imageContainer);
    }

    expect(screen.getByTestId('mock-before-after-slider')).toBeInTheDocument();

    // Close loupe
    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('mock-before-after-slider')).not.toBeInTheDocument();
  });

  it('loupe modal actions trigger callbacks and close modal', () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    const onOverride = vi.fn();

    render(
      <ReviewGrid 
        photos={mockPhotos} 
        onConfirm={vi.fn()} 
        onKeepItem={onKeep}
        onDiscardItem={onDiscard}
        onOverrideWithManualEdit={onOverride}
      />
    );

    // Open loupe
    const imageContainer = screen.getByText('Inspect').closest('div')?.parentElement;
    fireEvent.click(imageContainer!);

    // Keep
    const keepBtns = screen.getAllByRole('button', { name: /Keep/i });
    fireEvent.click(keepBtns[1]); // The one in the modal
    expect(onKeep).toHaveBeenCalledWith('2');
    expect(screen.queryByTestId('mock-before-after-slider')).not.toBeInTheDocument();

    // Re-open
    fireEvent.click(imageContainer!);
    const discardBtns = screen.getAllByRole('button', { name: /Drop/i }).concat(screen.getAllByRole('button', { name: /Discard/i }));
    fireEvent.click(discardBtns[discardBtns.length - 1]); // The one in the modal
    expect(onDiscard).toHaveBeenCalledWith('2');
    expect(screen.queryByTestId('mock-before-after-slider')).not.toBeInTheDocument();
  });

  it('triggers onConfirm when Export Batch is clicked', () => {
    const onConfirmMock = vi.fn();
    render(<ReviewGrid photos={mockPhotos} onConfirm={onConfirmMock} />);
    
    const exportBtn = screen.getByText('Export Batch');
    fireEvent.click(exportBtn);
    
    expect(onConfirmMock).toHaveBeenCalled();
  });

  it('renders VLM report details when available', () => {
    render(<ReviewGrid photos={mockPhotos} onConfirm={vi.fn()} />);
    expect(screen.getByText(/Too bright/)).toBeInTheDocument();
    expect(screen.getByText(/⚠️ QA Note/)).toBeInTheDocument();
  });
});