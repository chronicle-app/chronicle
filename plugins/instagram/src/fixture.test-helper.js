import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// A small synthetic Instagram data export. Every account, name, caption and id
// is made up. Files mix the export dialects the extractors read: older
// label_values entries, 2025 string_map_data/string_list_data entries wrapped
// in a single-key object, and 2026 bare lists.

export const SELF = { username: 'sam.rivera', name: 'Sam Rivera' };

// A 28-character share suffix that activity exports append to a shortcode.
export const SHARE_SUFFIX = 'abcdefghijklmnopqrstuvwxyzAB';

function write(root, file, value) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

/** Writes the export into `root` and returns `root`. */
export function writeInstagramExport(root, { withProfile = true } = {}) {
  if (withProfile) {
    write(root, 'personal_information/personal_information/personal_information.json', {
      profile_user: [
        {
          string_map_data: {
            Username: { value: SELF.username },
            Name: { value: SELF.name },
          },
        },
      ],
    });
  }

  write(root, 'connections/followers_and_following/following.json', {
    relationships_following: [
      {
        title: 'alexchen',
        string_list_data: [
          { href: 'https://www.instagram.com/alexchen', timestamp: 1_600_000_000 },
        ],
      },
      {
        title: '',
        media_list_data: [],
        string_list_data: [
          {
            href: 'https://www.instagram.com/jordanlee',
            value: 'jordanlee',
            timestamp: 1_753_473_126,
          },
        ],
      },
    ],
  });
  write(root, 'connections/followers_and_following/followers_1.json', [
    {
      string_list_data: [
        { value: 'alexchen', href: 'https://www.instagram.com/alexchen', timestamp: 1_610_000_000 },
      ],
    },
  ]);

  // Newer posts.json shape: media under label_values → "Media".
  write(root, 'your_instagram_activity/media/posts.json', [
    {
      timestamp: 1_725_000_000,
      label_values: [
        {
          label: 'Media',
          media: [
            {
              uri: 'media/posts/202409/333333333_c.mp4',
              creation_timestamp: 1_725_000_000,
              title: 'Sunset reel',
            },
          ],
        },
        { label: 'Reel metadata', dict: [{ label: 'Music', value: 'a track' }] },
      ],
    },
  ]);
  // Older flat shape: a carousel, a duplicate of the reel, and a uri that
  // escapes the export directory.
  write(root, 'your_instagram_activity/media/posts_1.json', [
    {
      title: 'Trail day',
      timestamp: 1_500_000_000,
      media: [
        { uri: 'media/posts/201707/111111111_a.jpg', creation_timestamp: 1_500_000_000, title: '' },
        { uri: 'media/posts/201707/222222222_b.jpg', creation_timestamp: 1_500_000_000, title: '' },
      ],
    },
    {
      media: [
        {
          uri: 'media/posts/202409/333333333_c.mp4',
          creation_timestamp: 1_725_000_000,
          title: 'duplicate of the reel',
        },
      ],
    },
    {
      media: [{ uri: '../../outside/escape.jpg', creation_timestamp: 1_500_000_001, title: 'x' }],
    },
  ]);
  write(root, 'your_instagram_activity/media/stories.json', {
    ig_stories: [
      {
        uri: 'media/stories/202409/4444444444.jpg',
        creation_timestamp: 1_725_300_000,
        title: 'Morning coffee',
        media_metadata: { photo_metadata: {} },
      },
      {
        uri: 'media/stories/202409/5555555555.mp4',
        creation_timestamp: 1_725_300_001,
        title: '',
        media_metadata: { video_metadata: {} },
      },
    ],
  });
  for (const file of [
    'media/posts/201707/111111111_a.jpg',
    'media/posts/201707/222222222_b.jpg',
    'media/posts/202409/333333333_c.mp4',
    'media/stories/202409/4444444444.jpg',
    'media/stories/202409/5555555555.mp4',
  ]) {
    write(root, file, 'media');
  }

  // A 1:1 thread whose folder name matches a followed handle, and a group
  // thread whose folder matches no one.
  write(root, 'your_instagram_activity/messages/inbox/alexchen_123/message_1.json', {
    title: 'Alex Chen',
    participants: [{ name: 'Alex Chen' }, { name: SELF.name }],
    messages: [
      {
        sender_name: 'Alex Chen',
        timestamp_ms: 1_700_000_002_000,
        content: 'Reacted ❤️ to your message ',
      },
      {
        sender_name: 'Alex Chen',
        timestamp_ms: 1_700_000_001_000,
        content: 'check this',
        share: {
          link: `https://www.instagram.com/p/AbCdEfGhIjk${SHARE_SUFFIX}/?igsh=xyz`,
          share_text: 'Pesto night',
          original_content_owner: 'cookbook.demo',
        },
      },
      {
        sender_name: SELF.name,
        timestamp_ms: 1_700_000_000_000,
        content: 'hello',
        reactions: [{ reaction: '❤️', actor: 'Alex Chen', timestamp: 1_700_000_100 }],
      },
    ],
  });
  write(root, 'your_instagram_activity/messages/inbox/hikeclub_456/message_1.json', {
    title: 'Hike Club',
    participants: [{ name: 'Alex Chen' }, { name: 'Jordan Lee' }, { name: SELF.name }],
    messages: [
      {
        sender_name: 'Jordan Lee',
        timestamp_ms: 1_690_000_000_000,
        content: 'See you at the trailhead',
        reactions: [{ reaction: '👍', actor: 'Alex Chen' }],
      },
    ],
  });

  // Likes: an older label_values entry with a mojibake caption, a liked reel,
  // and a 2025 string_list_data entry whose 👍 marker is not a caption.
  write(root, 'your_instagram_activity/likes/liked_posts.json', {
    likes_media_likes: [
      {
        timestamp: 1_725_000_000,
        label_values: [
          { label: 'URL', value: `https://www.instagram.com/p/C0ExampleA1${SHARE_SUFFIX}/` },
          { label: 'Caption', value: 'CafÃ© vibes' },
          { label: 'Owner', value: 'alexchen' },
        ],
      },
      {
        timestamp: 1_725_100_000,
        label_values: [{ label: 'URL', value: 'https://www.instagram.com/reel/D_reelcodeAB/' }],
      },
      {
        title: 'jordanlee',
        string_list_data: [
          {
            href: `https://www.instagram.com/p/DM8bqanyyqK${SHARE_SUFFIX}/`,
            value: 'ð\u009F\u0091\u008D',
            timestamp: 1_754_338_837,
          },
        ],
      },
    ],
  });
  // Story likes: one with a story URL, one 2025 entry with no story id.
  write(root, 'your_instagram_activity/story_interactions/story_likes.json', {
    story_activities_story_likes: [
      {
        timestamp: 1_725_200_000,
        label_values: [
          { label: 'URL', value: 'https://www.instagram.com/stories/alexchen/3141592653589793/' },
        ],
      },
      { title: 'jordanlee', string_list_data: [{ timestamp: 1_754_536_244 }] },
    ],
  });

  // Saves: a label_values collection, a 2025 header + item pair, and a
  // collection-less 2025 saved reel.
  write(root, 'your_instagram_activity/saved/saved_collections.json', {
    saved_saved_collections: [
      {
        label_values: [
          { label: 'Name', value: 'Recipes' },
          { label: 'Update time', timestamp_value: 1_720_000_000 },
          {
            title: 'Media',
            dict: [
              {
                dict: [
                  {
                    label: 'URL',
                    value: `https://www.instagram.com/p/AbCdEfGhIjk${SHARE_SUFFIX}/`,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        title: 'Collection',
        string_map_data: {
          Name: { value: 'Travel' },
          'Creation Time': { timestamp: 1_593_322_070 },
        },
      },
      {
        string_map_data: {
          Name: { href: 'https://www.instagram.com/p/CExample-B2/', value: 'travel.demo' },
          'Added Time': { timestamp: 1_593_803_507 },
        },
      },
    ],
  });
  write(root, 'your_instagram_activity/saved/saved_posts.json', {
    saved_saved_media: [
      {
        title: 'reels.demo',
        string_map_data: {
          'Saved on': {
            href: 'https://www.instagram.com/reel/DBRLoj_JRfv/',
            timestamp: 1_729_271_071,
          },
        },
      },
    ],
  });

  write(root, 'your_instagram_activity/comments/post_comments_1.json', [
    {
      string_map_data: {
        Comment: { value: 'Congrats!' },
        'Media Owner': { value: 'alexchen' },
        Time: { timestamp: 1_715_000_000 },
      },
    },
    {
      string_map_data: {
        Comment: { value: 'Congrats!' },
        'Media Owner': { value: 'alexchen' },
        Time: { timestamp: 1_716_000_000 },
      },
    },
  ]);
  write(root, 'your_instagram_activity/comments/reels_comments.json', {
    comments_reels_comments: [
      {
        string_map_data: {
          Comment: { value: 'Nice reel' },
          'Media Owner': { value: 'jordanlee' },
          Time: { timestamp: 1_717_000_000 },
        },
      },
    ],
  });

  write(root, 'logged_information/recent_searches/profile_searches.json', {
    searches_user: [
      {
        title: 'jordanlee',
        string_list_data: [
          { href: 'https://www.instagram.com/_u/jordanlee', timestamp: 1_782_417_396 },
        ],
      },
      {
        title: '',
        media_map_data: {},
        string_map_data: {
          Search: { href: '', value: 'alexchen', timestamp: 0 },
          Time: { href: '', value: '', timestamp: 1_754_540_952 },
        },
      },
    ],
  });
  write(root, 'logged_information/recent_searches/word_or_phrase_searches.json', {
    searches_keyword: [
      {
        title: '',
        media_map_data: {},
        string_map_data: {
          Search: { href: '', value: 'vegan ramen', timestamp: 0 },
          Time: { href: '', value: '', timestamp: 1_754_540_948 },
        },
      },
    ],
  });

  return root;
}

// A 2026 `Owner` dict naming an account.
const owner = username => ({
  title: 'Owner',
  dict: [
    {
      title: '',
      dict: [
        { label: 'URL', value: '' },
        { label: 'Name', value: '' },
        { label: 'Username', value: username },
      ],
    },
  ],
});

/** The 2026 bare-list saves dialect, with owners in nested `Owner` dicts. */
export function writeInstagramExport2026Saves(root) {
  write(root, 'personal_information/personal_information/personal_information.json', {
    profile_user: [{ string_map_data: { Username: { value: SELF.username } } }],
  });
  write(root, 'your_instagram_activity/saved/saved_collections.json', [
    {
      timestamp: 1_593_322_070,
      media: [],
      label_values: [
        { label: 'Name', value: 'Recipes' },
        { label: 'Update time', timestamp_value: 1_593_322_071 },
        {
          title: 'Media',
          dict: [
            {
              title: '',
              dict: [
                {
                  label: 'URL',
                  value: 'https://www.instagram.com/p/CExample-B2/',
                  href: 'https://www.instagram.com/p/CExample-B2/',
                },
                { label: 'Title', value: '' },
                owner('travel.demo'),
              ],
            },
          ],
        },
      ],
    },
  ]);
  write(root, 'your_instagram_activity/saved/saved_posts.json', [
    {
      timestamp: 1_772_741_878,
      media: [],
      label_values: [
        {
          label: 'URL',
          value: 'https://www.instagram.com/reel/DExampleC3x/',
          href: 'https://www.instagram.com/reel/DExampleC3x/',
        },
        { label: 'Title', value: '' },
        owner('reels.demo'),
      ],
    },
  ]);
  return root;
}
