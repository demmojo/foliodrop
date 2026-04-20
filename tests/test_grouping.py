from datetime import datetime, timedelta
import pytest

from backend.core.grouping import Photo, ExifData, group_photos


def test_empty_photo_list():
    """Empty input should safely return an empty list of groups."""
    assert group_photos([]) == []


def test_single_photo():
    """A single photo forms a single group."""
    p1 = Photo(id="1", capture_time=datetime(2026, 1, 1, 12, 0, 0))
    groups = group_photos([p1])
    assert len(groups) == 1
    assert groups[0] == [p1]


def test_normal_time_gap():
    """Photos separated by less than max_time_gap should group together."""
    base_time = datetime(2026, 1, 1, 12, 0, 0)
    p1 = Photo(id="1", capture_time=base_time)
    p2 = Photo(id="2", capture_time=base_time + timedelta(minutes=4))  # Gap is 4m
    p3 = Photo(id="3", capture_time=base_time + timedelta(minutes=10)) # Gap from p2 is 6m
    
    # Using default 5 minute max_time_gap
    groups = group_photos([p1, p2, p3])
    
    assert len(groups) == 2
    assert [p.id for p in groups[0]] == ["1", "2"]
    assert [p.id for p in groups[1]] == ["3"]


def test_long_exposure_gap():
    """
    Test that long exposures are accounted for when calculating temporal gaps.
    Even if start times are > max_time_gap apart, if the exposure fills the gap, 
    they should remain in the same group.
    """
    base_time = datetime(2026, 1, 1, 20, 0, 0)
    
    # 5 minute long exposure
    p1 = Photo(
        id="1", 
        capture_time=base_time, 
        exif=ExifData(exposure_time=300.0)
    )
    
    # Starts 9 minutes after p1 started, but only 4 minutes after p1 ended
    p2 = Photo(
        id="2", 
        capture_time=base_time + timedelta(minutes=9)
    )
    
    # Max gap is 5 minutes. 
    # Gap between p1 start and p2 start is 9m (> 5m).
    # Gap between p1 end and p2 start is 4m (< 5m).
    groups = group_photos([p1, p2], max_time_gap=timedelta(minutes=5))
    
    # They should be grouped together due to the exposure time closing the gap
    assert len(groups) == 1
    assert [p.id for p in groups[0]] == ["1", "2"]


def test_rapid_consecutive_rooms():
    """
    Test that EXIF metadata hard-boundaries (like room changes) override temporal proximity.
    Photos taken right after each other but in different rooms should split.
    """
    base_time = datetime(2026, 1, 1, 14, 0, 0)
    
    # Rapid sequence, 5 seconds apart
    p1 = Photo(
        id="1", 
        capture_time=base_time, 
        exif=ExifData(room="kitchen")
    )
    p2 = Photo(
        id="2", 
        capture_time=base_time + timedelta(seconds=5), 
        exif=ExifData(room="living_room")
    )
    
    groups = group_photos([p1, p2])
    
    # Despite the 5 second gap, the room change forces a split
    assert len(groups) == 2
    assert groups[0][0].id == "1"
    assert groups[1][0].id == "2"


def test_missing_exif_does_not_split_rooms():
    """
    If room metadata is missing for one or both photos, we shouldn't force a split.
    We fall back to temporal proximity.
    """
    base_time = datetime(2026, 1, 1, 15, 0, 0)
    
    p1 = Photo(id="1", capture_time=base_time, exif=ExifData(room="kitchen"))
    p2 = Photo(id="2", capture_time=base_time + timedelta(seconds=30), exif=ExifData(room=None))
    
    groups = group_photos([p1, p2])
    
    # No explicit room change (None != kitchen doesn't count), time gap < 5m
    assert len(groups) == 1
    assert [p.id for p in groups[0]] == ["1", "2"]


def test_out_of_order_input():
    """The pipeline must sort photos chronologically before grouping."""
    base_time = datetime(2026, 1, 1, 12, 0, 0)
    
    p1 = Photo(id="1", capture_time=base_time)
    p2 = Photo(id="2", capture_time=base_time + timedelta(minutes=2))
    p3 = Photo(id="3", capture_time=base_time + timedelta(minutes=10)) # Needs to split
    
    # Pass them in out of order: p3, p1, p2
    groups = group_photos([p3, p1, p2])
    
    assert len(groups) == 2
    assert [p.id for p in groups[0]] == ["1", "2"]
    assert [p.id for p in groups[1]] == ["3"]