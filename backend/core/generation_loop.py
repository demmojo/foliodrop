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


def _log_debug(loc, msg, data, hyp_id):
    logger.debug("%s | %s | %s | %s", loc, msg, data, hyp_id)

# Hard structural rules as system instruction (Leeropedia: system constraints beat conflicting user text;
# avoid prompts that require "window views" when the scene may have no windows).
_STRUCTURAL_SYSTEM_INSTRUCTION = """You are a real-estate photo refinement model.

Non-negotiable:
- The first image in the user message is geometric ground truth. Match wall lines, corners, ceiling, and any existing window or door OPENINGS exactly.
- Do NOT add, remove, move, or resize windows, doors, or other architectural openings. Do NOT paint glass, frames, mullions, or exterior views onto solid walls.
- If the reference shows a window opening, you may use darker exposure inputs only to improve exposure and exterior detail *within that same opening*—without changing its shape or position.
- If the reference shows a solid wall with no opening, keep it solid. Never invent a window or outdoor view to satisfy a "view" or HDR aesthetic.
- You may adjust tone, contrast, shadows, and color for a polished listing look, without altering layout or structure."""

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

    def is_low_texture(gray: np.ndarray) -> bool:
        # Very low Laplacian variance scenes (blank walls/minimal features) frequently
        # trigger false QA rejects; treat these as structurally uncertain, not invalid.
        return cv2.Laplacian(gray, cv2.CV_64F).var() < 8.0

    low_texture_scene = is_low_texture(base_gray) and is_low_texture(gen_gray)
    
    if des1 is None or des2 is None or len(des1) < 10 or len(des2) < 10:
        _log_debug("generation_loop.py:47", "SIFT keypoints missing or insufficient", {"len_des1": len(des1) if des1 is not None else 0, "len_des2": len(des2) if des2 is not None else 0}, "H1")
        if low_texture_scene:
            _log_debug("generation_loop.py:49", "Low-texture scene: soft-pass on insufficient keypoints", {}, "H1_SOFTPASS")
            return True, 1.0, 0.0
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
        _log_debug("generation_loop.py:66", "Insufficient good matches", {"len_good_matches": len(good_matches)}, "H2")
        if low_texture_scene:
            _log_debug("generation_loop.py:68", "Low-texture scene: soft-pass on insufficient matches", {}, "H2_SOFTPASS")
            return True, 1.0, 0.0
        return False, 0.0, 1.0
        
    src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    
    # Homography via MAGSAC++
    M, mask = cv2.findHomography(src_pts, dst_pts, cv2.USAC_MAGSAC, 8.0)
    if M is None or mask is None:
        _log_debug("generation_loop.py:74", "Homography matrix or mask is None", {"M_is_none": M is None, "mask_is_none": mask is None}, "H3")
        if low_texture_scene:
            _log_debug("generation_loop.py:76", "Low-texture scene: soft-pass on missing homography", {}, "H3_SOFTPASS")
            return True, 1.0, 0.0
        return False, 0.0, 1.0
        
    inliers = mask.ravel().tolist()
    inlier_count = sum(inliers)
    inlier_ratio = inlier_count / len(good_matches)
    
    if inlier_ratio < 0.12:
        # Fails basic drift threshold
        _log_debug("generation_loop.py:82", "Inlier ratio too low", {"inlier_ratio": inlier_ratio, "inlier_count": inlier_count, "total_matches": len(good_matches)}, "H4")
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
    void_ratio = float(empty_cells) / (grid_size * grid_size)
    
    # If more than 55% of the image is completely devoid of matching features,
    # we likely have a massive hallucinated occlusion.
    if void_ratio > 0.55:
        _log_debug("generation_loop.py:106", "Void ratio too high", {"void_ratio": void_ratio, "empty_cells": int(empty_cells)}, "H5")
        return False, inlier_ratio, void_ratio
        
    _log_debug("generation_loop.py:109", "Passed QA", {"inlier_ratio": inlier_ratio, "void_ratio": void_ratio}, "H_OK")
    return True, inlier_ratio, void_ratio

async def generate_hybrid_hdr(
    client: genai.Client,
    fused_file: types.File,
    bracket_files: List[types.File],
    retry_count: int = 0,
    style_urls: List[str] = None,
    training_pairs: List[dict] = None
) -> Tuple[bytes, dict]:
    
    try:
        # Multimodal Payload Sequencing: Interleaved Labeling
        # Based on Leeroopedia best practices for structural conditioning:
        # Reference first, brackets middle, strict constraints last.
        contents = [
            "User task: The next image is the fused base (geometric and compositional ground truth for this room).",
            fused_file,
        ]
        
        for i, bf in enumerate(bracket_files):
            contents.append(f"Exposure reference {i+1}/{len(bracket_files)}")
            contents.append(bf)
            
        if training_pairs:
            contents.append("Here is a previous set of brackets (Exposure reference) and the exact final output the user approved (Desired Output). Match this transformation logic exactly while maintaining the structure of the current brackets.")
            for i, pair in enumerate(training_pairs):
                contents.append(f"Example {i+1}:")
                # We expect pair to have 'bracket_urls' and 'final_url'
                for j, b_url in enumerate(pair.get("bracket_urls", [])):
                    contents.append(f"Previous Exposure {j+1}:")
                    contents.append(types.Part.from_uri(file_uri=b_url, mime_type="image/jpeg"))
                contents.append(f"Desired Output for Example {i+1}:")
                contents.append(types.Part.from_uri(file_uri=pair.get("final_url", ""), mime_type="image/jpeg"))
        elif style_urls:
            contents.append("Desired Style Reference: Apply the color grading, contrast, and tone from these reference images.")
            for url in style_urls:
                contents.append(types.Part.from_uri(file_uri=url, mime_type="image/jpeg"))

        # Prompt: polish and exposure only; structural rules live in system_instruction to avoid
        # conflicting "must show window view" vs "never invent windows" (hallucination driver).
        prompt = """Polish this interior for a high-end real estate listing.

Aesthetic: soft natural light, smooth walls and ceilings, fine edge detail without crunchy sharpening. No HDR halos, harsh local contrast, or blotchy texture. Gently lift shadows; avoid crushed blacks. Wood should look rich, not murky. Overall balanced, magazine-quality, MLS-ready.

Where the ground-truth image already has a window: use the darker exposure references to recover sky, foliage, or scene detail without blowing out highlights. Do not change the window's position, count, or shape.

Where the ground truth has no window on a wall: keep that wall solid. Do not add a window, glass, or fake exterior view for drama."""

        if retry_count > 0:
            prompt += "\n\nRetry: The previous output failed structural validation. Match the first (fused) image's architecture exactly. Do not invent or move openings."
            
        contents.append(prompt)
        
        # Leeropedia: low temperature + moderate top_p + system_instruction as hard constraint; high media
        # resolution for finer conditioning on reference pixels.
        config = types.GenerateContentConfig(
            system_instruction=_STRUCTURAL_SYSTEM_INSTRUCTION,
            response_modalities=["IMAGE"],
            temperature=0.0,
            top_p=0.9,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
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
        
    except Exception as e:
        raise e
                

