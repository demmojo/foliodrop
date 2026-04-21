import json
import logging
from typing import Dict, Any, Tuple
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class VLMQualityReport(BaseModel):
    window_reasoning: str = Field(description="Chain of thought: Explain step-by-step if the windows are completely blown out (solid white with no mullions/details) compared to the reference dark bracket.")
    window_score: int = Field(ge=1, le=10, description="Score 1-10. 10 = perfect preservation of window details from the dark bracket. 1 = completely blown out/clipping.")

class VLMLoopError(Exception):
    def __init__(self, message: str, raw_telemetry: list):
        super().__init__(message)
        self.raw_telemetry = raw_telemetry

async def evaluate_fused_image(
    genai_client, 
    darkest_bracket_bytes: bytes, 
    fused_image_bytes: bytes,
) -> Tuple[VLMQualityReport, list]:
    """
    Uses Gemini as a pure QA Judge. No image modification or mathematical parameters are returned.
    """
    telemetry = []
    
    system_prompt = (
        "You are an expert Real Estate Photography Quality Assurance Judge.\n"
        "I will provide you with TWO images:\n"
        "1. The 'Darkest Bracket' (Reference): This image is very dark, but it perfectly preserves the detail outside the windows.\n"
        "2. The 'Fused HDR' (Result): This is the final processed image.\n\n"
        "Your task is to compare the windows in the Fused HDR image against the Darkest Bracket.\n"
        "Did the HDR fusion blow out the windows (lose all detail) or preserve them?\n"
        "Output valid JSON matching the schema. Always output reasoning BEFORE the final score."
    )

    try:
        from google.genai import types
        
        response = await genai_client.aio.models.generate_content(
            model='gemini-2.5-pro',
            contents=[
                types.Part.from_text(system_prompt),
                types.Part.from_bytes(data=darkest_bracket_bytes, mime_type='image/jpeg'),
                types.Part.from_text("^^ Image 1: The Darkest Bracket (Reference) ^^"),
                types.Part.from_bytes(data=fused_image_bytes, mime_type='image/jpeg'),
                types.Part.from_text("^^ Image 2: The Fused HDR (Result) ^^")
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VLMQualityReport,
                temperature=0.1 # Low temperature for deterministic scoring
            )
        )
        
        telemetry.append({"role": "model", "content": response.text})
        
        try:
            report_data = json.loads(response.text)
            report = VLMQualityReport(**report_data)
            return report, telemetry
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse VLM Output: {e}")
            raise VLMLoopError("VLM Output Validation Failed", telemetry)
            
    except Exception as e:
         logger.error(f"VLM API Error: {e}")
         raise VLMLoopError(str(e), telemetry)
