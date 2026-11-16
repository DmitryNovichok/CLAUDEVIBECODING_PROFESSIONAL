"""Authenticated bank delivery HTTP handlers, with no dependency on server globals."""
from dataclasses import dataclass
from typing import Any
import re
import bank_delivery

@dataclass(frozen=True)
class BankHTTPServices:
    app: Any
    student_by_token: Any
    locked_bank: bytes

class BankHTTPHandlers:
    def bank_http_services(self):
        raise NotImplementedError

    def serve_task_html(self, qs):
        """Ограниченные страницы условий; общая квота всех сессий аккаунта."""
        svc = self.bank_http_services()
        tok = self.headers.get("X-Token") or self.cookie("egest")
        student = svc.student_by_token(svc.app.db, tok, self.client_ip())[0]
        if not student:
            return self.err(401, "нужно войти")
        extra = {"Cache-Control": "private, no-store", "Vary": "Cookie, X-Token, Accept-Encoding"}
        if self.command != 'GET':
            return self.send_json({"error": "используйте GET"}, 405, dict(extra, Allow='GET'))
        if not svc.app.bank.ensure():
            return self.err(503, "банк заданий не собран")
        b = svc.app.bank
        # A reload replaces both dictionaries. Keep one consistent bank generation
        # while accounting/delivery runs, without holding the bank lock during I/O.
        with b.lock:
            html_pub, html_n = b.html_pub, b.html_n
        ids, issue, requested, next_offset = [], None, 0, None
        if 'n' in qs and 'ids' not in qs:
            n, offset = str(qs['n']), str(qs.get('offset', '0'))
            if not re.fullmatch(r'(?:[1-9]|1[0-9]|2[0-7])', n) or not re.fullmatch(r'[0-9]{1,6}', offset):
                issue = 'invalid_page'
            else:
                offset = int(offset)
                candidates = html_n.get(n, ())
                ids = candidates[offset:offset + bank_delivery.PAGE_SIZE]
                if offset + len(ids) < len(candidates):
                    next_offset = offset + len(ids)
                requested = len(ids)
        elif 'ids' in qs and 'n' not in qs and 'offset' not in qs:
            raw = str(qs['ids'])
            requested = raw.count(',') + 1
            if requested > bank_delivery.MAX_BATCH or len(raw) > 4096:
                issue = 'batch_size'
            else:
                ids = [i for i in dict.fromkeys(raw.split(',')) if i in html_pub]
        else:
            issue = 'invalid_page'
        decision = svc.app.delivery.check(student, ids, issue=issue, requested=requested)
        if decision.status == 429:
            extra['Retry-After'] = str(decision.retry_after)
            return self.send_json({"error": "Загрузка временно приостановлена. Попробуйте позже.",
                                   "retry_after": decision.retry_after}, 429, extra)
        if decision.status != 200:
            return self.send_json({"error": "Не удалось загрузить задания. Обновите страницу."}, decision.status, extra)
        return self.send_json({"html": {i: html_pub[i] for i in ids}, "next_offset": next_offset}, extra=extra)


    def serve_bank(self):
        svc = self.bank_http_services()
        if not svc.student_by_token(svc.app.db, self.cookie("egest"), self.client_ip())[0]:
            # без входа (код приглашения + ФИО) задания не отдаём
            return self.send_bytes(200, svc.locked_bank, "application/javascript; charset=utf-8", {"Cache-Control": "no-store"})
        if not svc.app.bank.ensure():
            return self.send_bytes(200, b"window.EGE_BANK = null;\n", "application/javascript; charset=utf-8",
                                   {"Cache-Control": "no-cache"})
        b = svc.app.bank
        if self.headers.get("If-None-Match") == b.etag:
            return self.send_bytes(304, b"", "text/plain", {"ETag": b.etag, "Cache-Control": "private, no-cache", "Vary": "Cookie, Accept-Encoding"})
        extra = {"ETag": b.etag, "Cache-Control": "private, no-cache", "Vary": "Cookie, Accept-Encoding"}
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            extra["Content-Encoding"] = "gzip"
            return self.send_bytes(200, b.public_gz, "application/javascript; charset=utf-8", extra)
        return self.send_bytes(200, b.public_raw, "application/javascript; charset=utf-8", extra)
