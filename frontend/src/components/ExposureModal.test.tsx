import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExposureModal from './ExposureModal';

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key === 'close' ? '' : key })
}));

vi.mock('./BeforeAfterSlider', () => ({
  default: () => <div data-testid="mock-before-after-slider">Slider</div>
}));

vi.mock('./ParameterSlider', () => ({
  default: ({ label }: any) => <div data-testid={`slider-${label}`}>{label}</div>
}));

describe('ExposureModal Component', () => {
  const mockPhoto = {
    id: 'photo1',
    url: 'test.jpg',
    originalUrl: 'orig.jpg',
    captureTime: '2023-01-01T12:00:00Z',
    roomName: 'Living Room',
    parameters: { 
      exposure_ev: 1,
      contrast_intensity: 10,
      contrast_midpoint: 40,
      warmth: 1.2,
      tint: 1.1,
      sharpness: 1,
      rotation_degrees: 5,
      barrel_distortion: 0.05
    },
    telemetry: [{ raw_output: { exposure_ev: 0.5 } }]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<ExposureModal isOpen={false} photo={mockPhoto} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    
    // Test the branch where isOpen is false but keydown event is fired (should just return)
    const onCloseMock = vi.fn();
    render(<ExposureModal isOpen={false} photo={mockPhoto} onClose={onCloseMock} />);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('renders modal content when open', () => {
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={vi.fn()} />);
    expect(screen.getByText('Living Room')).toBeInTheDocument();
    expect(screen.getByTestId('mock-before-after-slider')).toBeInTheDocument();
    expect(screen.getByTestId('slider-Exposure (EV)')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onCloseMock = vi.fn();
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={onCloseMock} />);
    
    // The background div has class bg-[#808080]
    const backdrop = document.querySelector('.bg-\\[\\#808080\\]');
    fireEvent.click(backdrop!);

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onCloseMock = vi.fn();
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={onCloseMock} />);
    
    const closeBtn = screen.getByRole('button', { name: /Close modal/i });
    fireEvent.click(closeBtn);

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('handles keyboard shortcuts Escape', () => {
    const onCloseMock = vi.fn();
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={onCloseMock} />);
    
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('handles keyboard shortcuts A to approve', () => {
    const onCloseMock = vi.fn();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={onCloseMock} />);
    
    fireEvent.keyDown(document, { key: 'a', code: 'KeyA' });
    expect(consoleSpy).toHaveBeenCalledWith('Approved: photo1');
    expect(onCloseMock).toHaveBeenCalledTimes(1);
    
    fireEvent.keyDown(document, { key: 'A', code: 'KeyA' });
    expect(consoleSpy).toHaveBeenCalledWith('Approved: photo1');
    expect(onCloseMock).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it('handles keyboard shortcuts R to reject', () => {
    const onCloseMock = vi.fn();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={onCloseMock} />);
    
    fireEvent.keyDown(document, { key: 'r', code: 'KeyR' });
    expect(consoleSpy).toHaveBeenCalledWith('Rejected: photo1');
    expect(onCloseMock).toHaveBeenCalledTimes(1);
    
    fireEvent.keyDown(document, { key: 'R', code: 'KeyR' });
    expect(consoleSpy).toHaveBeenCalledWith('Rejected: photo1');
    expect(onCloseMock).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it('handles unknown keydown', () => {
    const onCloseMock = vi.fn();
    render(<ExposureModal isOpen={true} photo={mockPhoto} onClose={onCloseMock} />);
    fireEvent.keyDown(document, { key: 'x', code: 'KeyX' });
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('renders standard image if originalUrl is not provided', () => {
    const noOrigPhoto = { ...mockPhoto, originalUrl: undefined, parameters: undefined };
    render(<ExposureModal isOpen={true} photo={noOrigPhoto} onClose={vi.fn()} />);
    
    expect(screen.queryByTestId('mock-before-after-slider')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'test.jpg');
    expect(screen.getByText('No VLM parameters available for this image.')).toBeInTheDocument();
  });

  it('renders parameters with default values when undefined', () => {
    const emptyParamsPhoto = { ...mockPhoto, parameters: {} as any };
    render(<ExposureModal isOpen={true} photo={emptyParamsPhoto} onClose={vi.fn()} />);
    
    // Just ensuring it renders without crashing
    expect(screen.getByTestId('slider-Exposure (EV)')).toBeInTheDocument();
  });
});