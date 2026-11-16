// Read the real Python policy, rather than maintaining a weaker fixture copy.
const {spawnSync} = require('node:child_process');
const path = require('node:path');
module.exports = function policyFor(origin) {
  const url = new URL(origin);
  const headers = {Host:url.host, 'X-Forwarded-Proto':url.protocol === 'https:' ? 'https' : 'http'};
  const result = spawnSync(process.env.PYTHON || 'python3', ['-c',
    'import json,sys,http_security; print(http_security.content_security_policy(json.loads(sys.argv[1]),"127.0.0.1"))',
    JSON.stringify(headers)], {cwd:path.resolve(__dirname,'../..'), encoding:'utf8'});
  if (result.status !== 0) throw Error('Cannot read production CSP: ' + result.stderr);
  return result.stdout.trim();
};
