import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Slack's `ts` for a time on 2024-01-01 (UTC). */
export const ts = (hour, minute = 0) => String(Date.UTC(2024, 0, 1, hour, minute) / 1000);

const message = (user, text, hour, extra = {}) => ({
  type: 'message',
  user,
  text,
  ts: ts(hour),
  team: 'T1',
  ...extra,
});

/**
 * A synthetic Slack export in the slackdump layout: users, a public channel, a
 * small private channel, a DM, and a group DM, each with one day file, plus one
 * downloaded attachment. Returns the export directory.
 */
export function writeSlackFixture(dir) {
  const json = (file, value) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(value));
  };

  json('users.json', [
    { id: 'U1', name: 'alex', team_id: 'T1', profile: { display_name: 'Alex' } },
    { id: 'U2', name: 'sam', team_id: 'T1', profile: { real_name: 'Sam Lee' } },
    // No username: the group DM's purpose supplies the handle.
    { id: 'U3', name: '', team_id: 'T1', profile: { real_name: 'riley' } },
  ]);
  json('channels.json', [
    { id: 'C1', name: 'general', is_private: false, members: ['U1', 'U2', 'U3'] },
    { id: 'C2', name: 'hiking', is_private: true, members: ['U1', 'U2'] },
    // No directory on disk, so it is skipped.
    { id: 'C3', name: 'empty', is_private: false },
  ]);
  json('dms.json', [{ id: 'D1', members: ['U1', 'U2'] }]);
  json('mpims.json', [
    {
      id: 'G1',
      name: 'mpdm-alex--sam--riley-1',
      is_mpim: true,
      members: ['U1', 'U2', 'U3'],
      purpose: { value: 'Group messaging with: @alex @sam @riley', creator: 'U1', last_set: 0 },
    },
  ]);

  json('general/2024-01-01.json', [
    message('U1', 'Morning, everyone', 9),
    message('U2', 'joined', 10, { subtype: 'channel_join' }),
    // Known only through the message's own profile.
    message('U4', 'Hi from a guest', 13, {
      user_profile: { name: 'jordan', real_name: 'Jordan Kim', display_name: 'Jordan' },
    }),
  ]);
  json('general/2024-01-02.json', [
    {
      type: 'message',
      subtype: 'bot_message',
      bot_id: 'B1',
      text: 'Deploy finished',
      ts: String(Date.UTC(2024, 0, 2, 8) / 1000),
    },
  ]);
  json('hiking/2024-01-01.json', [message('U2', 'Trail is open', 12)]);
  json('D1/2024-01-01.json', [
    message('U1', 'Photos from the hike', 11, {
      files: [
        {
          id: 'F1',
          name: 'summit.png',
          mimetype: 'image/png',
          filetype: 'png',
          user: 'U1',
          original_w: 800,
          original_h: 600,
        },
        { id: 'F2', name: 'map.pdf', mimetype: 'application/pdf', filetype: 'pdf', user: 'U1' },
      ],
    }),
  ]);
  json('mpdm-alex--sam--riley-1/2024-01-01.json', [message('U3', 'See you there', 10)]);

  mkdirSync(join(dir, 'D1', 'attachments'), { recursive: true });
  writeFileSync(join(dir, 'D1', 'attachments', 'F1-summit.png'), 'PNG');
  return dir;
}
