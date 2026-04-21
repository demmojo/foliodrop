import os
import logging
import asyncio
import numpy as np
import cv2
import gc
from typing import Tuple, List
from pydantic import BaseModel
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

class GenerationError(Exception):
    pass

def compute_structural_diff(base_img: np.ndarray, gen_img: np.ndarray) -> Tuple[bool, float, float]:
    """
    Computes SIFT/MAGSAC++ diff to detect structural hallucinations.
    Returns:
        is_valid: bool (True if image passes geometry check)
        inlier_ratio: float
        max_void_area: float (percentage of image that is a void of inliers)
    """
    # Downsample to 1024px to prevent timeouts/repeating patterns
    max_dim = 1024
    def downsample(img):
        h, w = img.shape[:2]
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        return img

    base_small = downsample(base_img)
    gen_small = downsample(gen_img)
    
    # Convert to grayscale
    base_gray = cv2.cvtColor(base_small, cv2.COLOR_BGR2GRAY)
    gen_gray = cv2.cvtColor(gen_small, cv2.COLOR_BGR2GRAY)
    
    # SIFT feature extraction
    sift = cv2.SIFT_create()
    kp1, des1 = sift.detectAndCompute(base_gray, None)
    kp2, des2 = sift.detectAndCompute(gen_gray, None)
    
    if des1 is None or des2 is None or len(des1) < 10 or len(des2) < 10:
        return False, 0.0, 1.0
        
    # Match features (FLANN)
    FLANN_INDEX_KDTREE = 1
    index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
    search_params = dict(checks=50)
    flann = cv2.FlannBasedMatcher(index_params, search_params)
    matches = flann.knnMatch(des1, des2, k=2)
    
    # Lowe's ratio test
    good_matches = []
    for m_n in matches:
        if len(m_n) != 2:
            continue
        m, n = m_n
        if m.distance < 0.7 * n.distance:
            good_matches.append(m)
            
    if len(good_matches) < 10:
        return False, 0.0, 1.0
        
    src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    
    # Homography via MAGSAC++
    M, mask = cv2.findHomography(src_pts, dst_pts, cv2.USAC_MAGSAC, 5.0)
    if M is None or mask is None:
        return False, 0.0, 1.0
        
    inliers = mask.ravel().tolist()
    inlier_count = sum(inliers)
    inlier_ratio = inlier_count / len(good_matches)
    
    if inlier_ratio < 0.15:
        # Fails basic drift threshold
        return False, inlier_ratio, 1.0
        
    # Check Spatial Inlier Void Pattern
    # Plot remaining inliers on a 2D grid
    h, w = gen_small.shape[:2]
    grid_size = 10 # 10x10 grid
    density = np.zeros((grid_size, grid_size))
    
    for i, is_inlier in enumerate(inliers):
        if is_inlier:
            pt = dst_pts[i][0]
            gx = int((pt[0] / w) * grid_size)
            gy = int((pt[1] / h) * grid_size)
            gx = min(gx, grid_size - 1)
            gy = min(gy, grid_size - 1)
            density[gy, gx] += 1
            
    # Find largest contiguous void of inliers
    # A simple proxy: what percentage of the grid cells have 0 inliers?
    empty_cells = np.sum(density == 0)
    void_ratio = empty_cells / (grid_size * grid_size)
    
    # If more than 40% of the image is completely devoid of matching features, we likely have a massive hallucinated occlusion
    if void_ratio > 0.40:
        return False, inlier_ratio, void_ratio
        
    return True, inlier_ratio, void_ratio

async def generate_hybrid_hdr(
    client: genai.Client,
    fused_base_bytes: bytes,
    bracket_bytes_list: List[bytes],
    retry_count: int = 0
) -> Tuple[bytes, dict]:
    
    uploaded_files = []
    
    try:
        # Upload images via Gemini Files API
        def upload(b, name):
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp.write(b)
                tmp_path = tmp.name
            f = client.files.upload(file=tmp_path)
            os.remove(tmp_path)
            return f
            
        fused_file = await asyncio.to_thread(upload, fused_base_bytes, "fused_base.jpg")
        uploaded_files.append(fused_file)
        
        bracket_files = []
        for i, bb in enumerate(bracket_bytes_list):
            bf = await asyncio.to_thread(upload, bb, f"bracket_{i}.jpg")
            uploaded_files.append(bf)
            bracket_files.append(bf)
            
        # Multimodal Payload Sequencing: Interleaved Labeling
        # Based on Leeroopedia best practices for structural conditioning:
        # Reference first, brackets middle, strict constraints last.
        contents = [
            "Reference geometry: Preserve exact wall positions, window openings, and room proportions shown here. This is ground truth.",
            fused_file,
        ]
        
        for i, bf in enumerate(bracket_files):
            contents.append(f"Exposure reference {i+1}/{len(bracket_files)}")
            contents.append(bf)
            
        # Prompt construction
        prompt = """Professional interior architectural photography.
Create a highly polished, stunning real estate listing photo. 
Make the colors pop, use dramatic but natural HDR lighting, and make wood textures look luxurious.

CRITICAL CONSTRAINT: Generate HDR image using ONLY:
- Walls and structural elements from reference
- Window openings and positions from reference
- Furniture and decorations visible in all brackets
DO NOT add, remove, or modify any room structure not present in inputs."""

        if retry_count > 0:
            prompt += "\n\nCRITICAL PENALTY WARNING: Your previous attempt severely altered the geometry or hallucinated objects. You MUST strictly adhere to the structural lines of the base image. Do NOT invent new objects."
            
        contents.append(prompt)
        
        # Safety configuration based on Leeroopedia ML best practices
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            temperature=0.2, # Lower temperature for structural fidelity
            safety_settings=[
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                ),
                types.SafetySetting(
                    category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold=types.HarmBlockThreshold.BLOCK_NONE, # Technical content OK, architectural geometries sometimes trip this
                ),
            ]
        )
        
        response = await client.aio.models.generate_content(
            model='gemini-3-pro-image-preview',
            contents=contents,
            config=config
        )
        
        if not response.parts:
            raise GenerationError("No parts in response")
            
        for part in response.parts:
            if part.inline_data:
                return part.inline_data.data, {"status": "success"}
                
        raise GenerationError("No image returned by model")
        
    finally:
        # CRITICAL Files Quota Limit Cleanup
        for f in uploaded_files:
            try:
                await asyncio.to_thread(client.files.delete, name=f.name)
            except Exception as e:
                logger.warning(f"Failed to delete Gemini file {f.name}: {e}")
                

