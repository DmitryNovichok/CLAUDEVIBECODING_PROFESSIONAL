"""Bounded wire format shared by the web client and the isolated runner broker.

This module never executes programs. One request/response per Unix connection:
four-byte network-order length, followed by UTF-8 JSON. No pickle or shell text.
"""
import hashlib
import json
import socket
import struct
import time

VERSION = 1
RUNTIME = 'podman-rootless-v1'
MAX_CODE = 32768
MAX_INPUT = 16384
MAX_CASES = 12
MAX_REQUEST = 256 * 1024
MAX_RESPONSE = 512 * 1024
MAX_STDOUT = 20000
MAX_STDERR = 2000
CLIENT_TIMEOUT = 100
SOCKET_PATH = '/run/ege-python-verifier/runner.sock'


class ProtocolError(ValueError):
    pass


def program(code, inputs):
    if not isinstance(code, str) or not code.strip() or len(code.encode('utf-8')) > MAX_CODE or '\0' in code:
        raise ProtocolError('Недопустимый размер или содержимое программы')
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= MAX_CASES:
        raise ProtocolError('Недопустимое число тестов')
    if any(not isinstance(x, str) or len(x.encode('utf-8')) > MAX_INPUT or '\0' in x for x in inputs):
        raise ProtocolError('Недопустимые входные данные')
    return code, inputs


def digest(code, inputs):
    payload = json.dumps([code, inputs], ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ProtocolError('Повторное поле сообщения')
        value[key] = item
    return value


def recv_frame(connection, limit, timeout):
    deadline = time.monotonic() + timeout

    def take(size):
        chunks = bytearray()
        while len(chunks) < size:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError('Истекло время передачи')
            connection.settimeout(left)
            chunk = connection.recv(min(size - len(chunks), 65536))
            if not chunk:
                raise ProtocolError('Неполное сообщение')
            chunks.extend(chunk)
        return bytes(chunks)

    size = struct.unpack('!I', take(4))[0]
    if not 1 <= size <= limit:
        raise ProtocolError('Превышен размер сообщения')
    try:
        value = json.loads(take(size).decode('utf-8'), object_pairs_hook=_unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(ProtocolError('Недопустимое число')))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ProtocolError('Неверный JSON') from exc
    if not isinstance(value, dict):
        raise ProtocolError('Ожидается объект')
    return value


def send_frame(connection, value, limit, timeout=5):
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if not 1 <= len(data) <= limit:
        raise ProtocolError('Превышен размер сообщения')
    connection.settimeout(timeout)
    connection.sendall(struct.pack('!I', len(data)) + data)


def peer_uid(connection):
    if not hasattr(socket, 'SO_PEERCRED'):
        raise ProtocolError('Unix peer credentials недоступны')
    return struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
