import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from backend.infrastructure.adapters import FirestoreAdapter, GCSBlobStorageAdapter, CloudTasksAdapter, RedisPubSubAdapter
import datetime
import asyncio

def test_firestore_adapter():
    with patch("google.cloud.firestore.Client") as mock_client:
        adapter = FirestoreAdapter()
        mock_db = MagicMock()
        adapter.db = mock_db
        
        # Test save_session
        adapter.save_session("session1", {"data": "test"})
        
        # Test get_session
        mock_doc = MagicMock()
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {"data": "test"}
        mock_db.collection().document().get.return_value = mock_doc
        assert adapter.get_session("session1") == {"data": "test"}
        
        # Test get_session missing
        mock_doc.exists = False
        assert adapter.get_session("session2") is None
        
        # Test save_processing_result
        adapter.save_processing_result("session1", {"result": "ok"})
        
        # Test get_processing_results
        mock_db.collection().document().collection().stream.return_value = [mock_doc]
        mock_doc.to_dict.return_value = {"result": "ok"}
        assert adapter.get_processing_results("session1") == [{"result": "ok"}]
        
        # Test save_job
        adapter.save_job("job1", "session1", "PENDING", "key1", result={"res": 1}, error="err")
        
        # Test get_job
        mock_doc.exists = True
        mock_db.collection().document().get.return_value = mock_doc
        assert adapter.get_job("job1") == {"result": "ok"}
        
        # Test get_job_by_idempotency_key
        mock_db.collection().where().limit().stream.return_value = [mock_doc]
        assert adapter.get_job_by_idempotency_key("key1") == {"result": "ok"}
        
        mock_db.collection().where().limit().stream.return_value = []
        assert adapter.get_job_by_idempotency_key("key1") is None
        
        # Test get_active_jobs
        mock_db.collection().where().stream.return_value = [mock_doc]
        assert adapter.get_active_jobs("session1") == [{"result": "ok"}]
        
        # Test get_jobs
        assert adapter.get_jobs([]) == []
        mock_db.collection().where().stream.return_value = [mock_doc]
        assert adapter.get_jobs(["job1", "job2"]) == [{"result": "ok"}]
        
        # Test get_agency_quota
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {"used": 10, "limit": 100}
        assert adapter.get_agency_quota("ag1") == {"used": 10, "limit": 100}
        
        mock_doc.exists = False
        assert adapter.get_agency_quota("ag2") == {"used": 0, "limit": 3000}
        
        # Test increment_quota_usage
        mock_doc.exists = True
        assert adapter.increment_quota_usage("ag1", 10) == True
        mock_doc.to_dict.return_value = {"used": 95, "limit": 100}
        assert adapter.increment_quota_usage("ag1", 10) == False
        
        mock_doc.exists = False
        assert adapter.increment_quota_usage("ag1", 10) == True
        assert adapter.increment_quota_usage("ag1", 4000) == False

def test_firestore_adapter_styles_training():
    with patch("google.cloud.firestore.Client") as mock_client:
        adapter = FirestoreAdapter()
        mock_db = MagicMock()
        adapter.db = mock_db
        
        # Test save_style_image
        adapter.save_style_image("ag1", "path/to/blob")
        
        # Test get_style_images
        with patch.object(adapter.db, 'collection') as mock_col:
            mock_doc = MagicMock()
            mock_doc.to_dict.return_value = {"blob_path": "path1"}
            mock_col.return_value.document.return_value.collection.return_value.order_by.return_value.limit.return_value.stream.return_value = [mock_doc]
            assert adapter.get_style_images("ag1") == ["path1"]
            
        # Test get_style_profiles
        with patch.object(adapter.db, 'collection') as mock_col:
            mock_doc = MagicMock()
            mock_doc.to_dict.return_value = {"blob_path": "path1", "created_at": datetime.datetime.now()}
            mock_col.return_value.document.return_value.collection.return_value.order_by.return_value.stream.return_value = [mock_doc]
            assert len(adapter.get_style_profiles("ag1")) == 1
        
        # Test delete_style_profile
        mock_doc.exists = True
        mock_db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = mock_doc
        assert adapter.delete_style_profile("ag1", "id1") == "path1"
        
        mock_doc.exists = False
        assert adapter.delete_style_profile("ag1", "id2") is None
        
        # Test save_training_pair
        adapter.save_training_pair("ag1", ["b1"], "f1")
        
        # Test check_session_code_availability
        mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
        mock_doc.exists = True
        mock_db.collection.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = []
        mock_doc.to_dict.return_value = {"created_at": datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=25)}
        assert adapter.check_session_code_availability("code") == True
        
        # what if has active jobs
        mock_db.collection.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = [mock_doc]
        assert adapter.check_session_code_availability("code") == False
        
        # what if < 24 hours
        mock_db.collection.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = []
        mock_doc.to_dict.return_value = {"created_at": datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)}
        assert adapter.check_session_code_availability("code") == False
        
        # Test reserve_session_code
        adapter.reserve_session_code("code")

