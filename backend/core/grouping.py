from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


@dataclass(frozen=True)
class ExifData:
    """
    Strongly-typed EXIF data relevant for photo grouping.
    """
    exposure_time: float = 0.0  # Exposure time in seconds
    room: Optional[str] = None


@dataclass(frozen=True)
class Photo:
    """
    Domain model for a photo to be grouped.
    """
    id: str
    capture_time: datetime
    exif: ExifData = field(default_factory=ExifData)


def group_photos(
    photos: list[Photo], 
    max_time_gap: timedelta = timedelta(minutes=5)
) -> list[list[Photo]]:
    """
    Deterministic Grouping Pipeline (Time + EXIF).
    
    Groups photos based on temporal proximity and EXIF metadata.
    A new group is started if:
    1. The time gap between the end of the previous photo and the start 
       of the current photo exceeds max_time_gap.
    2. EXIF metadata indicates a hard boundary (e.g., room change).
    """
    if not photos:
        return []
        
    # Ensure photos are processed in chronological order
    sorted_photos = sorted(photos, key=lambda p: p.capture_time)
    
    groups: list[list[Photo]] = [[sorted_photos[0]]]
    
    for current_photo in sorted_photos[1:]:
        current_group = groups[-1]
        previous_photo = current_group[-1]
        
        # Calculate the actual end time of the previous photo
        # This accounts for long exposures extending the capture duration
        previous_end_time = previous_photo.capture_time + timedelta(seconds=previous_photo.exif.exposure_time)
        
        # Calculate the gap from the end of the previous photo to the start of the current one
        gap = current_photo.capture_time - previous_end_time
        
        is_time_split = gap > max_time_gap
        
        # Explicit room changes mandate a split, even if taken rapidly
        is_room_split = False
        if current_photo.exif.room is not None and previous_photo.exif.room is not None:
            is_room_split = current_photo.exif.room != previous_photo.exif.room
            
        if is_time_split or is_room_split:
            # Start a new group
            groups.append([current_photo])
        else:
            # Append to current group
            current_group.append(current_photo)
            
    return groups