"""HTTP origin checks and the enforced, compatibility-conscious resource policy.

Inline script/style remain allowed for existing HTML bootstrap code. External
scripts and connections have an allowlist; JavaScript string evaluation does not.
The opaque Python frame applies its own, narrower policy on top of this one.
"""
import ipaddress
import os
import re
from urllib.parse import urlsplit

LOOPBACK = ('127.0.0.1', '::1')
PYODIDE_RUNTIME = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/'
# Only remote <img src> origins actually present in the shipped banks. References
# and video links opened in another tab do not require resource-policy exceptions.
BANK_IMAGE_ORIGINS = (
    'https://ege.fipi.ru', 'https://ucarecdn.com', 'https://www.vinformatika-edu.ru',
    'https://i.ibb.co', 'https://sun9-79.userapi.com', 'https://sun9-68.userapi.com',
    'https://sun7-21.userapi.com', 'https://sun9-40.userapi.com',
)


def origin_tuple(value):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or
                parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            return None
        return parsed.scheme, parsed.hostname.lower(), parsed.port if parsed.port is not None else (443 if parsed.scheme == 'https' else 80)
    except ValueError:
        return None


def request_origin(headers, peer):
    trusted_proxy = peer in LOOPBACK
    scheme = 'https' if trusted_proxy and headers.get('X-Forwarded-Proto', '').lower() == 'https' else 'http'
    host = (headers.get('X-Forwarded-Host') if trusted_proxy else None) or headers.get('Host', '')
    return origin_tuple(scheme + '://' + host)


def allows_mutation(headers, peer):
    # Native clients may omit Origin. A browser identifying a cross-site request
    # must never gain an exception by removing it or by using an opaque sandbox.
    origin = headers.get('Origin')
    if origin is not None:
        supplied = origin_tuple(origin)
        return bool(supplied and supplied == request_origin(headers, peer))
    return headers.get('Sec-Fetch-Site', '').lower() not in ('cross-site', 'same-site')


def _safe_origin(parsed):
    """Serialize a parsed origin without admitting CSP grammar from Host headers."""
    if not parsed:
        return None
    scheme, host, port = parsed
    try:
        host = host.encode('idna').decode('ascii')
        if ':' in host:
            host = '[' + ipaddress.IPv6Address(host).compressed + ']'
        elif not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9.])?', host):
            return None
        if not 1 <= port <= 65535:
            return None
    except (ValueError, UnicodeError):
        return None
    default_port = 443 if scheme == 'https' else 80
    return f'{scheme}://{host}' + (f':{port}' if port != default_port else '')


def configured_image_origins(value):
    """Operator-only extensions: exact HTTPS origins, never a scheme or wildcard."""
    result = []
    for item in re.split(r'[\s,]+', value.strip()):
        if not item:
            continue
        parsed = origin_tuple(item)
        source = _safe_origin(parsed)
        if not source or parsed[0] != 'https':
            raise ValueError('EGE_CSP_IMAGE_ORIGINS accepts only exact HTTPS origins')
        if source not in result:
            result.append(source)
    return tuple(result)


EXTRA_IMAGE_ORIGINS = configured_image_origins(os.environ.get('EGE_CSP_IMAGE_ORIGINS', ''))


def content_security_policy(headers=None, peer=None):
    """An enforced resource allowlist, including this request's exact WS endpoint.

    Explicit ws/wss avoids older browsers' inconsistent connect-src 'self' support.
    Forwarded host/scheme are accepted only from the same trusted loopback proxy as
    Origin checks. Invalid hosts cannot inject another directive into the header.
    """
    origin = _safe_origin(request_origin(headers or {}, peer))
    websocket = ((origin.replace('https://', 'wss://', 1) if origin.startswith('https://')
                  else origin.replace('http://', 'ws://', 1)) + '/api/together/ws') if origin else None
    connections = ["'self'", PYODIDE_RUNTIME]
    if websocket:
        connections.append(websocket)
    directives = {
        'default-src': ["'none'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'self'"],
        'form-action': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", PYODIDE_RUNTIME],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:'],
        'img-src': list(dict.fromkeys(["'self'", 'data:', 'blob:', *BANK_IMAGE_ORIGINS, *EXTRA_IMAGE_ORIGINS])),
        'connect-src': connections,
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'frame-src': ["'self'"],
        'media-src': ["'self'", 'blob:', 'data:'],
        'manifest-src': ["'self'"],
    }
    return '; '.join(name + ' ' + ' '.join(sources) for name, sources in directives.items())


# Safe fallback for integrations that have not yet passed request headers. The
# handler uses content_security_policy(...) to include an exact WS endpoint.
CSP_BASELINE = content_security_policy()
CSP_REPORT_ONLY = CSP_BASELINE  # compatibility for older test/deployment imports
