"""Exercise updater preflight/rollback with a temporary app and fake system services."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools.check_release import write_manifest

ROOT = Path(__file__).resolve().parent.parent


class UpdateScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.app = self.root / 'app'
        self.release = self.root / 'release'
        (self.app / 'deploy').mkdir(parents=True)
        (self.app / 'deploy/backup.sh').write_text('#!/bin/sh\nexit 0\n')
        (self.app / 'server_data').mkdir()
        (self.app / 'server_data/trainer.db').write_text('synthetic-pupil-data')
        (self.app / 'server.py').write_text('# old code\n')
        (self.app / 'changelog.js').write_text('["1.0.0"]')
        (self.release / 'tools').mkdir(parents=True)
        (self.release / 'min').mkdir()
        (self.release / 'data').mkdir()
        (self.release / 'data/bank.js').write_text('synthetic-bank')
        (self.release / 'server.py').write_text('MIN_FILES = ("app.js",)\n')
        (self.release / 'together.py').write_text('# synthetic\n')
        (self.release / 'changelog.js').write_text('["2.59.1"]')
        (self.release / 'app.js').write_text('source')
        (self.release / 'min/app.js').write_text('minified')
        (self.release / 'admin-login.js').write_text('login')
        (self.release / 'tools/build_app.py').write_text('# synthetic build already checked\n')
        shutil.copy(ROOT / 'tools/check_release.py', self.release / 'tools/check_release.py')
        write_manifest(self.release)
        bindir = self.root / 'bin'
        bindir.mkdir()
        # Only this subprocess sees these fake tools. No real service, owner or network changes.
        wrapper = '#!' + sys.executable + '\n' + r'''
import os, sys, pathlib, shutil, subprocess, json, re
r=pathlib.Path(os.environ['EGE_TEST_ROOT']); app=r/'app'
cmd=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
with (r/'calls').open('a') as log:log.write(cmd+' '+json.dumps(args)+'\n')
if cmd=='python3':
    if args[0].endswith('github_release.py'):
        shutil.copytree(r/'release', args[2], dirs_exist_ok=True)
    elif args==['-', '8000']:
        text=(app/'changelog.js').read_text()
        print('1.0.0' if os.environ.get('EGE_TEST_STALE') else re.search(r'"([0-9.]+)"',text).group(1))
    else:sys.exit(subprocess.call([sys.executable]+args))
elif cmd=='rsync':
    src=pathlib.Path(args[-2]);dst=pathlib.Path(args[-1])
    shutil.copytree(src,dst,dirs_exist_ok=True,ignore=shutil.ignore_patterns('server_data','media','.git'))
elif cmd=='systemctl':
    marker=r/'restart'
    failed=os.environ.get('EGE_TEST_FAIL_RESTART') and not marker.exists()
    marker.touch()
    sys.exit(1 if failed else 0)
elif cmd not in ('chown','sleep'):sys.exit('unexpected fake tool')
'''
        for cmd in ('python3', 'rsync', 'systemctl', 'chown', 'sleep'):
            p = bindir / cmd
            p.write_text(wrapper)
            p.chmod(0o755)
        self.env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'],
                        EGE_TEST_ROOT=str(self.root), EGE_APP=str(self.app),
                        EGE_PREV=str(self.root / 'prev'), EGE_BACKUPS=str(self.root / 'backups'))

    def run_update(self):
        result = subprocess.run(['sh', str(ROOT / 'deploy/update.sh'), 'a' * 40], env=self.env,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual((self.app / 'server_data/trainer.db').read_text(), 'synthetic-pupil-data')
        return result

    def test_valid_release_installs(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('2.59.1', result.stdout)
        self.assertEqual((self.app / 'server.py').read_text(), 'MIN_FILES = ("app.js",)\n')

    def test_incomplete_minified_release_does_not_touch_app(self):
        (self.release / 'min/app.js').unlink()
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.app / 'server.py').read_text(), '# old code\n')
        self.assertNotIn('rsync ', (self.root / 'calls').read_text())
        self.assertFalse((self.root / 'restart').exists())

    def test_failed_restart_rolls_back(self):
        self.env['EGE_TEST_FAIL_RESTART'] = '1'
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Откат выполнен', result.stderr)
        self.assertEqual((self.app / 'server.py').read_text(), '# old code\n')

    def test_healthy_old_process_is_not_reported_as_new_release(self):
        self.env['EGE_TEST_STALE'] = '1'
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Откат выполнен', result.stderr)
        self.assertEqual((self.app / 'server.py').read_text(), '# old code\n')
