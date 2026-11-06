"""Atomic economic operations. Pricing/thermostat rules remain in server.py for now."""
from functools import wraps

# Called on rollback: in-memory projections must never retain uncommitted values.
on_rollback = lambda: None


def atomic(fn):
    @wraps(fn)
    def wrapped(db, *args, **kwargs):
        with db.lock:
            try:
                with db.transaction():
                    return fn(db, *args, **kwargs)
            except BaseException:
                on_rollback()
                raise
    return wrapped


def financial_path(path):
    return (path.startswith('/api/gifts') or path in ('/api/forbes', '/api/freeze/buy')
            or path.startswith('/api/admin/gifts')
            or path in ('/api/admin/bank', '/api/admin/thermo', '/api/admin/promo'))


class Rejected(Exception):
    pass


def atomic_response(handler, db, run):
    # Send HTTP success only AFTER durable commit. A disconnect cannot undo a sale.
    send = handler.send_json
    response = []
    def capture(obj, code=200, extra=None):
        response[:] = [obj, code, extra]
    handler.send_json = capture
    try:
        with db.lock:
            try:
                with db.transaction():
                    run()
                    if not response:
                        raise RuntimeError('financial endpoint did not return JSON')
                    if response[1] >= 400:
                        raise Rejected()
            except Rejected:
                on_rollback()
            except BaseException:
                on_rollback()
                raise
    finally:
        handler.send_json = send
    return send(response[0], response[1], response[2])


def thermostat_goal(avg, med, target, *, idx, earn, fee):
    """Demand/wealth-driven targets; no fixed prices, balances or payouts."""
    r, m = avg / target, (avg + med) / 2 / target
    return {'idx': min(idx[1], max(idx[0], m ** 0.5 if m > 0 else idx[0])),
            'earn': min(earn[1], max(earn[0], r ** -0.7 if r > 0 else earn[1])),
            'fee': round(fee[0] + (fee[1] - fee[0]) * min(1, max(0, (r - 0.6) / 1.4)), 3)}
