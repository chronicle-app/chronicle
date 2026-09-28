/** Slack user profile from users.json */
export interface SlackUserProfile {
  title?: string;
  phone?: string;
  real_name?: string;
  real_name_normalized?: string;
  display_name?: string;
  display_name_normalized?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  image_24?: string;
  image_32?: string;
  image_48?: string;
  image_72?: string;
  image_192?: string;
  image_512?: string;
  bot_id?: string;
  api_app_id?: string;
}

/** Slack user from users.json */
export interface SlackUser {
  id: string;
  team_id: string;
  name: string;
  deleted: boolean;
  real_name?: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
  profile: SlackUserProfile;
  is_bot: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  updated: number;
}

/** Topic or purpose field on channels */
export interface SlackTopicOrPurpose {
  value: string;
  creator: string;
  last_set: number;
}

/** Channel from channels.json */
export interface SlackChannel {
  id: string;
  name: string;
  name_normalized?: string;
  created: number;
  creator: string;
  is_channel: boolean;
  is_private: boolean;
  is_archived: boolean;
  is_general: boolean;
  is_shared?: boolean;
  is_ext_shared?: boolean;
  num_members?: number;
  members?: string[] | null;
  topic?: SlackTopicOrPurpose;
  purpose?: SlackTopicOrPurpose;
}

/** DM conversation from dms.json */
export interface SlackDm {
  id: string;
  created: number;
  members: [string, string];
}

/** Multi-party IM from mpims.json */
export interface SlackMpim {
  id: string;
  name: string;
  created: number;
  creator?: string;
  is_mpim: boolean;
  members: string[];
  topic?: SlackTopicOrPurpose;
  purpose?: SlackTopicOrPurpose;
}

/** Slack file attachment on a message */
export interface SlackFile {
  id: string;
  name: string;
  title?: string;
  mimetype: string;
  filetype: string;
  pretty_type?: string;
  user: string;
  size: number;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
  created: number;
  timestamp: number;
  mode?: string;
  is_external?: boolean;
  original_h?: number;
  original_w?: number;
}

/** Slack message from dated JSON files */
export interface SlackMessage {
  client_msg_id?: string;
  type: string;
  subtype?: string;
  user?: string;
  text: string;
  ts: string;
  team?: string;
  thread_ts?: string;
  parent_user_id?: string;
  edited?: { user: string; ts: string };
  reactions?: Array<{ name: string; count: number; users: string[] }>;
  files?: SlackFile[];
  blocks?: any[];
  user_profile?: SlackUserProfile & { name?: string };
  username?: string;
  bot_id?: string;
}

/** Resolved user info for the user map */
export interface ResolvedUser {
  id: string;
  name?: string;
  handle?: string;
  teamId?: string;
}

/** Metadata about a conversation (channel, DM, or MPIM) */
export interface ConversationMeta {
  id: string;
  name?: string;
  type: 'channel' | 'dm' | 'mpim';
  members?: string[];
  isPrivate?: boolean;
  dirName: string;
}
