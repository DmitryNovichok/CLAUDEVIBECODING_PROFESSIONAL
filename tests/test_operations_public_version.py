"""A healthy old deployment must not satisfy acceptance of a newer release."""
import json
from pathlib import Path
import unittest
from unittest import mock

from deploy import acceptance
from http_security import content_security_policy


class PublicReleaseVersionTest(unittest.TestCase):
    def probe(self, actual, expected='2.74.0'):
        policy = content_security_policy(
            {'Host': 'example.test', 'X-Forwarded-Proto': 'https'}, '127.0.0.1')
        headers = {'Content-Security-Policy': policy,
                   'Strict-Transport-Security': 'max-age=31536000',
                   'X-Content-Type-Options': 'nosniff'}
        welcome = mock.Mock(status=200)
        welcome.read.return_value = b'<html></html>'
        welcome.getheader.side_effect = lambda name, default='': headers.get(name, default)
        health = mock.Mock(status=200)
        health.read.return_value = json.dumps({'ok': True, 'version': actual}).encode()
        connection = mock.Mock()
        connection.getresponse.side_effect = [welcome, health]
        with mock.patch('deploy.acceptance.http.client.HTTPSConnection', return_value=connection):
            checks = acceptance.https_checks('https://example.test', expected)
        return {check['check']: check for check in checks}

    def test_old_healthy_release_does_not_accept_candidate(self):
        checks = self.probe('2.72.0')
        self.assertEqual(checks['public_https_headers']['status'], 'pass')
        release = checks['public_running_release']
        self.assertEqual(release['status'], 'fail')
        self.assertEqual(release['detail'], {'expected_version': '2.74.0',
                                            'reported_version': '2.72.0'})

    def test_matching_public_release_passes(self):
        self.assertEqual(self.probe('2.74.0')['public_running_release']['status'], 'pass')

    def test_arbitrary_health_value_is_not_echoed_into_report(self):
        unexpected = 'unexpected-health-payload@example.invalid'
        checks = self.probe(unexpected)
        self.assertEqual(checks['public_running_release']['status'], 'fail')
        self.assertIsNone(checks['public_running_release']['detail']['reported_version'])
        self.assertNotIn(unexpected, json.dumps(checks))

    def test_installed_version_is_overridden_by_explicit_target(self):
        with mock.patch.object(acceptance, 'release_info', return_value={'version': '2.72.0'}), \
                mock.patch.object(acceptance, 'local_checks', return_value=[]), \
                mock.patch.object(acceptance, 'https_checks', return_value=[]) as probe:
            report = acceptance.inspect(Path('/unused/synthetic-release'),
                                        url='https://example.test', expected_version='2.74.0')
        probe.assert_called_once_with('https://example.test', '2.74.0')
        self.assertEqual(report['status'], 'pending')
        self.assertFalse(report['ok'])


if __name__ == '__main__':
    unittest.main()