def test_gcs_blob_storage_adapter():
    with patch("google.cloud.storage.Client"):
        adapter = GCSBlobStorageAdapter("test-bucket")
        mock_bucket = MagicMock()
        adapter.client.bucket.return_value = mock_bucket
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        
        assert adapter.upload_blob("sess1", "file.jpg", b"data", "image/jpeg") == "sess1/file.jpg"
        assert adapter.upload_blob_direct("path", b"data", "image/jpeg") == "path"
        
        mock_blob.download_as_bytes.return_value = b"data"
        assert adapter.download_blobs("sess1", ["file1"]) == [b"data"]
        
        adapter.delete_blob("path")
        
        # exception in delete_blob
        mock_blob.delete.side_effect = Exception("err")
        adapter.delete_blob("path")
        
        # generate_signed_url
        with patch("google.auth.default", return_value=(MagicMock(), "proj")):
            mock_blob.generate_signed_url.return_value = "https://url"
            assert adapter.generate_signed_url("path") == "https://url"
            
            # error in generate_signed_url
            mock_blob.generate_signed_url.side_effect = Exception("err")
            assert adapter.generate_signed_url("path").startswith("https://fake-download")
            
        with patch("google.auth.default", return_value=(MagicMock(), "proj")):
            mock_blob.generate_signed_url.side_effect = None
            mock_blob.generate_signed_url.return_value = "https://url"
            urls = adapter.generate_upload_urls("sess", ["file1.jpg"])
            assert len(urls) == 1
            
            # test HTTP -> HTTPS replacement
            mock_blob.generate_signed_url.return_value = "http://storage.googleapis.com/test"
            urls = adapter.generate_upload_urls("sess", ["file2.jpg"])
            assert urls[0]["url"] == "https://storage.googleapis.com/test"
            
            # generate_upload_urls exception
            mock_blob.generate_signed_url.side_effect = Exception("err")
            urls = adapter.generate_upload_urls("sess", ["file3.jpg"])
            assert urls[0]["url"].startswith("https://fake-upload")

def test_cloud_tasks_adapter():
    with patch("google.cloud.tasks_v2.CloudTasksClient"):
        adapter = CloudTasksAdapter("proj", "reg", "queue")
        adapter.enqueue_room_processing("sess", "room", ["photo1"])
        adapter.enqueue_job("job", "sess", "room", ["photo"])
        
        # test exception in enqueue_job
        adapter.client.create_task.side_effect = Exception("err")
        adapter.enqueue_job("job", "sess", "room", ["photo"])

@pytest.mark.asyncio
async def test_redis_pubsub_adapter():
    with patch("backend.infrastructure.adapters.Redis.from_url") as mock_from_url:
        mock_redis = MagicMock()
        mock_from_url.return_value = mock_redis
        adapter = RedisPubSubAdapter("redis://localhost")
        
        await adapter.connect()
        
        # publish_progress
        mock_redis.publish = AsyncMock()
        await adapter.publish_progress("sess", "room", "ok", {"res": 1})
        
        # close
        mock_redis.close = AsyncMock()
        await adapter.close()

