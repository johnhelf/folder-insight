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

export interface DiskStats {
  total: number;
  used: number;
  available: number;
  mount_point: string;
  name: string;
}

export interface PhysicalDisk {
  number: number;
  name: string;
  partitions: string | null;
}

export interface ProgressUpdate {
  scanned_count: number;
  scanned_size: number;
  current_path: string;
  disk_name?: string;
  total_size?: number;
}
