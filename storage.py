"""SQLite transactions and one lock order for stateful operations."""
import threading
from contextlib import contextmanager

# SQLite already serializes writers. Reentrancy lets domain operations nest safely.
STATE_LOCK = threading.RLock()

class Transactional:
    @contextmanager
    def transaction(self):
        with self.lock:
            depth = self._tx_depth
            name = 'nested_%d' % depth
            self.conn.execute('BEGIN IMMEDIATE' if depth == 0 else 'SAVEPOINT ' + name)
            self._tx_depth += 1
            try:
                yield
                if depth == 0:
                    self.conn.commit()
                else:
                    self.conn.execute('RELEASE SAVEPOINT ' + name)
            except BaseException:
                if depth == 0:
                    self.conn.rollback()
                else:
                    self.conn.execute('ROLLBACK TO SAVEPOINT ' + name)
                    self.conn.execute('RELEASE SAVEPOINT ' + name)
                raise
            finally:
                self._tx_depth -= 1
