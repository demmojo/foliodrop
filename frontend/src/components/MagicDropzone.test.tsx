import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import MagicDropzone from './MagicDropzone';

const useMock = vi.fn().mockReturnThis();
const onMock = vi.fn();
const destroyMock = vi.fn();

vi.mock('@uppy/core', () => {
  const UppyMock = vi.fn().mockImplementation(() => ({
    use: useMock,
    on: onMock,
    destroy: destroyMock,
  }));
  return { default: UppyMock };
});

vi.mock('@uppy/react/dashboard', () => ({
  default: () => <div data-testid="uppy-dashboard">Dashboard</div>
}));

vi.mock('@uppy/aws-s3', () => ({ default: vi.fn() }));
vi.mock('@uppy/golden-retriever', () => ({ default: vi.fn() }));

// Mock global fetch for the complete handler
global.fetch = vi.fn().mockResolvedValue({ ok: true });

describe('MagicDropzone Component', () => {
  it('renders correctly', () => {
    const { getByTestId } = render(<MagicDropzone />);
    expect(getByTestId('uppy-dashboard')).toBeInTheDocument();
  });

  it('configures Uppy with correct upload parameters and handles completion', () => {
    render(<MagicDropzone />);
    
    // Find the AwsS3 plugin call
    const awsS3Call = useMock.mock.calls.find(call => call[1] && call[1].getUploadParameters);
    expect(awsS3Call).toBeDefined();
    
    const getUploadParameters = awsS3Call![1].getUploadParameters;
    const file = { name: 'test.jpg', type: 'image/jpeg' };
    const params = getUploadParameters(file);
    
    expect(params.method).toBe('PUT');
    expect(params.url).toContain('https://storage.googleapis.com/fake-bucket/');
    expect(params.url).toContain('test.jpg');
    expect(params.headers['Content-Type']).toBe('image/jpeg');
    
    // Find the complete event handler
    const completeCall = onMock.mock.calls.find(call => call[0] === 'complete');
    expect(completeCall).toBeDefined();
    
    const completeHandler = completeCall![1];
    
    act(() => {
      completeHandler({ successful: true });
    });
    
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms: ['LivingRoom'] })
      })
    );
  });
});