"""Policy scope, untrusted-header handling and the shipped resource inventory."""
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from unittest import mock

import http_security

ROOT = Path(__file__).resolve().parents[1]


def directives(policy):
    return {parts[0]: parts[1:] for chunk in policy.split(';') if (parts := chunk.strip().split())}


class ContentPolicyTest(unittest.TestCase):
    def test_script_and_connection_sources_are_finite_and_version_pinned(self):
        policy = directives(http_security.content_security_policy({'Host': 'school.example'}, '192.0.2.1'))
        self.assertEqual(policy['default-src'], ["'none'"])
        self.assertEqual(policy['script-src'], ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", http_security.PYODIDE_RUNTIME])
        self.assertEqual(policy['connect-src'], ["'self'", http_security.PYODIDE_RUNTIME,
                                              'ws://school.example/api/together/ws'])
        self.assertEqual(policy['worker-src'], ["'self'", 'blob:'])
        self.assertNotIn("'unsafe-eval'", http_security.CSP_BASELINE)
        for directive in ('script-src', 'connect-src', 'img-src', 'font-src', 'frame-src'):
            self.assertFalse(set(policy[directive]) & {'*', 'https:', 'http:', 'wss:', 'ws:'})

    def test_only_the_current_websocket_origin_is_added(self):
        headers = {'Host': '127.0.0.1:8000', 'X-Forwarded-Host': 'school.example:8443', 'X-Forwarded-Proto': 'https'}
        proxied = directives(http_security.content_security_policy(headers, '127.0.0.1'))
        direct = directives(http_security.content_security_policy(headers, '192.0.2.1'))
        self.assertIn('wss://school.example:8443/api/together/ws', proxied['connect-src'])
        self.assertIn('ws://127.0.0.1:8000/api/together/ws', direct['connect-src'])
        self.assertNotIn('wss://school.example:8443/api/together/ws', direct['connect-src'])
        ipv6 = directives(http_security.content_security_policy({'Host': '[::1]:8000'}, '::1'))
        self.assertIn('ws://[::1]:8000/api/together/ws', ipv6['connect-src'])

    def test_host_and_forwarded_host_cannot_inject_directives(self):
        baseline = directives(http_security.content_security_policy())
        for host in ('evil.example;script-src *', 'evil.example\r\nX-Injected: yes',
                     'evil.example/;script-src *', 'evil.example:bad', 'evil.example:0',
                     'evil.example@school.example', '*.example', 'school.example,evil.example'):
            for headers in ({'Host': host}, {'Host': 'localhost', 'X-Forwarded-Host': host}):
                got = directives(http_security.content_security_policy(headers, '127.0.0.1'))
                self.assertEqual(got, baseline, host)

    def test_operator_image_extension_is_exact_https_and_changes_only_images(self):
        origins = http_security.configured_image_origins('https://images.example, https://assets.example:8443/ https://images.example')
        self.assertEqual(origins, ('https://images.example', 'https://assets.example:8443'))
        before = directives(http_security.content_security_policy())
        with mock.patch.object(http_security, 'EXTRA_IMAGE_ORIGINS', origins):
            after = directives(http_security.content_security_policy())
        self.assertEqual(after.pop('img-src')[-2:], list(origins))
        before.pop('img-src')
        self.assertEqual(after, before)
        for bad in ('*', 'https:', 'http://images.example', 'https://*.example', 'https://host/path',
                    'https://host?x=1', 'https://user:password@host', "https://host;script-src 'unsafe-eval'"):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                http_security.configured_image_origins(bad)

    def test_all_shipped_remote_bank_images_are_in_the_image_allowlist(self):
        origins = set()
        class Images(HTMLParser):
            def handle_starttag(self, tag, attrs):
                if tag != 'img':
                    return
                for name, value in attrs:
                    if name in ('src', 'data-remote') and value and value.startswith(('https://', 'http://')):
                        url = urlsplit(value)
                        origins.add(url.scheme + '://' + url.netloc)
        parser = Images()
        def walk(value):
            if isinstance(value, dict):
                for v in value.values():
                    walk(v)
            elif isinstance(value, list):
                for v in value:
                    walk(v)
            elif isinstance(value, str) and '<' in value:
                parser.feed(value)
        paths = [ROOT / 'data/bank.js'] + [p for folder in ('data', 'course', 'pycourse')
                                         for p in (ROOT / folder).glob('*.json')]
        for path in paths:
            raw = path.read_text(encoding='utf-8')
            if path.suffix == '.js':
                raw = raw[raw.find('{'):raw.rfind('}') + 1]
            walk(json.loads(raw))
        self.assertTrue(origins)
        self.assertFalse(origins - set(http_security.BANK_IMAGE_ORIGINS),
                         'A new bank image origin must be reviewed before its policy is extended')

    def test_runtime_pin_and_opaque_frame_policy_are_not_relaxed(self):
        adapter = (ROOT / 'python-sandbox.js').read_text()
        self.assertIn(http_security.PYODIDE_RUNTIME, adapter)
        worker = (ROOT / 'py-worker.js').read_text()
        version = re.search(r"PYODIDE_VERSION\s*=\s*['\"]([^'\"]+)", worker).group(1)
        self.assertIn('/v' + version + '/full/', http_security.PYODIDE_RUNTIME)
        frame = (ROOT / 'python-sandbox.html').read_text()
        self.assertIn("connect-src __EGE_RUNTIME__", frame)
        self.assertNotIn("connect-src 'self'", frame)
        self.assertNotIn('allow-same-origin', adapter)
        self.assertNotIn("'unsafe-eval'", frame)


if __name__ == '__main__':
    unittest.main()
