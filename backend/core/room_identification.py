from abc import ABC, abstractmethod
from typing import List, Dict, Any
import asyncio

class IRoomIdentificationStrategy(ABC):
    @abstractmethod
    async def identify_room(self, image_url: str, metadata: Dict[str, Any]) -> str:  # pragma: no cover
        pass

class GeminiRoomIdentificationStrategy(IRoomIdentificationStrategy):
    async def identify_room(self, image_url: str, metadata: Dict[str, Any]) -> str:
        # In a real implementation, this would call the Gemini 3.1 Pro API
        # with a prompt analyzing the image contents and EXIF metadata.
        await asyncio.sleep(0.5) # Simulate API call latency
        
        # Simple simulated logic based on metadata hints if any
        hints = str(metadata).lower()
        if "refrigerator" in hints or "stove" in hints:
            return "Kitchen"
        if "bed" in hints:
            return "Bedroom"
        if "tub" in hints or "shower" in hints:
            return "Bathroom"
            
        # Default fallback
        return "Living Space"

class OnDeviceMobileNetStrategy(IRoomIdentificationStrategy):
    async def identify_room(self, image_url: str, metadata: Dict[str, Any]) -> str:
        # On-device processing simulation (faster but less accurate)
        await asyncio.sleep(0.1)
        return "Unknown Room"

class RoomIdentifier:
    """Context class for the Strategy Pattern"""
    def __init__(self, strategy: IRoomIdentificationStrategy):
        self._strategy = strategy

    def set_strategy(self, strategy: IRoomIdentificationStrategy):
        self._strategy = strategy

    async def identify(self, image_url: str, metadata: Dict[str, Any]) -> str:
        return await self._strategy.identify_room(image_url, metadata)