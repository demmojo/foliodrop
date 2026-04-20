import pytest
import asyncio
from backend.core.room_identification import (
    RoomIdentifier, 
    GeminiRoomIdentificationStrategy, 
    OnDeviceMobileNetStrategy
)

@pytest.mark.asyncio
async def test_gemini_strategy():
    strategy = GeminiRoomIdentificationStrategy()
    identifier = RoomIdentifier(strategy)
    
    room = await identifier.identify("http://example.com/img.jpg", {"items": "refrigerator and stove"})
    assert room == "Kitchen"
    
    room2 = await identifier.identify("http://example.com/img2.jpg", {"items": "a large bed"})
    assert room2 == "Bedroom"

@pytest.mark.asyncio
async def test_mobilenet_strategy():
    strategy = OnDeviceMobileNetStrategy()
    identifier = RoomIdentifier(strategy)
    
    room = await identifier.identify("http://example.com/img.jpg", {})
    assert room == "Unknown Room"

@pytest.mark.asyncio
async def test_strategy_switching():
    identifier = RoomIdentifier(OnDeviceMobileNetStrategy())
    
    room1 = await identifier.identify("http://example.com/img.jpg", {})
    assert room1 == "Unknown Room"
    
    identifier.set_strategy(GeminiRoomIdentificationStrategy())
    room2 = await identifier.identify("http://example.com/img.jpg", {"desc": "tub"})
    assert room2 == "Bathroom"