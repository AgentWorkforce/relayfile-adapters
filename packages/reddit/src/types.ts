export interface RedditSubreddit {
  id: string;
  name: string;
  title?: string;
  display_name_prefixed?: string;
  url?: string;
  public_description?: string;
  subscribers?: number;
  over18?: boolean;
  created_utc?: number;
  icon_img?: string;
  tracked?: boolean;
  [key: string]: unknown;
}

export interface RedditPost {
  id: string;
  post_id: string;
  thing_id?: string;
  subreddit: string;
  subreddit_name_prefixed?: string;
  title: string;
  author?: string;
  selftext?: string;
  url?: string;
  permalink?: string;
  created_utc?: number;
  edited?: boolean | number;
  score?: number;
  ups?: number;
  downs?: number;
  num_comments?: number;
  over_18?: boolean;
  spoiler?: boolean;
  stickied?: boolean;
  locked?: boolean;
  archived?: boolean;
  removed_by_category?: string | null;
  status?: 'active' | 'locked' | 'archived' | 'removed' | 'deleted';
  [key: string]: unknown;
}

export interface RedditSubredditIndexRow {
  id: string;
  title: string;
  updated: string;
  subscribers?: number;
}

export interface RedditPostIndexRow {
  id: string;
  title: string;
  updated: string;
  subreddit: string;
  score?: number;
  status?: string;
}
