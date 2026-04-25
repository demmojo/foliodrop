import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BeforeAfterSlider from './BeforeAfterSlider';

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

describe('BeforeAfterSlider Component', () => {
  it('renders both images', () => {
    render(<BeforeAfterSlider beforeUrl="before.jpg" afterUrl="after.jpg" />);
    
    expect(screen.getByAltText('Original Exposure')).toHaveAttribute('src', 'before.jpg');
    expect(screen.getByAltText('Fused HDR Result')).toHaveAttribute('src', 'after.jpg');
  });

  it('handles mouse interaction to move slider', () => {
    const { container } = render(<BeforeAfterSlider beforeUrl="before.jpg" afterUrl="after.jpg" />);
    
    const sliderContainer = container.firstChild as HTMLDivElement;
    
    // Mock getBoundingClientRect
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => {}
    });

    // Start drag
    fireEvent.mouseDown(sliderContainer, { clientX: 500 });
    
    // The handle should be around 50%
    const handle = container.querySelector('.cursor-ew-resize') as HTMLDivElement;
    expect(handle.style.left).toBe('50%');

    // Move mouse
    fireEvent.mouseMove(window, { clientX: 250 });
    expect(handle.style.left).toBe('25%');

    // End drag
    fireEvent.mouseUp(window);

    // Moving after drag end shouldn't update
    fireEvent.mouseMove(window, { clientX: 750 });
    expect(handle.style.left).toBe('25%');
  });

  it('handles touch interaction', () => {
    const { container } = render(<BeforeAfterSlider beforeUrl="before.jpg" afterUrl="after.jpg" />);
    
    const sliderContainer = container.firstChild as HTMLDivElement;
    
    vi.spyOn(sliderContainer, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => {}
    });

    // Start touch
    fireEvent.touchStart(sliderContainer, { touches: [{ clientX: 500 }] });
    
    const handle = container.querySelector('.cursor-ew-resize') as HTMLDivElement;
    expect(handle.style.left).toBe('50%');

    // Move touch
    const touchEvent = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
    });
    // Add touches property manually since TouchEvent constructor might not support it fully in jsdom
    Object.defineProperty(touchEvent, 'touches', {
      value: [{ clientX: 750 }]
    });
    const preventDefaultSpy = vi.spyOn(touchEvent, 'preventDefault');
    fireEvent(window, touchEvent);

    expect(handle.style.left).toBe('75%');
    expect(preventDefaultSpy).toHaveBeenCalled();

    // End touch
    fireEvent.touchEnd(window);
  });

  it('applies object-contain class when objectFit prop is contain', () => {
    render(<BeforeAfterSlider beforeUrl="before.jpg" afterUrl="after.jpg" objectFit="contain" />);
    
    const beforeImg = screen.getByAltText('Original Exposure');
    const afterImg = screen.getByAltText('Fused HDR Result');

    expect(beforeImg).toHaveClass('object-contain');
    expect(afterImg).toHaveClass('object-contain');
  });
});