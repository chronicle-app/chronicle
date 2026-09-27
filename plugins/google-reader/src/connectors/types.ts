export interface GoogleReaderItem {
  id: string;
  title: string;
  published: number;
  updated: number;
  timestampUsec: string;
  crawlTimeMsec: string;
  categories: string[];
  alternate?: Array<{ href: string; type: string }>;
  content?: { content: string; direction?: string };
  summary?: { content: string; direction?: string };
  annotations?: Array<{
    content: string;
    author: string;
    userId: string;
  }>;
  author?: string;
  origin: {
    streamId: string;
    title: string;
    htmlUrl?: string;
  };
}

export interface GoogleReaderStream {
  id: string;
  title: string;
  author?: string;
  items: GoogleReaderItem[];
}

export interface UserInfo {
  user_id: string;
  email: string;
  profile_id: string;
  user_name: string;
  public_user_name: string;
  is_blogger_user: boolean;
  signup_time_sec: number;
  is_multi_login_enabled: boolean;
}
