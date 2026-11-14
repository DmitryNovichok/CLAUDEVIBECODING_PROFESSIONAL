#!/usr/bin/env python3
"""Private GitHub releases: credentials stay out of command arguments and the web root."""
import getpass
import os
import re
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

DEFAULT_REPO = 'DmitryNovichok/CLAUDEVIBECODING_PROFESSIONAL'


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlparse(newurl)
        if url.scheme != 'https' or url.hostname not in ('api.github.com', 'codeload.github.com'):
            raise ValueError('Неожиданное перенаправление GitHub')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and url.hostname != urllib.parse.urlparse(req.full_url).hostname:
            redirected.remove_header('Authorization')
        return redirected


def repo_name():
    name = os.environ.get('EGE_REPO', DEFAULT_REPO)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', name):
        raise ValueError('Некорректное имя репозитория')
    return name


def token_path():
    return Path(os.environ.get('EGE_GH_TOKEN_FILE', '/root/.egeshka-github-token'))


def headers(token):
    if token and not re.fullmatch(r'[A-Za-z0-9_]+', token):
        raise ValueError('Некорректный формат токена GitHub')
    result = {'Accept': 'application/vnd.github+json', 'User-Agent': 'Egeshka-updater'}
    if token:
        result['Authorization'] = 'Bearer ' + token
    return result


def request(url, token):
    return urllib.request.build_opener(GitHubRedirect()).open(
        urllib.request.Request(url, headers=headers(token)), timeout=60)


def save_token(token, path, repo):
    # A rejected token must not replace an existing working credential.
    with request('https://api.github.com/repos/' + repo + '/git/refs?per_page=1', token):
        pass
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.egeshka-token-', delete=False) as f:
            tmp = Path(f.name)
            os.fchmod(f.fileno(), 0o600)
            f.write(token.encode('ascii'))
        os.replace(tmp, path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def extract(archive, dest):
    # GitHub archives contain one top directory. Never unpack links/devices or traversal paths.
    with tarfile.open(fileobj=archive, mode='r:gz') as tar:
        members = tar.getmembers()
        top = None
        for m in members:
            parts = PurePosixPath(m.name).parts
            if (not parts or m.name.startswith('/') or '\\' in m.name or '..' in parts or
                    not (m.isfile() or m.isdir())):
                raise ValueError('Небезопасный путь в архиве обновления')
            if top is None:
                top = parts[0]
            if parts[0] != top:
                raise ValueError('Неожиданная структура архива обновления')
        for m in members:
            parts = PurePosixPath(m.name).parts[1:]
            if not parts:
                continue
            p = dest.joinpath(*parts)
            p.resolve().relative_to(dest.resolve())
            if m.isdir():
                p.mkdir(parents=True, exist_ok=True)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(m) as src, p.open('wb') as out:
                    import shutil
                    shutil.copyfileobj(src, out)
                p.chmod(0o755 if m.mode & 0o111 else 0o644)


def download(sha, dest):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Нужен полный SHA коммита (40 символов)')
    path = token_path()
    token = path.read_text(encoding='ascii').strip() if path.exists() else ''
    if token and path.stat().st_mode & 0o077:
        raise ValueError('Файл токена доступен другим пользователям: установите chmod 600')
    with tempfile.TemporaryFile() as archive:
        with request(f'https://api.github.com/repos/{repo_name()}/tarball/{sha}', token) as response:
            import shutil
            shutil.copyfileobj(response, archive)
        archive.seek(0)
        extract(archive, dest)


def main():
    if sys.argv[1:] == ['--set-token']:
        token = getpass.getpass('Токен GitHub (Contents: Read-only, ввод скрыт): ').strip()
        if not token:
            raise ValueError('Пустой токен — ничего не изменено')
        save_token(token, token_path(), repo_name())
        print('Доступ проверен, токен сохранён вне папки сайта с правами 600.')
    elif len(sys.argv) == 3:
        download(sys.argv[1], Path(sys.argv[2]))
    else:
        raise ValueError('Использование: github_release.py --set-token или SHA ПАПКА')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as exc:
        sys.exit(f'GitHub: HTTP {exc.code}. Проверьте доступ Contents: Read-only и срок токена; сайт не изменён.')
    except urllib.error.URLError:
        sys.exit('Не удалось связаться с GitHub; сайт не изменён.')
    except (ValueError, OSError, tarfile.TarError):
        sys.exit('Не удалось проверить или распаковать обновление. Проверьте SHA, файл токена (chmod 600) и архив; сайт не изменён.')
