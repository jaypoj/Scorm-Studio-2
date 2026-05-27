const splitNarrationIntoCaptionChunks = (text: string) => {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  if (!normalized) return [];

  const sentenceLikeChunks = normalized
    .split(/(?<=[.!?])\s+/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  const output: string[] = [];
  for (const sentence of sentenceLikeChunks) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= 14) {
      output.push(sentence);
      continue;
    }

    let current: string[] = [];
    for (const word of words) {
      current.push(word);
      if (current.length >= 10 && /[,;:]$/.test(word)) {
        output.push(current.join(' '));
        current = [];
      } else if (current.length >= 14) {
        output.push(current.join(' '));
        current = [];
      }
    }
    if (current.length > 0) output.push(current.join(' '));
  }

  return output.filter(Boolean);
};

const toTimestamp = (seconds: number) => {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const stripCaptionFences = (value: string) => value
  .trim()
  .replace(/^```(?:webvtt|vtt)?\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();

const normalizeCaptionTimestamp = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  const match = normalized.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return '';
  const hours = match[1] || '00';
  const minutes = match[2] || '00';
  const seconds = match[3] || '00';
  const ms = (match[4] || '000').padEnd(3, '0').slice(0, 3);
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds}.${ms}`;
};

export const sanitizeWebVtt = (value: string) => {
  const withoutFences = stripCaptionFences(value || '');
  const webvttIndex = withoutFences.search(/\bWEBVTT\b/i);
  const source = webvttIndex >= 0 ? withoutFences.slice(webvttIndex) : withoutFences;
  const lines = source.replace(/\r/g, '').split('\n');
  const cues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.includes('-->')) continue;

    const [rawStart, rawEndWithSettings = ''] = line.split('-->');
    const rawEnd = rawEndWithSettings.trim().split(/\s+/)[0] || '';
    const start = normalizeCaptionTimestamp(rawStart);
    const end = normalizeCaptionTimestamp(rawEnd);
    if (!start || !end) continue;

    const textLines: string[] = [];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (next.includes('-->')) {
        i--;
        break;
      }
      if (!/^WEBVTT$/i.test(next) && !/^NOTE\b/i.test(next) && !(textLines.length === 0 && /^\d+$/.test(next))) textLines.push(next);
      i++;
    }

    const cueText = textLines
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cueText) cues.push(`${start} --> ${end}\n${cueText}`);
  }

  return cues.length ? `WEBVTT\n\n${cues.join('\n\n')}` : '';
};

export const readAudioDurationSeconds = (file: Blob) => new Promise<number>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  const cleanup = () => {
    URL.revokeObjectURL(url);
    audio.removeAttribute('src');
  };

  audio.preload = 'metadata';
  audio.onloadedmetadata = () => {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    cleanup();
    resolve(duration);
  };
  audio.onerror = () => {
    cleanup();
    reject(new Error('Could not read audio duration for caption timing.'));
  };
  audio.src = url;
});

export const estimateNarrationDurationSeconds = (text: string) => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  // Rough instructional narration pace: ~145 words per minute.
  return Math.max(2, (words / 145) * 60);
};

export const buildVttFromNarration = (text: string, durationSeconds: number) => {
  const chunks = splitNarrationIntoCaptionChunks(text);
  if (chunks.length === 0) return 'WEBVTT\n\n';

  const wordsPerChunk = chunks.map(chunk => chunk.split(/\s+/).filter(Boolean).length);
  const totalWords = wordsPerChunk.reduce((sum, count) => sum + count, 0) || chunks.length;
  const totalDuration = Math.max(durationSeconds, chunks.length * 1.5);

  let cursor = 0;
  const cues = chunks.map((chunk, index) => {
    const share = wordsPerChunk[index] / totalWords;
    const cueDuration = index === chunks.length - 1
      ? Math.max(0.8, totalDuration - cursor)
      : Math.max(1.2, share * totalDuration);
    const start = cursor;
    const end = index === chunks.length - 1 ? totalDuration : Math.min(totalDuration, cursor + cueDuration);
    cursor = end;
    return `${toTimestamp(start)} --> ${toTimestamp(end)}\n${chunk}`;
  });

  return `WEBVTT\n\n${cues.join('\n\n')}`;
};
