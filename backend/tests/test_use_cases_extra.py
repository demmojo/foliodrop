import pytest
import asyncio
import os
import logging
import cv2
import numpy as np
from unittest.mock import MagicMock, patch

from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber
from backend.core.use_cases import (
    FinalizeJobUseCase,
    ProcessHdrGroupUseCase,
    downsample_for_vlm,
    OverrideJobImageUseCase,
    UploadStyleImageUseCase,
)
from backend.tests.fakes import FakeDatabase, FakeTaskQueue, FakeBlobStorage, FakeEventPublisher


def test_finalize_job_with_groups_data():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    
    result = use_case.execute("fake-agency", "session", "key", groups_data=[
        {"name": "Scene 1", "files": ["file1.jpg", "file2.jpg"]},
        {"name": "Scene 2", "files": ["file3.jpg", "file4.jpg"]}
    ])
    
    assert result["status"] == "enqueued"
    assert result["tasks_count"] == 2
    assert len(result["job_ids"]) == 2

def test_finalize_job_quota_exceeded():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    
    db.increment_quota_usage = MagicMock(return_value=False)
    result = use_case.execute("fake-agency", "session", "key", [{"name": "file", "timestamp": 1000}])
    assert result["status"] == "quota_exceeded"

def test_downsample_for_vlm_invalid_bytes_returns_input():
    raw = b"not a jpeg"
    out = downsample_for_vlm(raw, max_dim=100)
    assert out == raw


