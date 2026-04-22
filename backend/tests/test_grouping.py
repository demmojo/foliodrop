import pytest
from datetime import datetime, timedelta
from backend.core.grouping import group_photos, Photo, ExifData

def test_group_photos_empty():
    assert group_photos([]) == []

def test_group_photos_room_split():
    p1 = Photo("1", datetime(2020, 1, 1, 10, 0), ExifData(room="Kitchen"))
    p2 = Photo("2", datetime(2020, 1, 1, 10, 1), ExifData(room="Living"))
    
    groups = group_photos([p1, p2])
    assert len(groups) == 2
    assert groups[0][0].id == "1"
    assert groups[1][0].id == "2"

def test_group_photos_time_split():
    p1 = Photo("1", datetime(2020, 1, 1, 10, 0), ExifData(exposure_time=1.0))
    # 6 minutes later
    p2 = Photo("2", datetime(2020, 1, 1, 10, 6, 2), ExifData(exposure_time=1.0))
    
    groups = group_photos([p1, p2], max_time_gap=timedelta(minutes=5))
    assert len(groups) == 2

def test_group_photos_no_split():
    p1 = Photo("1", datetime(2020, 1, 1, 10, 0), ExifData(room="Kitchen"))
    p2 = Photo("2", datetime(2020, 1, 1, 10, 1), ExifData(room="Kitchen"))
    p3 = Photo("3", datetime(2020, 1, 1, 10, 2), ExifData(room=None))
    
    groups = group_photos([p1, p2, p3])
    assert len(groups) == 1
    assert len(groups[0]) == 3
