export interface DockerHubRepository {
  id: string;
  name: string;
  namespace: string;
  repository_type: string;
  status: number;
  status_description?: string;
  description?: string | null;
  is_private: boolean;
  star_count: number;
  pull_count: number;
  last_updated: string | null;
  last_modified?: string | null;
  date_registered?: string | null;
  affiliation?: string | null;
  media_types?: string[];
  content_types?: string[];
  categories?: unknown[];
  storage_size?: number;
  source?: string | null;
  html_url?: string;
  [key: string]: unknown;
}

export interface DockerHubTag {
  id: string;
  tag_id?: number | null;
  namespace: string;
  repository: string;
  name: string;
  full_size?: number | null;
  tag_status?: string | null;
  content_type?: string | null;
  media_type?: string | null;
  v2?: boolean;
  digest?: string | null;
  architecture?: string | null;
  os?: string | null;
  last_updated: string | null;
  tag_last_pushed?: string | null;
  tag_last_pulled?: string | null;
  last_updater_username?: string | null;
  image_count?: number | null;
  html_url?: string;
  [key: string]: unknown;
}

export interface DockerHubWebhook {
  id: string;
  webhook_id?: string | null;
  namespace: string;
  repository: string;
  name?: string | null;
  webhook_url?: string | null;
  active?: boolean;
  expect_final_callback?: boolean;
  creator?: string | null;
  last_called?: string | null;
  date_added?: string | null;
  hook_url?: string | null;
  [key: string]: unknown;
}

export interface DockerHubIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface DockerHubRepositoryIndexRow extends DockerHubIndexRow {
  namespace: string;
  name: string;
  repository_type: string;
  status: number;
  is_private: boolean;
  star_count: number;
  pull_count: number;
}

export interface DockerHubTagIndexRow extends DockerHubIndexRow {
  namespace: string;
  repository: string;
  name: string;
  digest?: string;
  tag_status?: string;
  architecture?: string;
  os?: string;
}

export interface DockerHubWebhookIndexRow extends DockerHubIndexRow {
  namespace: string;
  repository: string;
  webhook_id: string;
  active?: boolean;
  creator?: string;
  last_called?: string;
}
