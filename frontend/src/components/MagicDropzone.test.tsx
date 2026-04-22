import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import MagicDropzone from './MagicDropzone';

vi.mock('@uppy/core', () => {
  const UppyMock = vi.fn().mockImplementation(() => ({
    use: vi.fn().mockReturnThis(),
    on: vi.fn(),
    destroy: vi.fn(),
  }));
  return { default: UppyMock };
});

vi.mock('@uppy/react/dashboard', () => ({
  default: () => <div data-testid="uppy-dashboard">Dashboard</div>
}));

vi.mock('@uppy/aws-s3', () => ({ default: vi.fn() }));
vi.mock('@uppy/golden-retriever', () => ({ default: vi.fn() }));

describe('MagicDropzone Component', () => {
  it('renders correctly', () => {
    const { getByTestId } = render(<MagicDropzone />);
    expect(getByTestId('uppy-dashboard')).toBeInTheDocument();
  });
});