def test_downsample_for_vlm_small_image():
    img = np.zeros((500, 500, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    bytes_data = encoded.tobytes()
    
    downsampled_bytes = downsample_for_vlm(bytes_data, max_dim=1000)
    
    img_out = cv2.imdecode(np.frombuffer(downsampled_bytes, np.uint8), cv2.IMREAD_COLOR)
    h, w = img_out.shape[:2]
    assert h == 500

@pytest.mark.asyncio
async def test_process_hdr_missing_photos_with_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    job_id = "test_job_1"
    db.save_job(job_id, "session", "PENDING", "key_1")
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute(job_id, "session", "Room 1", ["img1.jpg"])
    assert result["status"] == "error"

@pytest.mark.asyncio
async def test_process_hdr_missing_photos_no_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("missing_job", "session", "Room 1", ["img1.jpg"])
    assert result["status"] == "error"

@pytest.mark.asyncio
async def test_process_hdr_success_no_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes, fake_bytes]
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", "missing_job", "session", "Room 1", ["img1.jpg", "img2.jpg", "img3.jpg"])
    assert result["status"] == "COMPLETED"

@pytest.mark.asyncio
async def test_process_hdr_large_image_and_malloc_trim_fail():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((2500, 1000, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes, fake_bytes]
    
    job_id = "test_job_2"
    db.save_job(job_id, "session", "PENDING", "key_2")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    libc = MagicMock()
    libc.malloc_trim = MagicMock(side_effect=OSError("malloc_trim"))
    with patch("ctypes.CDLL", return_value=libc):
        result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg", "img3.jpg"])
    assert result["status"] == "COMPLETED"

@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_with_real_key_success(mock_compute_diff, mock_generate, mock_client):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    job_id = "test_job_3"
    db.save_job(job_id, "session", "PENDING", "key_3")
    
    mock_generate.return_value = (fake_bytes, {"status": "success"})
    mock_compute_diff.return_value = (True, 0.9, 0.0)
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "COMPLETED"

@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_with_real_key_structural_failure_fallback(mock_compute_diff, mock_generate, mock_client):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    job_id = "test_job_4"
    db.save_job(job_id, "session", "PENDING", "key_4")
    
    mock_generate.return_value = (fake_bytes, {"status": "success"})
    mock_compute_diff.return_value = (False, 0.05, 0.6)
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "FLAGGED"
    assert result["isFlagged"] is True


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
async def test_process_hdr_with_real_key_exception(mock_generate, mock_client):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    job_id = "test_job_5"
    db.save_job(job_id, "session", "PENDING", "key_5")
    
    mock_generate.side_effect = Exception("GenAI failed")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "FLAGGED"

@pytest.mark.asyncio
async def test_process_hdr_exception_during_update():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    storage.download_blobs = MagicMock(side_effect=Exception("Storage error"))
    job_id = "test_job_6"
    db.save_job(job_id, "session", "PENDING", "key_6")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "error"

@pytest.mark.asyncio
async def test_process_hdr_exception_no_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    storage.download_blobs = MagicMock(side_effect=Exception("Storage error"))
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("missing_job", "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "error"

def test_override_job_image_job_not_found():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    res = use_case.execute("agency", "missing_job", ("file.jpg", b"data", "image/jpeg"))
    assert res["status"] == "error"

def test_override_job_image_thumb_fail():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    db.save_job("job_1", "session", "COMPLETED", "key", result={"blob_path": "a"})
    res = use_case.execute("agency", "job_1", ("file.jpg", b"bad_data", "image/jpeg"))
    assert res["status"] == "success"

def test_override_job_image_no_result():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    db.save_job("job_2", "session", "COMPLETED", "key")
    res = use_case.execute("agency", "job_2", ("file.jpg", b"data", "image/jpeg"))
    assert res["status"] == "error"

def test_override_job_image_success_thumb():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    db.save_job("job_3", "session", "COMPLETED", "key", result={"blob_path": "a"})
    
    img = np.zeros((1000, 1000, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    
    res = use_case.execute("agency", "job_3", ("file.jpg", fake_bytes, "image/jpeg"))
    assert res["status"] == "success"
    job = db.get_job("job_3")
    assert "thumb_blob_path" in job["result"]


def test_finalize_job_no_input_groups_does_nothing():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    result = use_case.execute("ag", "session", "empty")
    assert result["status"] == "enqueued"
    assert result["tasks_count"] == 0
    assert result["job_ids"] == []


def test_finalize_job_groups_photos_from_files_data_path():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    result = use_case.execute(
        "ag",
        "session",
        "idem2",
        files_data=[
            {"name": "a.jpg", "timestamp": 1_000_000},
            {"name": "b.jpg", "timestamp": 1_000_100},
        ],
    )
    assert result["status"] == "enqueued"
    assert result["tasks_count"] >= 1


def test_style_upload_deletes_evicted_blobs():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    db.save_style_image = lambda agency_id, blob_path: [f"style/{agency_id}/replaced.jpg"]
    use_case = UploadStyleImageUseCase(storage, db)
    res = use_case.execute("ag1", "style.jpg", b"\xff\xd8", "image/jpeg")
    assert res["evicted_count"] == 1
    assert res["status"] == "success"


def test_finalize_job_skips_empty_file_list_in_group():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    result = use_case.execute(
        "ag", "session", "idem",
        groups_data=[{"name": "Empty", "files": []}, {"name": "Full", "files": ["a.jpg", "b.jpg"]}],
    )
    assert result["status"] == "enqueued"
    assert result["tasks_count"] == 1


def test_finalize_job_reuses_idempotent_group_job():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    db.save_job("reused", "session", "PENDING", "idem_group_0")
    use_case = FinalizeJobUseCase(task_queue, db)
    result = use_case.execute(
        "ag", "session", "idem",
        groups_data=[{"name": "S1", "files": ["a.jpg", "b.jpg"]}],
    )
    assert "reused" in result["job_ids"]


@pytest.mark.asyncio
async def test_process_hdr_cache_hit_skips_pipeline():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "cache_job_1"
    db.save_job(job_id, "session", "PENDING", "key_cache")
    db.get_cached_group = MagicMock(
        return_value={
            "room": "Cached",
            "status": "COMPLETED",
            "blob_path": "b",
            "thumb_blob_path": "t",
            "original_blob_path": "o",
            "isFlagged": False,
            "vlmReport": None,
            "telemetry": [],
        }
    )
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    out = await use_case.execute("ag", job_id, "session", "Living", ["a.jpg", "b.jpg"])
    assert out["room"] == "Living"


@pytest.mark.asyncio
async def test_process_hdr_cache_hit_without_job_row():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    db.get_cached_group = MagicMock(
        return_value={
            "room": "Cached",
            "status": "COMPLETED",
            "blob_path": "b",
            "thumb_blob_path": "t",
            "original_blob_path": "o",
        }
    )
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    out = await use_case.execute("ag", "no_such_job", "session", "Living", ["a.jpg", "b.jpg"])
    assert out["room"] == "Living"


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_warns_on_gemini_file_delete_failure(
    mock_compute, mock_gen, mock_client_class, caplog
):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "del_warn_job"
    db.save_job(job_id, "session", "PENDING", "key_dw")
    mock_compute.return_value = (True, 0.9, 0.0)
    mock_gen.return_value = (fake_bytes, {"status": "success"})

    mock_f = MagicMock()
    mock_f.name = "files/abc"
    inst = MagicMock()
    inst.files.upload = MagicMock(return_value=mock_f)
    inst.files.delete = MagicMock(side_effect=RuntimeError("delete failed"))
    mock_client_class.return_value = inst

    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    with caplog.at_level(logging.WARNING):
        await use_case.execute("ag", job_id, "session", "Room", ["a.jpg", "b.jpg"])
    assert any("Failed to delete Gemini file" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_process_hdr_top_level_error_without_job_row():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    storage.download_blobs = MagicMock(side_effect=RuntimeError("network"))
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("ag", "no_job", "s", "Room", ["a.jpg", "b.jpg"])
    assert result["status"] == "error"
    assert "network" in result["message"]


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_uses_training_pairs_from_db(
    mock_compute, mock_gen, mock_client_class,
):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    db.save_training_pair("ag7", ["bp1", "bp2"], "fp.jpg")
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "tp_job"
    db.save_job(job_id, "session", "PENDING", "k_tp")
    mock_compute.return_value = (True, 0.5, 0.1)
    mock_gen.return_value = (fake_bytes, {"ok": 1})
    mock_f = MagicMock()
    mock_f.name = "n"
    inst = MagicMock()
    inst.files.upload = MagicMock(return_value=mock_f)
    inst.files.delete = MagicMock()
    mock_client_class.return_value = inst
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    await use_case.execute("ag7", job_id, "session", "R", ["a.jpg", "b.jpg"])
    assert mock_gen.call_args is not None
    pair_kw = mock_gen.call_args.kwargs.get("training_pairs")
    assert pair_kw is not None and len(pair_kw) > 0


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_falls_back_to_style_urls(mock_compute, mock_gen, mock_client_class):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    db.save_style_image("ag8", "style.jpg")
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "st_job"
    db.save_job(job_id, "session", "PENDING", "k_st")
    mock_compute.return_value = (True, 0.5, 0.1)
    mock_gen.return_value = (fake_bytes, {"ok": 1})
    mock_f = MagicMock()
    mock_f.name = "n"
    inst = MagicMock()
    inst.files.upload = MagicMock(return_value=mock_f)
    inst.files.delete = MagicMock()
    mock_client_class.return_value = inst
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    await use_case.execute("ag8", job_id, "session", "R", ["a.jpg", "b.jpg"])
    su = mock_gen.call_args.kwargs.get("style_urls")
    assert su is not None and len(su) > 0


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_file_upload_falls_back_without_config(
    mock_compute, mock_gen, mock_client_class,
):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "up_job"
    db.save_job(job_id, "session", "PENDING", "k_up")
    mock_compute.return_value = (True, 0.5, 0.1)
    mock_gen.return_value = (fake_bytes, {"ok": 1})
    out_file = MagicMock()
    out_file.name = "ok"
    calls = {"n": 0}
    def upload_side_effect(*_a, **_k):
        calls["n"] += 1
        if calls["n"] % 2 == 1:
            raise OSError("config path failed")
        return out_file
    inst = MagicMock()
    inst.files.upload = MagicMock(side_effect=upload_side_effect)
    inst.files.delete = MagicMock()
    mock_client_class.return_value = inst
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    await use_case.execute("ag", job_id, "session", "R", ["a.jpg", "b.jpg"])
    assert calls["n"] == 4


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
@patch("os.path.exists", return_value=True)
@patch("os.remove", side_effect=OSError("cannot remove temp"))
async def test_process_hdr_tempfile_cleanup_ignores_remove_error(
    _mock_rm, _mock_exists, mock_compute, mock_gen, mock_client_class,
):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    db.save_training_pair("agRm", ["b1"], "")
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "rm_job"
    db.save_job(job_id, "session", "PENDING", "k_rm")
    mock_compute.return_value = (True, 0.5, 0.1)
    mock_gen.return_value = (fake_bytes, {"ok": 1})
    mock_f = MagicMock()
    mock_f.name = "n"
    inst = MagicMock()
    inst.files.upload = MagicMock(return_value=mock_f)
    inst.files.delete = MagicMock()
    mock_client_class.return_value = inst
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    await use_case.execute("agRm", job_id, "session", "R", ["a.jpg", "b.jpg"])


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_skips_incomplete_training_pair(
    mock_compute, mock_gen, mock_client_class,
):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    db.save_training_pair("agX", ["b1"], "")
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    job_id = "inc_job"
    db.save_job(job_id, "session", "PENDING", "k_inc")
    mock_compute.return_value = (True, 0.5, 0.1)
    mock_gen.return_value = (fake_bytes, {"ok": 1})
    mock_f = MagicMock()
    mock_f.name = "n"
    inst = MagicMock()
    inst.files.upload = MagicMock(return_value=mock_f)
    inst.files.delete = MagicMock()
    mock_client_class.return_value = inst
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    await use_case.execute("agX", job_id, "session", "R", ["a.jpg", "b.jpg"])
    assert not mock_gen.call_args.kwargs.get("training_pairs")
