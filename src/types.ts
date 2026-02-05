export interface FileNode {
  name: string;
  path: string;
  size: number | null;
  allocated_size: number | null;
  is_dir: boolean;
  is_restricted: boolean;
  file_count: number;
  children: FileNode[] | null;
}

export interface SizeUpdate {
  path: string;
  size: number;
  allocated_size: number;
  is_restricted: boolean;
  file_count: number;
}
