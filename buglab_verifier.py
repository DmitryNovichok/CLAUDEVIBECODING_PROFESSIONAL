"""Independent Bug Lab verification. Never run pupil Python in the web process.

Only the configured local runner is trusted. Browser `runs`, `verified`, stars,
expected answers, container options and file paths are not accepted here.
"""
import os
import socket
import stat
import uuid

try:
    import pwd
except ImportError:  # The training site can still open locally on Windows.
    pwd = None

import buglab
import python_runner_protocol as wire


class VerifierUnavailable(RuntimeError):
    """Return HTTP 503 without updating attempts, completion or awards."""


class VerifierBusy(VerifierUnavailable):
    """Return HTTP 429/503 with Retry-After; do not save a failed attempt."""


class InvalidProgram(ValueError):
    """Return HTTP 400; never silently truncate code before verification."""


class Client:
    def __init__(self, path=wire.SOCKET_PATH, user='ege-python', timeout=wire.CLIENT_TIMEOUT):
        self.path, self.user, self.timeout = path, user, timeout

    def execute(self, code, inputs):
        if pwd is None or not hasattr(socket, 'AF_UNIX') or not hasattr(socket, 'SO_PEERCRED'):
            raise VerifierUnavailable('Независимая проверка требует настроенного Linux-исполнителя.')
        try:
            wire.program(code, inputs)
        except (wire.ProtocolError, UnicodeEncodeError) as exc:
            raise InvalidProgram(str(exc)) from exc
        nonce = uuid.uuid4().hex
        expected = wire.digest(code, inputs)
        request = {'v': wire.VERSION, 'nonce': nonce, 'digest': expected, 'code': code, 'inputs': inputs}
        try:
            uid = pwd.getpwnam(self.user).pw_uid
            info = os.lstat(self.path)
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != uid or info.st_mode & 0o007:
                raise wire.ProtocolError('Неверный владелец или права сокета')
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(5)
                connection.connect(self.path)
                if wire.peer_uid(connection) != uid:
                    raise wire.ProtocolError('Неверный исполнитель')
                wire.send_frame(connection, request, wire.MAX_REQUEST)
                reply = wire.recv_frame(connection, wire.MAX_RESPONSE, self.timeout)
            if reply.get('status') == 'busy':
                raise VerifierBusy('Проверка занята. Повторите через несколько секунд.')
            if (reply.get('v') != wire.VERSION or reply.get('status') != 'complete'
                    or reply.get('runtime') != wire.RUNTIME or reply.get('nonce') != nonce
                    or reply.get('digest') != expected or not isinstance(reply.get('runs'), list)
                    or len(reply['runs']) != len(inputs)):
                raise wire.ProtocolError('Неполный или неподтверждённый ответ исполнителя')
            return [_result(item) for item in reply['runs']]
        except VerifierBusy:
            raise
        except (OSError, KeyError, ValueError, TypeError, wire.ProtocolError) as exc:
            raise VerifierUnavailable('Независимая проверка временно недоступна. Результат не засчитан.') from exc


def _result(item):
    if not isinstance(item, dict) or set(item) != {'status', 'out', 'err', 'exit_code'}:
        raise wire.ProtocolError('Неверная форма результата')
    status = item['status']
    if status not in ('ok', 'error', 'timeout', 'output_limit', 'skipped'):
        raise wire.ProtocolError('Неизвестный результат')
    if (not isinstance(item['out'], str) or len(item['out'].encode('utf-8')) > wire.MAX_STDOUT * 3
            or not isinstance(item['err'], str) or len(item['err'].encode('utf-8')) > wire.MAX_STDERR * 3
            or type(item['exit_code']) is not int or not -255 <= item['exit_code'] <= 255
            or (status == 'ok' and (item['exit_code'] != 0 or item['err']))):
        raise wire.ProtocolError('Повреждённый результат')
    return {'out': item['out'], 'err': item['err'] if status == 'ok' else item['err'] or 'Программа не завершилась успешно',
            'timeout': status == 'timeout', 'skipped': status == 'skipped', 'status': status}


def verify(case, code, client=None):
    """The caller supplies a server-owned case, never client-provided tests.

    A return value means the independent service completed the check. Exceptions
    mean no verdict exists: callers must not update a DB row or award anything.
    """
    runs = (client or Client()).execute(code, list(case['inputs']))
    tests = buglab.check(case, runs)
    return {'ok': all(t['ok'] for t in tests), 'verified': True, 'provenance': 'server_python',
            'tests': tests, 'changed': buglab.changed_lines(case, code), 'par': case['par']}
