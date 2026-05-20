export class BinaryDecoder {
  static async decodeMedia(file: File, expectedType?: 'image' | 'audio' | 'video', explicitMimeType?: string): Promise<{ blob: Blob; mimeType: string }> {
    const mimeType = explicitMimeType || file.type || BinaryDecoder.inferMimeType(file.name, expectedType) || 'application/octet-stream';
    const blob = file.type === mimeType
      ? file
      : new Blob([file], { type: mimeType });
    return { blob, mimeType };
  }

  static getMimeTypeFromExtension(extension: string): string {
    return BinaryDecoder.inferMimeType(extension.startsWith('.') ? `file${extension}` : `file.${extension}`);
  }

  private static inferMimeType(name: string, expectedType?: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    const byExt: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', webm: expectedType === 'audio' ? 'audio/webm' : 'video/webm',
      mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', avi: 'video/x-msvideo', mkv: 'video/x-matroska', vtt: 'text/vtt', json: 'application/json',
      bin: expectedType === 'image' ? 'image/png' : expectedType === 'audio' ? 'audio/wav' : expectedType === 'video' ? 'video/mp4' : 'application/octet-stream',
    };
    if (ext && byExt[ext]) return byExt[ext];
    if (expectedType === 'image') return 'image/png';
    if (expectedType === 'audio') return 'audio/wav';
    if (expectedType === 'video') return 'video/mp4';
    return '';
  }
}
