"""Bound HTTP work without letting long-lived live/lesson streams exhaust it."""
import os
import threading
from http.server import ThreadingHTTPServer


def capacity(name, default):
    try:
        return max(4, min(2048, int(os.environ.get(name, default))))
    except (TypeError, ValueError):
        return default


class BoundedHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True

    def __init__(self, address, handler, *, workers=None, streams=None):
        self._normal = threading.BoundedSemaphore(workers or capacity('EGE_HTTP_WORKERS', 128))
        self._streams = threading.BoundedSemaphore(streams or capacity('EGE_STREAM_WORKERS', 256))
        self._buckets = {}
        self._bucket_lock = threading.Lock()
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self._normal.acquire(blocking=False):
            try:
                request.settimeout(0.2)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n'
                                b'Retry-After: 2\r\nContent-Length: 0\r\n\r\n')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        with self._bucket_lock:
            self._buckets[request] = self._normal
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._release(request)
            raise

    def reserve_stream(self, request):
        """Call after stream authentication, before sending HTTP headers."""
        with self._bucket_lock:
            current = self._buckets.get(request)
            if current is self._streams:
                return True
            if current is not self._normal or not self._streams.acquire(blocking=False):
                return False
            self._buckets[request] = self._streams
            self._normal.release()
            return True

    def _release(self, request):
        with self._bucket_lock:
            bucket = self._buckets.pop(request, None)
        if bucket is not None:
            bucket.release()

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._release(request)
