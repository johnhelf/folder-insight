export interface FileNode {
  name: string;
  path: string;
  size: number | null;
  allocated_size: number | null;
  is_dir: boolean;
  is_restricted: boolean;
  file_count: number;
  children: FileNode[] | null;
  modified: number | null;
}

export interface SizeUpdate {
  path: string;
  size: number;
  allocated_size: number;
  is_restricted: boolean;
  file_count: number;
}

export interface StructureUpdate {
  path: string;
  children: FileNode[];
}

export interface BatchStructureUpdate {
  updates: StructureUpdate[];
}

export interface BatchSizeUpdate {
  updates: SizeUpdate[];
}
