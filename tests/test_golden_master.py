import os
import pytest
import cv2
import numpy as np
from pathlib import Path
from skimage.metrics import structural_similarity as ssim

# Mock function for HDR processing (will be replaced by actual implementation)
def process_hdr_batch(image_paths):
    """
    Mock function that currently just reads the middle exposure (EV 0) 
    and returns it. In a real implementation, this would align, fuse, 
    and apply semantic window pull.
    """
    # Assuming the 3rd image is the EV 0 (middle exposure)
    if len(image_paths) >= 3:
        # Load in grayscale for simpler testing or color if needed
        # For our golden tests, we'll return color and test grayscale SSIM
        img = cv2.imread(str(image_paths[2]))
        if img is None:
            raise ValueError(f"Could not read image {image_paths[2]}")
        return img
    raise ValueError("Not enough images in batch")

FIXTURES_DIR = Path(__file__).parent / "fixtures"
GOLDEN_MASTERS_DIR = FIXTURES_DIR / "golden_masters"

def get_ssim(img1, img2):
    """Calculate Structural Similarity Index between two images."""
    # Convert to grayscale for SSIM calculation
    if len(img1.shape) == 3:
        img1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
    if len(img2.shape) == 3:
        img2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
        
    # Calculate SSIM
    score, _ = ssim(img1, img2, full=True, data_range=255)
    return score

@pytest.mark.parametrize("batch_id", ["batch_1", "batch_2", "batch_3", "batch_4"])
def test_golden_master(batch_id):
    """
    Golden master test for HDR processing.
    If the golden master doesn't exist, it creates one (run this first to establish baseline).
    If it does exist, it compares the current pipeline output against it.
    """
    batch_dir = FIXTURES_DIR / batch_id
    if not batch_dir.exists():
        pytest.skip(f"Batch directory {batch_dir} not found")
        
    # Get all PNGs in the batch directory, sorted by name
    # Ensure we actually have files
    image_paths = sorted(list(batch_dir.glob("*.png")))
    if len(image_paths) != 5:
        pytest.skip(f"Batch {batch_id} does not have exactly 5 images")

    # Run the pipeline
    output_img = process_hdr_batch(image_paths)
    
    # Check if golden master exists
    golden_path = GOLDEN_MASTERS_DIR / f"{batch_id}_golden.png"
    
    if not golden_path.exists():
        # First run: establish golden master
        os.makedirs(GOLDEN_MASTERS_DIR, exist_ok=True)
        cv2.imwrite(str(golden_path), output_img)
        print(f"\nCreated golden master for {batch_id}")
        assert True
    else:
        # Subsequent runs: compare against golden master
        golden_img = cv2.imread(str(golden_path))
        if golden_img is None:
            pytest.fail(f"Could not read golden master at {golden_path}")
            
        # Check shapes match
        assert output_img.shape == golden_img.shape, \
            f"Output shape {output_img.shape} does not match golden shape {golden_img.shape}"
            
        # Calculate SSIM
        similarity = get_ssim(output_img, golden_img)
        
        # We expect a very high SSIM. OpenCV operations can have slight floating point 
        # differences across architectures, so we don't demand 1.0, but > 0.99
        assert similarity >= 0.99, f"SSIM {similarity} below threshold of 0.99 for {batch_id}"
