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
