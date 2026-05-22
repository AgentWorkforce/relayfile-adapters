export const GRANOLA_PROVIDER = 'granola';
export const GRANOLA_PATH_ROOT = '/granola';

export interface GranolaNoteOwner {
  name: string | null;
  email: string;
}

export interface GranolaFolderMembership {
  id: string;
  object: 'folder';
  name: string;
  parent_folder_id: string | null;
}

export interface GranolaNote {
  id: string;
  object: 'note';
  title: string | null;
  owner: GranolaNoteOwner;
  created_at: string;
  updated_at: string;
  web_url: string;
  folder_membership: GranolaFolderMembership[];
  summary_text: string;
  summary_markdown: string | null;
  [key: string]: unknown;
}

export interface GranolaFolder {
  id: string;
  object: 'folder';
  name: string;
  parent_folder_id: string | null;
  [key: string]: unknown;
}
