export class BinaryDecoder {
  static async decodeMedia(file: File, expectedType?: 'image' | 'audio' | 'video', explicitMimeType?: string): Promise<{ blob: Blob; mimeType: string }> {
    const mimeType = explicitMimeType || file.type || BinaryDecoder.inferMimeType(file.name, expectedType) || 'application/octet-stream';
    return { blob: file, mimeType };
  }

  static getMimeTypeFromExtension(extension: string): string {
    return BinaryDecoder.inferMimeType(extension.startsWith('.') ? `file${extension}` : `file.${extension}`);
  }

  private static inferMimeType(name: string, expectedType?: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    const byExt: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: expectedType === 'audio' ? 'audio/webm' : 'video/webm',
      mp4: 'video/mp4', mov: 'video/quicktime', vtt: 'text/vtt', json: 'application/json',
    };
    return ext ? byExt[ext] || '' : '';
  }
}
