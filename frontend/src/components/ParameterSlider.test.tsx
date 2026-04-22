import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ParameterSlider from './ParameterSlider';

describe('ParameterSlider Component', () => {
  it('renders slider with basic props', () => {
    render(<ParameterSlider label="Exposure" min={-3} max={3} value={0} />);
    expect(screen.getByText('Exposure')).toBeInTheDocument();
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });

  it('renders ghost value marker', () => {
    const { container } = render(<ParameterSlider label="Exposure" min={-3} max={3} value={0} ghostValue={2} />);
    // Ghost marker is rendered when isHallucinated is true (0 !== 2)
    const ghost = container.querySelector('[title="VLM original value: 2"]');
    expect(ghost).toBeInTheDocument();
  });

  it('triggers onChange', () => {
    const onChangeMock = vi.fn();
    const { container } = render(<ParameterSlider label="Exposure" min={-3} max={3} value={0} onChange={onChangeMock} />);
    
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1.5' } });
    
    expect(onChangeMock).toHaveBeenCalledWith(1.5);
  });
});