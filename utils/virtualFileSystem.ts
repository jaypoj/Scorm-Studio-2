import { FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemHandle, FileSystemWritableFileStream } from '../types';

class VirtualFileHandle implements FileSystemFileHandle {
  kind = 'file' as const;
  constructor(public name: string, private file: File) {}
  async getFile() { return this.file; }
  async createWritable(): Promise<FileSystemWritableFileStream> {
    const chunks: BlobPart[] = [];
    return {
      write: async (data: BlobPart) => { chunks.push(data); },
      seek: async () => undefined,
      truncate: async () => { chunks.length = 0; },
      close: async () => { this.file = new File(chunks, this.name, { type: this.file.type }); },
    };
  }
}

class VirtualDirectoryHandle implements FileSystemDirectoryHandle {
  kind = 'directory' as const;
  private entries = new Map<string, FileSystemHandle>();

  constructor(public name: string) {}

  addFile(pathParts: string[], file: File) {
    const [head, ...tail] = pathParts;
    if (!head) return;
    if (tail.length === 0) {
      this.entries.set(head, new VirtualFileHandle(head, file));
      return;
    }

    let dir = this.entries.get(head) as VirtualDirectoryHandle | undefined;
    if (!dir || dir.kind !== 'directory') {
      dir = new VirtualDirectoryHandle(head);
      this.entries.set(head, dir);
    }
    dir.addFile(tail, file);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    const existing = this.entries.get(name);
    if (existing?.kind === 'file') return existing as FileSystemFileHandle;
    if (options?.create) {
      const handle = new VirtualFileHandle(name, new File([], name));
      this.entries.set(name, handle);
      return handle;
    }
    throw new DOMException(`File not found: ${name}`, 'NotFoundError');
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
    const existing = this.entries.get(name);
    if (existing?.kind === 'directory') return existing as FileSystemDirectoryHandle;
    if (options?.create) {
      const handle = new VirtualDirectoryHandle(name);
      this.entries.set(name, handle);
      return handle;
    }
    throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for (const value of this.entries.values()) yield value;
  }

  async removeEntry(name: string): Promise<void> {
    this.entries.delete(name);
  }
}

export function createVirtualFileSystem(files: FileList): FileSystemDirectoryHandle {
  const root = new VirtualDirectoryHandle('sandbox-root');
  Array.from(files).forEach(file => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    root.addFile(relativePath.split('/').filter(Boolean), file);
  });
  return root;
}
