import pytest
from backend.core.room_identification import (
    GeminiRoomIdentificationStrategy,
    OnDeviceMobileNetStrategy,
    RoomIdentifier
)

@pytest.mark.asyncio
async def test_gemini_strategy():
    strategy = GeminiRoomIdentificationStrategy()
    
    # Test kitchen
    room = await strategy.identify_room("http://fake", {"desc": "A beautiful Refrigerator"})
    assert room == "Kitchen"
    
    # Test bedroom
    room = await strategy.identify_room("http://fake", {"desc": "Master Bed"})
    assert room == "Bedroom"
    
    # Test bathroom
    room = await strategy.identify_room("http://fake", {"desc": "Modern Tub"})
    assert room == "Bathroom"
    
    # Test fallback
    room = await strategy.identify_room("http://fake", {"desc": "Empty area"})
    assert room == "Living Space"

@pytest.mark.asyncio
async def test_mobile_net_strategy():
    strategy = OnDeviceMobileNetStrategy()
    room = await strategy.identify_room("http://fake", {})
    assert room == "Unknown Room"

@pytest.mark.asyncio
async def test_room_identifier_context():
    gemini = GeminiRoomIdentificationStrategy()
    mobile = OnDeviceMobileNetStrategy()
    
    identifier = RoomIdentifier(gemini)
    room1 = await identifier.identify("http://fake", {"desc": "Stove"})
    assert room1 == "Kitchen"
    
    identifier.set_strategy(mobile)
    room2 = await identifier.identify("http://fake", {"desc": "Stove"})
    assert room2 == "Unknown Room"
