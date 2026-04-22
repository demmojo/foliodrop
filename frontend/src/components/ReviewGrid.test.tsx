import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReviewGrid from './ReviewGrid';
import { ProcessedHDR } from '../store/useJobStore';

// Mock BeforeAfterSlider
vi.mock('./BeforeAfterSlider', () => ({
  default: () => <div data-testid="mock-before-after-slider">Slider</div>
}));

describe('ReviewGrid Component', () => {
  const mockPhotos: ProcessedHDR[] = [
    { id: '1', url: 'http://example.com/1.jpg', thumbUrl: 'http://example.com/1.jpg', originalUrl: 'http://example.com/1_orig.jpg', roomName: 'Kitchen', status: 'READY', isFlagged: false },
    { id: '2', url: 'http://example.com/2.jpg', thumbUrl: 'http://example.com/2.jpg', originalUrl: 'http://example.com/2_orig.jpg', roomName: 'Living Room', status: 'NEEDS_REVIEW', isFlagged: false, vlmReport: { window_score: 'Bad', reason: 'Too bright' } },
    { id: '3', url: 'http://example.com/3.jpg', thumbUrl: 'http://example.com/3.jpg', originalUrl: 'http://example.com/3_orig.jpg', roomName: 'Bedroom', status: 'READY', isFlagged: false },
    { id: '4', url: 'http://example.com/4.jpg', thumbUrl: 'http://example.com/4.jpg', originalUrl: 'http://example.com/4_orig.jpg', roomName: '', status: 'READY', isFlagged: false }, // empty room name
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles image error by refreshing the src via fetch', async () => {
    // Re-render with realistic URL to hit the `URL(originalUrl)` branch
    const mockPhotosUrl: ProcessedHDR[] = [
      { id: '1', url: 'http://example.com/1.jpg', thumbUrl: 'http://example.com/1.jpg', originalUrl: 'http://example.com/1_orig.jpg', roomName: 'Kitchen', status: 'READY', isFlagged: false },
    ];
    
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ urls: [{ url: 'http://new.example.com/1.jpg' }] })
    });
    global.fetch = mockFetch;

    render(<ReviewGrid photos={mockPhotosUrl} onConfirm={vi.fn()} />);
    
    const img = screen.getAllByRole('img')[0];
    
    // Trigger error event
    await act(async () => {
      fireEvent.error(img);
    });
    
    expect(mockFetch).toHaveBeenCalled();
    // Also, trigger error again to verify it returns early (dataset.retried = true branch)
    await act(async () => {
      fireEvent.error(img);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  
  it('handles image error with invalid URL gracefully', async () => {
    // Override fetch to succeed for the fallback mechanism
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ urls: [{ url: 'http://test.com/new-valid.jpg' }] })
    });
    global.fetch = mockFetch;

    // We need to make sure the photo we are erroring on has an invalid originalUrl
    // that starts with http to pass the first check but fail URL parsing.
    // A string like "http://[" is an invalid URL in JS.
    const badUrlPhoto: ProcessedHDR = {
      ...mockPhotos[0],
      originalUrl: 'http://['
    };

    // Use a unique room name to find the image easily
    const uniqueRoomPhoto = { ...badUrlPhoto, roomName: 'Bad URL Room' };

    render(<ReviewGrid photos={[uniqueRoomPhoto]} onConfirm={vi.fn()} />);

    // The image should be in the cargo grid (status READY)
    const badImage = screen.getByAltText('Bad URL Room') as HTMLImageElement;

    // Trigger error on an image where originalUrl is NOT a valid full URL string
    // This will force the new URL() to throw and hit the catch block.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      fireEvent.error(badImage);
    });

    // The fetch should still have been called (fallback behavior)
    expect(mockFetch).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles image error fetch failures gracefully', async () => {
    // Render with realistic URL to hit the `URL(originalUrl)` branch
    const mockPhotosUrl: ProcessedHDR[] = [
      { id: '1', url: 'http://example.com/1.jpg', thumbUrl: 'http://example.com/1.jpg', originalUrl: 'http://example.com/1_orig.jpg', roomName: 'Kitchen', status: 'READY', isFlagged: false },
    ];
    
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network Error"));
    global.fetch = mockFetch;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<ReviewGrid photos={mockPhotosUrl} onConfirm={vi.fn()} />);
    
    const img = screen.getAllByRole('img')[0];
    
    // Trigger error event
    await act(async () => {
      fireEvent.error(img);
    });
    
    expect(consoleSpy).toHaveBeenCalledWith("Failed to refresh signed URL", expect.any(Error));
    consoleSpy.mockRestore();
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
    
    // Test that override handles empty files list (user cancelled dialog)
    fireEvent.change(input, { target: { files: null } });
    // Expect the call count to remain the same (1)
    expect(onOverride).toHaveBeenCalledTimes(1);
    
    // Also test with empty FileList object equivalent
    fireEvent.change(input, { target: { files: [] } });
    expect(onOverride).toHaveBeenCalledTimes(1);
  });

  it('shows loupe view when image is clicked and closes it', () => {
    const { container } = render(<ReviewGrid photos={mockPhotos} onConfirm={vi.fn()} />);
    
    // There are multiple images, click the first one in the Needs Review queue
    const queueImages = container.querySelectorAll('.w-full.aspect-\\[3\\/2\\]');
    fireEvent.click(queueImages[0]);
    
    // Loupe should appear (it's fixed positioned with a close button containing &times;)
    const closeBtn = screen.getByText('×');
    expect(closeBtn).toBeInTheDocument();
    
    // Close the loupe
    fireEvent.click(closeBtn);
    expect(screen.queryByText('×')).not.toBeInTheDocument();
  });

  it('loupe modal actions trigger callbacks and do not close modal for keep', () => {
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
    const inspectSpans = screen.getAllByText('Inspect');
    const imageContainer = inspectSpans[0].closest('div')?.parentElement;
    fireEvent.click(imageContainer!);

    // Keep
    const keepBtns = screen.getAllByRole('button', { name: /Keep/i });
    fireEvent.click(keepBtns[1]); // The one in the modal
    expect(onKeep).toHaveBeenCalledWith('2');
    // Expect the modal to still be open since we allow updating choice
    expect(screen.queryByTestId('mock-before-after-slider')).toBeInTheDocument();

    // Discard (which does close the modal)
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

  it('displays empty states when applicable', () => {
    render(<ReviewGrid photos={[]} onConfirm={vi.fn()} />);
    expect(screen.getByText('Ready for Export')).toBeInTheDocument();
  });

  it('renders loading placeholder when url is missing', () => {
    const photosWithoutUrl: ProcessedHDR[] = [
      { id: '1', url: '', thumbUrl: '', roomName: 'Loading Room', status: 'NEEDS_REVIEW', isFlagged: false }
    ];
    render(<ReviewGrid photos={photosWithoutUrl} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('loading-placeholder')).toBeInTheDocument();
  });

  it('renders "All images require review" message when cargo grid is empty and queue is not', () => {
    const onlyReviewPhotos: ProcessedHDR[] = [
      { id: '1', url: 'http://test.com/1.jpg', thumbUrl: 'http://test.com/t1.jpg', roomName: 'Review 1', status: 'NEEDS_REVIEW', isFlagged: false },
      { id: '2', url: 'http://test.com/2.jpg', thumbUrl: 'http://test.com/t2.jpg', roomName: 'Review 2', status: 'FLAGGED', isFlagged: true }
    ];
    render(<ReviewGrid photos={onlyReviewPhotos} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('review-all-msg')).toBeInTheDocument();
  });

  it('handles image error with unparseable http URL', async () => {
    const invalidUrlPhotos: ProcessedHDR[] = [
      { id: '1', url: 'http://[invalid-url', thumbUrl: 'http://[invalid-url', roomName: 'Test Room', status: 'READY', isFlagged: false }
    ];
    render(<ReviewGrid photos={invalidUrlPhotos} onConfirm={vi.fn()} />);

    const img = screen.getByAltText('Test Room');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      fireEvent.error(img);
    });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse originalUrl as URL"), expect.any(TypeError));
    consoleSpy.mockRestore();
  });
});