import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Seconds since the Unix epoch; 1750000000 is 2025-06-15T15:06:40Z.
export const T0 = 1_750_000_000;

function writeJson(root, relativePath, value) {
  const file = join(root, ...relativePath.split('/'));
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * Write a small synthetic Facebook export (the current direct layout) under
 * `root`: a profile, one Messenger thread split over two files, both
 * likes-and-reactions dialects, a comment, and search history. Every name,
 * URL and id is made up.
 */
export function writeFacebookExport(root) {
  writeJson(root, 'personal_information/profile_information/profile_information.json', {
    profile_v2: {
      name: { full_name: 'Sam Rivera' },
      emails: { emails: ['sam@example.com'] },
      username: 'sam.rivera.example',
    },
  });

  const thread = 'your_facebook_activity/messages/inbox/alexmorgan_1234567890';
  writeJson(root, `${thread}/message_1.json`, {
    participants: [{ name: 'Alex Morgan' }, { name: 'Sam Rivera' }],
    title: 'Alex Morgan',
    messages: [
      {
        sender_name: 'Alex Morgan',
        timestamp_ms: T0 * 1000 + 5000,
        // "Here’s the map" as Meta writes it: each UTF-8 byte of the curly
        // apostrophe as its own code point.
        content: 'Hereâ\u0080\u0099s the map',
        photos: [
          { uri: 'messages/inbox/alexmorgan_1234567890/photos/1.jpg', creation_timestamp: T0 },
        ],
      },
      { timestamp_ms: T0 * 1000 + 4000, content: 'No sender' },
    ],
  });
  writeJson(root, `${thread}/message_2.json`, {
    participants: [{ name: 'Alex Morgan' }, { name: 'Sam Rivera' }],
    messages: [
      { sender_name: 'Sam Rivera', timestamp_ms: T0 * 1000 + 3000, content: 'Trail at 9?' },
    ],
  });

  writeJson(root, 'your_facebook_activity/comments_and_reactions/likes_and_reactions.json', [
    {
      timestamp: T0,
      fbid: '100200300',
      label_values: [
        { label: 'Reaction', value: 'LIKE' },
        { label: 'URL', value: 'https://www.facebook.com/alex.morgan.example/posts/555000111' },
        { label: 'Name', value: 'Alex Morgan' },
      ],
    },
    {
      timestamp: T0 + 60,
      fbid: '100200301',
      label_values: [
        { label: 'Reaction', value: 'LOVE' },
        { label: 'URL', value: 'https://www.facebook.com/alex.morgan.example/posts/555000222' },
        { label: 'Name', value: 'Alex Morgan' },
      ],
    },
  ]);
  writeJson(root, 'your_facebook_activity/comments_and_reactions/likes_and_reactions_1.json', [
    {
      timestamp: T0 + 120,
      title: "Sam Rivera reacted to Alex Morgan's post.",
      data: [{ reaction: { reaction: 'WOW', actor: 'Sam Rivera' } }],
    },
  ]);
  writeJson(root, 'your_facebook_activity/comments_and_reactions/comments.json', {
    comments_v2: [
      {
        timestamp: T0 + 100,
        title: "Sam Rivera commented on Alex Morgan's post.",
        data: [{ comment: { timestamp: T0 + 100, comment: 'Great photo', author: 'Sam Rivera' } }],
      },
    ],
  });

  writeJson(root, 'logged_information/search/your_search_history.json', {
    searches_v2: [
      {
        timestamp: T0 + 200,
        title: 'You searched Facebook',
        data: [{ text: 'trail running' }],
        attachments: [{ data: [{ text: '"trail running shoes"' }] }],
      },
      { timestamp: T0 + 300, title: 'You searched Facebook', data: [] },
    ],
  });

  return root;
}
