import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SystemInfo } from '../dist/index.js';

/** A SystemInfo with fixed identity, so nothing is read from the host. */
class FixtureSystemInfo extends SystemInfo {
  async getRealName() {
    return 'Exämple  Person';
  }

  getHostname() {
    return 'Example-Host.tail0000.ts.net';
  }

  getUsername() {
    return 'example';
  }

  async getPlatformIdentifier() {
    return 'fixture-platform-example';
  }
}

test('derives machine names and agent ids from system identity', async () => {
  assert.equal(SystemInfo.normalizeMachineName(' PAT-MBP.local '), 'pat-mbp');
  assert.equal(SystemInfo.normalizeMachineName('pat-mbp'), 'pat-mbp');

  const info = new FixtureSystemInfo();
  const platform = process.platform === 'darwin' ? 'macos' : process.platform;
  assert.equal(info.getMachineName(), 'example-host');
  assert.equal(await info.generateAgentId('things'), `things-exmple-person-${platform}`);
  assert.deepEqual(await info.getAgentInfo(), {
    id: `chronicle-exmple-person-${platform}`,
    realName: 'Exämple  Person',
    username: 'example',
    hostname: 'Example-Host.tail0000.ts.net',
    platform: process.platform,
    platformIdentifier: 'fixture-platform-example',
  });
});

test('loads the platform implementation without reading the host', async t => {
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
    t.skip(`no SystemInfo for ${process.platform}`);
    return;
  }
  // Constructing one reads nothing; only its methods query the host.
  assert.ok((await SystemInfo.getInstance()) instanceof SystemInfo);
});
