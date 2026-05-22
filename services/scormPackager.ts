import JSZip from 'jszip';
import { FileSystemDirectoryHandle, MediaItem, Question, ScormProject, Topic, WelcomePage, LearningObjectivesPage } from '../types';

type Page = Topic | WelcomePage | LearningObjectivesPage;
type ImageExportDiagnostic = {
  pageId?: string;
  context: 'media-asset' | 'external-media' | 'inline-content' | 'legacy-page-image';
  storageId?: string;
  source?: string;
  originalName?: string;
  originalMimeType?: string;
  packagedHref?: string;
  convertedToPng?: boolean;
  status: 'packaged' | 'unresolved';
  reason?: string;
};
type ImageExportReport = {
  generatedAt: string;
  summary: {
    total: number;
    packaged: number;
    unresolved: number;
    convertedToPng: number;
  };
  images: ImageExportDiagnostic[];
};

const escapeXml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));
const escapeHtml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]!));
const safeId = (value: string) => value.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();

const getMediaKind = (media: MediaItem) => (media.type || '').toLowerCase();
const withoutExtension = (value: string) => value.replace(/\.[^.]+$/, '');
const getExtension = (value: string) => value.split('.').pop()?.toLowerCase() || '';
const normalizeExtension = (value: string) => {
  const ext = value.toLowerCase().replace(/^\./, '');
  if (ext === 'jpeg' || ext === 'jfif' || ext === 'pjpeg' || ext === 'pjp') return 'jpg';
  if (ext === 'svg+xml') return 'svg';
  if (ext === 'quicktime') return 'mov';
  if (ext === 'mpeg') return 'mp3';
  return ext;
};
const extensionFromMimeType = (mimeType = '') => {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return map[normalized] || normalizeExtension(normalized.split('/')[1] || '');
};
const mimeTypeFromExtension = (fileName = '') => {
  const ext = normalizeExtension(getExtension(fileName));
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    webm: 'video/webm',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
  };
  return map[ext] || '';
};
const getPackageFileName = (storageId: string, originalName: string, mimeType = '', forcedExtension?: string) => {
  const ext = forcedExtension || extensionFromMimeType(mimeType) || normalizeExtension(getExtension(originalName)) || 'bin';
  return `${safeId(storageId || withoutExtension(originalName))}.${ext}`;
};
const getAssetSrc = (assetMap: Map<string, string>, media: MediaItem) =>
  assetMap.get(media.storageId) ||
  assetMap.get(media.storageId?.toLowerCase?.() || '') ||
  media.url ||
  '';

const summarizeSource = (value = '') =>
  value.length > 260 ? `${value.slice(0, 220)}...${value.slice(-24)}` : value;

const webSafeImageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg']);
const riskyImageExtensions = new Set(['webp', 'avif', 'bmp', 'dib', 'tif', 'tiff', 'jfif', 'pjpeg', 'pjp', 'heic', 'heif']);

const getMediaExtension = (fileName = '', mimeType = '') => {
  const ext = normalizeExtension(getExtension(fileName));
  if (ext && ext !== 'bin') return ext;
  return extensionFromMimeType(mimeType) || ext;
};

const withMimeType = (file: File, mimeType = '', name = file.name) => {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  if (!normalized || file.type === normalized) return file;
  return new File([file], name, { type: normalized });
};

const sniffImageMimeType = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (ascii.slice(4, 12) === 'ftypavif' || ascii.slice(4, 12) === 'ftypavis') return 'image/avif';
  return '';
};

const isImageAsset = (metadata: any, file: File) => {
  const mimeType = String(metadata?.mimeType || file.type || '').toLowerCase();
  const fileName = String(metadata?.originalName || metadata?.original_name || metadata?.fileName || metadata?.filename || file.name || '');
  const ext = getMediaExtension(fileName, mimeType);
  return mimeType.startsWith('image/') || webSafeImageExtensions.has(ext) || riskyImageExtensions.has(ext);
};

const shouldConvertImageForScorm = (metadata: any, file: File) => {
  const mimeType = String(metadata?.mimeType || file.type || '').toLowerCase().split(';')[0].trim();
  const fileName = String(metadata?.originalName || metadata?.original_name || metadata?.fileName || metadata?.filename || file.name || '');
  const ext = getMediaExtension(fileName, mimeType);
  if (!isImageAsset(metadata, file)) return false;
  if (mimeType === 'image/svg+xml' || ext === 'svg') return false;
  if (mimeType === 'image/gif' || ext === 'gif') return false;
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') return false;
  return riskyImageExtensions.has(ext) || mimeType.startsWith('image/') || !webSafeImageExtensions.has(ext);
};

const convertImageToPng = async (file: File): Promise<File | null> => {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width || 1;
    canvas.height = bitmap.height || 1;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return new File([blob], `${withoutExtension(file.name || 'image')}.png`, { type: 'image/png' });
  } catch (error) {
    console.warn(`Unable to convert ${file.name || 'image'} to PNG for SCORM export.`, error);
    return null;
  }
};

const getImageFileFromUrl = async (media: MediaItem): Promise<File | null> => {
  if (!media.url || getMediaKind(media) !== 'image') return null;
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(media.url)) return null;

  try {
    const response = await fetch(media.url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) return null;
    const extension = extensionFromMimeType(mimeType) || 'png';
    return new File([blob], `${media.storageId || media.id || 'image'}.${extension}`, { type: mimeType });
  } catch (error) {
    console.warn(`Unable to package external image ${media.storageId || media.title || media.url}.`, error);
    return null;
  }
};

const getFileNameFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : '';
  } catch {
    return '';
  }
};

const fetchInlineImageFile = async (src: string, fallbackName: string): Promise<File | null> => {
  if (!/^(https?:|data:image\/|blob:)/i.test(src)) return null;

  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) return null;
    const extension = extensionFromMimeType(mimeType) || normalizeExtension(getExtension(fallbackName)) || 'png';
    return new File([blob], fallbackName || `inline-image.${extension}`, { type: mimeType });
  } catch (error) {
    console.warn(`Unable to package inline image ${src}.`, error);
    return null;
  }
};

const packageInlineContentImages = async (
  page: Page,
  zip: JSZip,
  inlineAssetHrefs: string[],
  inlineImageCache: Map<string, string>,
  imageDiagnostics: ImageExportDiagnostic[],
  assetFiles: Map<string, { name: string; href: string; file: File }>
) => {
  if (!page.content?.includes('<img')) return page.content || '';

  const template = document.createElement('template');
  template.innerHTML = page.content;
  const images = Array.from(template.content.querySelectorAll('img[src]'));

  for (const [index, image] of images.entries()) {
    const src = image.getAttribute('src') || '';
    if (!src) continue;

    const cachedHref = inlineImageCache.get(src);
    if (cachedHref) {
      image.setAttribute('src', cachedHref);
      image.removeAttribute('srcset');
      image.removeAttribute('data-src');
      image.removeAttribute('data-original');
      image.setAttribute('referrerpolicy', 'no-referrer');
      continue;
    }

    const storageId = `inline-${safeId(page.id)}-${index + 1}`;
    const localMediaName = src.replace(/^(\.\/|\.\.\/)?media\//i, '');
    const localAsset = localMediaName !== src
      ? assetFiles.get(localMediaName) || assetFiles.get(localMediaName.toLowerCase())
      : null;
    const sourceName = localAsset?.name || getFileNameFromUrl(src) || `${storageId}.png`;
    const sourceFile = localAsset?.file || await fetchInlineImageFile(src, sourceName);
    if (!sourceFile) {
      image.setAttribute('referrerpolicy', 'no-referrer');
      imageDiagnostics.push({
        pageId: page.id,
        context: 'inline-content',
        storageId,
        source: summarizeSource(src),
        status: 'unresolved',
        reason: 'The image was embedded as an inline/external URL but could not be fetched into the SCORM package. If it is a blob URL, it likely expired after browser refresh. If it is an external URL, the host may block browser downloads.',
      });
      continue;
    }

    const sourceMimeType = sourceFile.type || mimeTypeFromExtension(sourceFile.name) || await sniffImageMimeType(sourceFile);
    let packageFile = withMimeType(sourceFile, sourceMimeType, sourceFile.name);
    let packageMimeType = packageFile.type;
    let forcedExtension: string | undefined;
    if (shouldConvertImageForScorm({}, packageFile)) {
      const converted = await convertImageToPng(packageFile);
      if (converted) {
        packageFile = converted;
        packageMimeType = 'image/png';
        forcedExtension = 'png';
      }
    }

    const packagedName = getPackageFileName(storageId, sourceFile.name, packageMimeType, forcedExtension);
    const packagedHref = `media/${packagedName}`;
    zip.file(packagedHref, packageFile);
    inlineAssetHrefs.push(packagedHref);
    inlineImageCache.set(src, packagedHref);

    image.setAttribute('src', packagedHref);
    image.removeAttribute('srcset');
    image.removeAttribute('data-src');
    image.removeAttribute('data-original');
    image.setAttribute('referrerpolicy', 'no-referrer');
    imageDiagnostics.push({
      pageId: page.id,
      context: 'inline-content',
      storageId,
      source: summarizeSource(src),
      originalName: sourceFile.name,
      originalMimeType: packageFile.type || sourceFile.type,
      packagedHref,
      convertedToPng: forcedExtension === 'png',
      status: 'packaged',
    });
  }

  return template.innerHTML;
};

const getLegacyImageStemsForPage = (page: Page, pageIndex: number) => {
  const stems = new Set<string>();
  const topicMatch = page.id.match(/^topic-(\d+)$/i);
  if (topicMatch) stems.add(`image-${topicMatch[1]}`);
  stems.add(`image-${safeId(page.id)}`);
  stems.add(`image-${pageIndex}`);
  return Array.from(stems);
};

const chooseLegacyImageAsset = (
  assetFiles: Map<string, { name: string; href: string; file: File }>,
  stem: string
) => {
  const uniqueAssets = Array.from(
    new Map(Array.from(assetFiles.values()).map(asset => [asset.href, asset])).values()
  );
  const extensionPreference = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'bin'];
  const candidates = uniqueAssets.filter(asset => withoutExtension(asset.name).toLowerCase() === stem.toLowerCase());
  return candidates
    .map(asset => {
      const ext = normalizeExtension(getExtension(asset.name));
      const rank = extensionPreference.indexOf(ext);
      return {
        asset,
        score: rank >= 0 ? extensionPreference.length - rank : 0,
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.asset || null;
};

const packageLegacyPageImages = async (
  pages: Page[],
  zip: JSZip,
  assetFiles: Map<string, { name: string; href: string; file: File }>,
  assetMap: Map<string, string>,
  imageDiagnostics: ImageExportDiagnostic[]
) => {
  const extraMediaByPageId = new Map<string, MediaItem[]>();

  for (const [pageIndex, page] of pages.entries()) {
    for (const stem of getLegacyImageStemsForPage(page, pageIndex)) {
      const alreadyAttached = (page.media || []).some(media => media.storageId?.toLowerCase() === stem.toLowerCase());
      const alreadyInContent = new RegExp(`media/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(page.content || '');
      const alreadyMapped = assetMap.has(stem) || assetMap.has(stem.toLowerCase());
      if (alreadyAttached || alreadyInContent || alreadyMapped) continue;

      const asset = chooseLegacyImageAsset(assetFiles, stem);
      if (!asset) continue;

      const explicitMimeType = asset.file.type || mimeTypeFromExtension(asset.name) || await sniffImageMimeType(asset.file);
      let packageFile = withMimeType(asset.file, explicitMimeType, asset.name);
      let packageMimeType = explicitMimeType || packageFile.type;
      let forcedExtension: string | undefined;
      if (shouldConvertImageForScorm({ type: 'image' }, packageFile)) {
        const converted = await convertImageToPng(packageFile);
        if (converted) {
          packageFile = converted;
          packageMimeType = 'image/png';
          forcedExtension = 'png';
        }
      }

      const packagedName = getPackageFileName(stem, asset.name, packageMimeType, forcedExtension);
      const packagedHref = `media/${packagedName}`;
      zip.file(packagedHref, packageFile);
      assetMap.set(stem, packagedHref);
      assetMap.set(stem.toLowerCase(), packagedHref);

      const extraMedia: MediaItem = {
        id: `legacy-${page.id}-${stem}`,
        storageId: stem,
        type: 'image',
        title: stem,
        source: 'legacy-page-image',
      };
      extraMediaByPageId.set(page.id, [...(extraMediaByPageId.get(page.id) || []), extraMedia]);
      imageDiagnostics.push({
        pageId: page.id,
        context: 'legacy-page-image',
        storageId: stem,
        source: asset.href,
        originalName: asset.name,
        originalMimeType: packageFile.type || asset.file.type,
        packagedHref,
        convertedToPng: forcedExtension === 'png',
        status: 'packaged',
      });
    }
  }

  return extraMediaByPageId;
};

const renderQuestion = (question: Question, index: number, prefix: string) => {
  const name = `${prefix}-q-${index}`;
  const options = question.type === 'true-false'
    ? ['true', 'false']
    : (question.options?.length ? question.options : ['Option A', 'Option B', 'Option C', 'Option D']);

  return `<div class="question" data-correct="${escapeHtml(String(question.correctAnswer))}" data-correct-feedback="${escapeHtml(question.feedback?.correct || 'Correct.')}" data-incorrect-feedback="${escapeHtml(question.feedback?.incorrect || 'Review the material and try again.')}">
    <p class="question-text">${escapeHtml(question.question)}</p>
    <div class="options">
      ${options.map(option => `<label class="option"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(String(option))}"><span>${escapeHtml(String(option))}</span></label>`).join('')}
    </div>
    <div class="feedback" aria-live="polite"></div>
  </div>`;
};

const renderKnowledgeCheck = (page: Page) => {
  const questions = 'knowledgeCheck' in page ? page.knowledgeCheck?.questions || [] : [];
  if (!questions.length) return '';
  return `<section class="knowledge-check">
    <h3>Knowledge Check</h3>
    ${questions.map((question, index) => renderQuestion(question, index, page.id)).join('')}
    <button class="check-button" type="button" onclick="submitKnowledgeCheck(this)">Submit Answer</button>
  </section>`;
};

const renderAssessment = (project: ScormProject) => {
  const assessment = project.courseContent.assessment;
  const questions = assessment.questions || [];
  return `<section class="page-card assessment-card">
    <h2>Final Assessment</h2>
    <p class="muted">Pass mark: ${assessment.passMark || 80}%</p>
    ${questions.map((question, index) => renderQuestion(question, index, 'assessment')).join('')}
    <button class="check-button" type="button" onclick="submitAssessment()">Submit Assessment</button>
    <div id="assessment-result" class="assessment-result" aria-live="polite"></div>
  </section>`;
};

const renderTopMedia = (page: Page, assetMap: Map<string, string>, captionMap: Map<string, string>, extraMedia: MediaItem[] = []) => {
  const mediaItems = [...(page.media || []), ...extraMedia];
  const visual = mediaItems.filter(media => !media.candidate && ['image', 'video'].includes(getMediaKind(media)));
  const audio = mediaItems.find(media => getMediaKind(media) === 'audio');
  const visualHtml = visual.map(media => {
    const kind = getMediaKind(media);
    const src = getAssetSrc(assetMap, media);
    if (!src) return '';
    if (kind === 'image') {
      return `<figure class="media-frame"><img src="${escapeHtml(src)}" alt="${escapeHtml(media.title || page.title)}" referrerpolicy="no-referrer"></figure>`;
    }
    if (src.includes('youtube.com/embed') || src.includes('youtu.be')) {
      return `<div class="video-frame"><iframe src="${escapeHtml(src)}" title="${escapeHtml(media.title || 'Video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    }
    return `<div class="video-frame"><video controls src="${escapeHtml(src)}"></video></div>`;
  }).filter(Boolean).join('');

  const audioSrc = audio ? getAssetSrc(assetMap, audio) : '';
  const captionSrc = captionMap.get(page.id);
  const audioId = `audio-${safeId(page.id)}`;
  const audioHtml = audioSrc ? `<aside class="audio-dock">
    <div class="audio-title">Narration & Captions</div>
    <audio id="${escapeHtml(audioId)}" class="narration-audio" controls preload="metadata">
      <source src="${escapeHtml(audioSrc)}">
      ${captionSrc ? `<track kind="captions" src="${escapeHtml(captionSrc)}" srclang="en" label="English">` : ''}
    </audio>
    ${captionSrc ? `<button class="caption-toggle" type="button" data-caption-target="caption-${escapeHtml(audioId)}" aria-pressed="false" onclick="toggleCaptions(this)">CC Off</button><div id="caption-${escapeHtml(audioId)}" class="synced-caption" data-audio-id="${escapeHtml(audioId)}" data-caption-src="${escapeHtml(captionSrc)}" aria-live="polite" hidden>Captions will appear during playback.</div>` : `<div class="synced-caption muted">No captions attached.</div>`}
  </aside>` : '';

  if (!visualHtml && !audioHtml) return '';
  return `<section class="top-media-layout ${visual.length > 2 ? 'has-scroll' : ''}" aria-label="Page media">
    ${visualHtml ? `<div class="visual-media-strip">${visualHtml}</div>` : '<div class="visual-media-strip empty-strip"></div>'}
    ${audioHtml}
  </section>`;
};

const renderPage = (page: Page, assetMap: Map<string, string>, captionMap: Map<string, string>, content = page.content || '', extraMedia: MediaItem[] = []) => {
  const media = renderTopMedia(page, assetMap, captionMap, extraMedia);
  return `<div class="content-wrapper">
    <section class="page-card">
      <div class="page-header"><h2>${escapeHtml(page.title)}</h2></div>
      ${media}
      <main class="content-column">
        <div class="topic-text">${content}</div>
        ${renderKnowledgeCheck(page)}
      </main>
    </section>
  </div>`;
};

const buildStyles = () => `*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:"Century Gothic","Segoe UI",Arial,sans-serif;background:#17141d;color:#f7f3ff}body{display:flex;overflow:hidden}.sidebar{width:250px;background:#0f0e13;border-right:1px solid #3b3148;height:100vh;display:flex;flex-direction:column}.sidebar-header{padding:22px;border-bottom:1px solid #31283d}.course-title{font-size:15px;font-weight:700;line-height:1.35}.progress-wrap{margin-top:14px}.progress-bar{height:8px;background:#272231;border-radius:999px;overflow:hidden}.progress-fill{height:100%;width:0;background:linear-gradient(90deg,#8b5cf6,#5b21b6);transition:width .25s ease}.progress-text{font-size:12px;color:#cfc5e3;margin-top:7px}.sidebar-nav{padding:12px;overflow:auto;flex:1}.nav-item{display:block;color:#cfc5e3;text-decoration:none;padding:10px 12px;border-radius:7px;margin-bottom:4px;font-size:13px;transition:all .16s ease}.nav-item:hover,.nav-item.active{background:rgba(124,58,237,.18);color:#fff;box-shadow:0 0 24px -16px rgba(167,139,250,.9)}.main-area{flex:1;height:100vh;display:flex;flex-direction:column;background:radial-gradient(circle at 78% 10%,rgba(124,58,237,.18),transparent 30rem),#17141d}.header{padding:18px 28px;border-bottom:1px solid #3b3148;background:#1b1821;display:flex;justify-content:space-between;gap:18px;align-items:center}.header h1{font-size:20px;margin:0}.content-container{flex:1;overflow:auto;padding:26px}.footer{padding:14px 24px;border-top:1px solid #3b3148;background:#1b1821;display:flex;justify-content:space-between;align-items:center;gap:18px}.gate-message{flex:1;text-align:center;font-size:13px;color:#d9ccff}.nav-button,.check-button{border:0;border-radius:7px;padding:10px 18px;color:#fff;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#8b5cf6,#4c1d95);transition:transform .16s ease,box-shadow .16s ease}.nav-button:hover,.check-button:hover{transform:translateY(-1px);box-shadow:0 16px 44px -24px rgba(167,139,250,.95)}.nav-button:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}.secondary{background:#272231;color:#d7cdeb}.page-card{background:#211d29;border:1px solid #463855;border-radius:8px;padding:24px;box-shadow:0 24px 70px -48px #000}.page-header h2{margin:0 0 18px;font-size:26px}.top-media-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:16px;align-items:start;margin:0 0 24px}.visual-media-strip{display:flex;gap:16px;overflow-x:auto;overflow-y:hidden;scrollbar-color:#8b5cf6 #17141d;scrollbar-width:thin;padding:2px 2px 12px;min-height:170px}.visual-media-strip.empty-strip{min-height:0;padding:0}.media-frame,.video-frame{margin:0;flex:0 0 min(58vw,620px);border:1px solid #463855;border-radius:10px;background:#111016;overflow:hidden;box-shadow:0 16px 40px -34px #000}.media-frame img{display:block;width:100%;height:100%;max-height:340px;object-fit:contain;background:#0f0e13}.video-frame{aspect-ratio:16/9;height:min(340px,30vw)}.video-frame iframe,.video-frame video{width:100%;height:100%;border:0;display:block}.audio-dock{position:sticky;top:0;background:linear-gradient(160deg,#17141d,#211d29);border:1px solid #5a4a6a;border-radius:10px;padding:14px;box-shadow:0 18px 48px -36px rgba(167,139,250,.9)}.audio-title{font-size:13px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:#d9ccff;margin-bottom:10px}.audio-dock audio{width:100%}.caption-toggle{margin-top:10px;border:1px solid #6d56a3;border-radius:999px;background:#14111b;color:#d9ccff;font-weight:800;font-size:12px;letter-spacing:.04em;padding:7px 12px;cursor:pointer;transition:all .16s ease}.caption-toggle:hover,.caption-toggle[aria-pressed="true"]{background:linear-gradient(135deg,#8b5cf6,#4c1d95);color:#fff;box-shadow:0 12px 30px -20px rgba(167,139,250,.95)}.synced-caption{margin-top:12px;min-height:70px;border-radius:8px;background:#0f0e13;border:1px solid #463855;padding:12px 14px;color:#fff;font-size:15px;line-height:1.5}.synced-caption[hidden]{display:none}.synced-caption.is-active{border-color:#8b5cf6;box-shadow:0 0 28px -18px rgba(167,139,250,.95)}.content-column{max-width:1120px}.topic-text{font-size:17px;line-height:1.65;color:#f7f3ff}.topic-text h2,.topic-text h3{color:#fff}.topic-text table{width:100%;border-collapse:collapse;margin:16px 0}.topic-text th,.topic-text td{border:1px solid #5a4a6a;padding:10px;text-align:left}.topic-text th{background:#30283b}.knowledge-check,.assessment-card{margin-top:24px;background:#17141d;border:1px solid #463855;border-radius:8px;padding:18px}.question{margin:16px 0;padding:14px;border-radius:7px;background:#211d29;border:1px solid #3f344d}.question-text{font-weight:700}.option{display:flex;gap:10px;align-items:center;margin:8px 0;padding:8px;border-radius:6px;background:#17141d}.feedback,.assessment-result{margin-top:10px;font-weight:700}.feedback.correct,.assessment-result.pass{color:#a78bfa}.feedback.incorrect,.assessment-result.fail{color:#fca5a5}.muted{color:#cfc5e3}.scorm-alert{position:fixed;right:20px;top:20px;background:#211d29;border:1px solid #8b5cf6;color:#fff;padding:12px 16px;border-radius:8px;z-index:1000}@media(max-width:900px){body{display:block;overflow:auto}.sidebar{width:100%;height:auto}.main-area{height:auto}.content-container{padding:16px}.top-media-layout{display:flex;flex-direction:column}.audio-dock{position:relative;width:100%}.media-frame,.video-frame{flex-basis:min(86vw,620px)}.video-frame{height:auto}}`;

const buildScormApi = () => `window.SCORM={api:null,initialized:false,findAPI:function(w){var tries=0;while(w&&tries<10){if(w.API)return w.API;w=w.parent;tries++}return null},init:function(){this.api=this.findAPI(window)||this.findAPI(window.opener);if(this.api&&!this.initialized){this.api.LMSInitialize('');this.initialized=true}return this.initialized},set:function(k,v){try{if(this.api)this.api.LMSSetValue(k,String(v))}catch(e){}},commit:function(){try{if(this.api)this.api.LMSCommit('')}catch(e){}},finish:function(){try{if(this.api)this.api.LMSFinish('')}catch(e){}}};window.addEventListener('load',function(){SCORM.init();SCORM.set('cmi.core.lesson_status','incomplete');SCORM.commit()});window.addEventListener('beforeunload',function(){SCORM.commit();SCORM.finish()});`;

const buildExportContentStyles = () => `.topic-text ul,.topic-text ol{margin:12px 0 16px;padding-left:28px}.topic-text ul{list-style:disc}.topic-text ol{list-style:decimal}.topic-text li{margin:6px 0;padding-left:3px}.topic-text li>ul,.topic-text li>ol{margin:6px 0 6px 8px}.topic-text table{table-layout:auto;margin:16px 0 20px}.topic-text th,.topic-text td{vertical-align:top}.topic-text th{color:#fff}.topic-text tr:nth-child(even) td{background:#272231}.topic-text img{max-width:100%;height:auto;border-radius:8px;display:block;margin:16px 0}`;

const buildThemeStyles = (theme: ScormProject['scormConfig']['outputTheme']) => {
  if (theme !== 'legacy-green') return '';
  return `body{background:#f4f5f7;color:#111827}.sidebar{background:#251f22;border-right-color:#3b3335;color:#e8e4df}.sidebar-header{border-bottom-color:#3b3335}.course-title{color:#e8e4df}.header h1,.page-header h2{color:#111827}.progress-fill{background:#8cc63f}.progress-text{color:#d8e7c8}.sidebar-nav{background:#251f22}.nav-item{color:#e8e4df;border-left:4px solid transparent;border-radius:8px}.nav-item:hover,.nav-item.active{background:#3b4328;color:#9bd34f;border-left-color:#8cc63f;box-shadow:none}.main-area{background:#f5f6f8;color:#111827}.header,.footer{background:#fff;border-color:#e5e7eb;color:#111827}.content-container{background:#f5f6f8}.page-card{background:#f5f6f8;border-color:#e5e7eb;box-shadow:none}.topic-text{color:#111827}.topic-text h2,.topic-text h3{color:#030712}.topic-text th{background:#eef5e2;color:#111827}.topic-text td,.topic-text th{border-color:#cfd8c2}.topic-text tr:nth-child(even) td{background:#fafcf6}.media-frame,.video-frame,.audio-dock,.knowledge-check,.assessment-card,.question{background:#fff;border-color:#e5e7eb;color:#111827;box-shadow:0 8px 24px -20px rgba(0,0,0,.35)}.audio-title{color:#111827}.synced-caption,.option{background:#f8fafc;border-color:#e5e7eb;color:#111827}.caption-toggle,.nav-button,.check-button{background:#8cc63f;color:#fff;border-color:#8cc63f}.caption-toggle:hover,.caption-toggle[aria-pressed="true"],.nav-button:hover,.check-button:hover{background:#76a933;color:#fff;box-shadow:0 14px 30px -22px rgba(80,120,28,.9)}.secondary{background:#f0f0f0;color:#111827}.gate-message,.muted{color:#4b5563}.feedback.correct,.assessment-result.pass{color:#76a933}.feedback.incorrect,.assessment-result.fail{color:#b91c1c}.scorm-alert{background:#fff;border-color:#8cc63f;color:#111827}`;
};

const buildNavigation = (pages: { id: string; title: string }[], passMark: number, scormConfig: ScormProject['scormConfig']) => `
const PAGES=${JSON.stringify(pages)};
const COURSE_SETTINGS=${JSON.stringify({
  requireKnowledgeCheckBeforeContinue: Boolean(scormConfig?.requireKnowledgeCheckBeforeContinue),
  requireAudioCompletionBeforeContinue: Boolean(scormConfig?.requireAudioCompletionBeforeContinue),
})};
let current=0;
const visited=new Set(JSON.parse(sessionStorage.getItem('visitedPages')||'[]'));
function el(id){return document.getElementById(id)}
function save(){sessionStorage.setItem('visitedPages',JSON.stringify(Array.from(visited)));const progress=Math.round((visited.size/PAGES.length)*100);el('progress-fill').style.width=progress+'%';el('progress-text').textContent=progress+'% complete';if(window.SCORM){SCORM.set('cmi.core.lesson_location',PAGES[current].id);SCORM.set('cmi.core.lesson_status',progress>=100?'completed':'incomplete');SCORM.commit()}}
function setNav(){document.querySelectorAll('.nav-item').forEach((n,i)=>n.classList.toggle('active',i===current));el('prev-button').disabled=current===0;el('next-button').textContent=current===PAGES.length-1?'Finish':'Next';updateNextGate()}
async function loadPage(index){current=Math.max(0,Math.min(index,PAGES.length-1));const page=PAGES[current];const container=el('content-container');const res=await fetch('pages/'+page.id+'.html');container.innerHTML=await res.text();container.scrollTop=0;document.documentElement.scrollTop=0;document.body.scrollTop=0;initializeCaptions();initializeCompletionGate();visited.add(page.id);setNav();save();window.scrollTo(0,0)}
function nextPage(){if(current<PAGES.length-1)loadPage(current+1);else{if(window.SCORM){SCORM.set('cmi.core.lesson_status','completed');SCORM.commit()}showAlert('Course complete')}}
function prevPage(){if(current>0)loadPage(current-1)}
function showAlert(message){const d=document.createElement('div');d.className='scorm-alert';d.textContent=message;document.body.appendChild(d);setTimeout(()=>d.remove(),3500)}
function timeToSeconds(value){const clean=String(value||'').trim().replace(',','.');const parts=clean.split(':').map(Number);if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];if(parts.length===2)return parts[0]*60+parts[1];return Number(clean)||0}
function cleanCaptionText(value){const div=document.createElement('div');div.innerHTML=String(value||'').replace(/<[^>]+>/g,'');return(div.textContent||div.innerText||'').replace(/\\s+/g,' ').trim()}
function parseVtt(text){const source=String(text||'').replace(/\\r/g,'').replace(/^\\s*\`\`\`(?:webvtt|vtt)?/i,'').replace(/\`\`\`\\s*$/,'');const lines=source.split('\\n');const cues=[];for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(!line||line==='WEBVTT'||line.startsWith('NOTE')||!line.includes('-->'))continue;const timing=line.split('-->');const start=timeToSeconds(timing[0]);const end=timeToSeconds((timing[1]||'').trim().split(/\\s+/)[0]);const textLines=[];i++;while(i<lines.length){const next=lines[i].trim();if(!next)break;if(next.includes('-->')){i--;break}if(!/^\\d+$/.test(next))textLines.push(next);i++}const cueText=cleanCaptionText(textLines.join(' '));if(cueText&&Number.isFinite(start)&&Number.isFinite(end))cues.push({start,end,text:cueText})}return cues}
function setCaptionText(box,text,active){box.textContent=text;box.classList.toggle('is-active',Boolean(active))}
function initializeCaptions(){document.querySelectorAll('.synced-caption[data-caption-src]').forEach(async box=>{const audio=el(box.dataset.audioId);if(!audio)return;try{const response=await fetch(box.dataset.captionSrc,{cache:'no-store'});const cues=parseVtt(await response.text());if(!cues.length){setCaptionText(box,'Captions are attached, but no timed lines were found.',false);return}let lastText='';const update=()=>{const t=audio.currentTime;const cue=cues.find(item=>t>=item.start&&t<=item.end);const nextText=cue?cue.text:(audio.paused&&lastText?lastText:'Captions will appear during playback.');setCaptionText(box,nextText,Boolean(cue));if(cue)lastText=cue.text};box._captionUpdate=update;audio.addEventListener('timeupdate',update);audio.addEventListener('play',update);audio.addEventListener('pause',update);audio.addEventListener('seeked',update);audio.addEventListener('loadedmetadata',update);update()}catch(error){setCaptionText(box,'Captions could not load in this player.',false)}})}
function toggleCaptions(btn){const box=el(btn.dataset.captionTarget);if(!box)return;const enabled=box.hidden;box.hidden=!enabled;btn.setAttribute('aria-pressed',String(enabled));btn.textContent=enabled?'CC On':'CC Off';if(enabled&&box._captionUpdate)box._captionUpdate()}
function initializeCompletionGate(){document.querySelectorAll('.narration-audio').forEach(audio=>{const update=()=>{const duration=Number.isFinite(audio.duration)?audio.duration:0;if(audio.ended||(duration>0&&audio.currentTime>=Math.max(0,duration-.75))){audio.dataset.completed='true'}updateNextGate()};audio.addEventListener('timeupdate',update);audio.addEventListener('ended',update);audio.addEventListener('loadedmetadata',update);update()});updateNextGate()}
function getGateState(){const messages=[];const kc=document.querySelector('.knowledge-check');const audio=document.querySelector('.narration-audio');if(COURSE_SETTINGS.requireKnowledgeCheckBeforeContinue&&kc&&kc.dataset.completed!=='true')messages.push('Complete the knowledge check to continue.');if(COURSE_SETTINGS.requireAudioCompletionBeforeContinue&&audio&&audio.dataset.completed!=='true')messages.push('Listen to the full narration to continue.');return messages}
function updateNextGate(){const next=el('next-button');if(!next)return;const messages=getGateState();next.disabled=messages.length>0;next.title=messages.join(' ');const gate=el('gate-message');if(gate)gate.textContent=messages.join(' ')}
function submitKnowledgeCheck(btn){const box=btn.closest('.knowledge-check');const questions=Array.from(box.querySelectorAll('.question'));const passed=questions.map(q=>gradeQuestion(q)).every(Boolean);box.dataset.completed=String(passed);if(passed)showAlert('Knowledge check complete.');updateNextGate()}
function gradeQuestion(q){const selected=q.querySelector('input:checked');const fb=q.querySelector('.feedback');if(!selected){fb.textContent='Choose an answer first.';fb.className='feedback incorrect';return false}const ok=String(selected.value).trim()===String(q.dataset.correct).trim();fb.textContent=ok?q.dataset.correctFeedback:q.dataset.incorrectFeedback;fb.className='feedback '+(ok?'correct':'incorrect');return ok}
function submitAssessment(){const qs=Array.from(document.querySelectorAll('.assessment-card .question'));const correct=qs.filter(q=>gradeQuestion(q)).length;const score=qs.length?Math.round((correct/qs.length)*100):0;const result=el('assessment-result');const passed=score>=${passMark};result.textContent='Score: '+score+'% - '+(passed?'Passed':'Try again');result.className='assessment-result '+(passed?'pass':'fail');if(window.SCORM){SCORM.set('cmi.core.score.raw',score);SCORM.set('cmi.core.score.min',0);SCORM.set('cmi.core.score.max',100);SCORM.set('cmi.core.lesson_status',passed?'passed':'failed');SCORM.commit()}}
document.addEventListener('click',e=>{const nav=e.target.closest('.nav-item');if(nav){e.preventDefault();const target=Number(nav.dataset.index);const messages=getGateState();if(target>current&&messages.length){showAlert(messages.join(' '));return}loadPage(target)}});
document.addEventListener('DOMContentLoaded',()=>{el('prev-button').onclick=prevPage;el('next-button').onclick=nextPage;loadPage(0)});
`;

export class ScormPackager {
  static lastImageReport: ImageExportReport | null = null;

  static async createScormPackage(project: ScormProject, assetsHandle: FileSystemDirectoryHandle | null): Promise<Blob> {
    const zip = new JSZip();
    const title = project.courseData.title || project.project.name;
    const isPowerPointImport = project.scormConfig?.contentMode === 'ppt-import';
    const pages: Page[] = isPowerPointImport
      ? [...project.courseContent.topics]
      : [project.courseContent.welcomePage, project.courseContent.learningObjectivesPage, ...project.courseContent.topics];
    const pageEntries = [...pages.map(page => ({ id: safeId(page.id), title: page.title })), { id: 'assessment', title: 'Assessment' }];
    const assetMap = new Map<string, string>();
    const captionMap = new Map<string, string>();
    const imageDiagnostics: ImageExportDiagnostic[] = [];
    const assetFiles = new Map<string, { name: string; href: string; file: File }>();
    const referencedMediaByStorageId = new Map<string, MediaItem>();
    for (const page of pages) {
      for (const media of page.media || []) {
        if (!media.storageId) continue;
        referencedMediaByStorageId.set(media.storageId, media);
        referencedMediaByStorageId.set(media.storageId.toLowerCase(), media);
      }
    }

    if (assetsHandle) {
      try {
        const metadataFiles = new Map<string, File>();

        // @ts-ignore browser File System Access API async iterator
        for await (const entry of assetsHandle.values()) {
          if (entry.kind !== 'file') continue;
          const file = await (entry as any).getFile();
          const lowerName = entry.name.toLowerCase();
          if (lowerName.endsWith('.json')) {
            metadataFiles.set(withoutExtension(lowerName), file);
            continue;
          }

          const href = `media/${entry.name}`;
          assetFiles.set(entry.name, { name: entry.name, href, file });
          assetFiles.set(lowerName, { name: entry.name, href, file });
        }

        const findAssetByMetadata = (metadata: any, metadataStem: string) => {
          const candidates = [
            metadata?.storageId,
            metadata?.id,
            metadataStem,
            metadata?.originalName,
            metadata?.original_name,
            metadata?.fileName,
            metadata?.filename,
            metadata?.name,
          ].filter(Boolean).map((value: string) => String(value));
          const uniqueAssets = Array.from(
            new Map(Array.from(assetFiles.values()).map(asset => [asset.href, asset])).values()
          );
          const metadataKind = getMediaKind(metadata);
          const preferredExtensions = metadataKind === 'image'
            ? ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'bin']
            : metadataKind === 'audio'
              ? ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm', 'bin']
              : metadataKind === 'video'
                ? ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'bin']
                : ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'mp3', 'wav', 'mp4', 'webm', 'bin'];
          const scoreAsset = (asset: { name: string; href: string; file: File }) => {
            const name = asset.name.toLowerCase();
            const stem = withoutExtension(name);
            const ext = normalizeExtension(getExtension(name));
            let score = 0;
            for (const candidate of candidates) {
              const candidateLower = candidate.toLowerCase();
              const candidateStem = withoutExtension(candidateLower);
              if (name === candidateLower) score += 100;
              if (stem === candidateStem) score += 80;
              else if (stem.startsWith(candidateStem) || candidateStem.startsWith(stem)) score += 30;
            }
            const extensionRank = preferredExtensions.indexOf(ext);
            if (extensionRank >= 0) score += preferredExtensions.length - extensionRank;
            if (ext === 'bin') score -= 20;
            return score;
          };

          for (const candidate of candidates) {
            const lower = candidate.toLowerCase();
            const exact = assetFiles.get(candidate) || assetFiles.get(lower);
            if (exact) return exact;

            const stem = withoutExtension(candidate);
            const byStem = assetFiles.get(stem) || assetFiles.get(stem.toLowerCase());
            if (byStem) return byStem;
          }

          return uniqueAssets
            .map(asset => ({ asset, score: scoreAsset(asset) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)[0]?.asset || null;
        };

        for (const [metadataStem, metadataFile] of metadataFiles.entries()) {
          try {
            const metadata = JSON.parse(await metadataFile.text());
            const asset = findAssetByMetadata(metadata, metadataStem);
            if (!asset) continue;

            const storageIds = [
              metadata?.storageId,
              metadata?.id,
              metadataStem,
            ].filter(Boolean).map((value: string) => String(value));
            const referencedStorageId = storageIds.find(storageId =>
              referencedMediaByStorageId.has(storageId) || referencedMediaByStorageId.has(storageId.toLowerCase())
            );
            if (!referencedStorageId) continue;

            const primaryStorageId = referencedStorageId || storageIds[0] || metadataStem;
            const explicitMimeType = metadata?.mimeType || asset.file.type || mimeTypeFromExtension(asset.name) || (getMediaKind(metadata) === 'image' ? await sniffImageMimeType(asset.file) : '');
            let packageFile = withMimeType(asset.file, explicitMimeType, asset.name);
            let packageMimeType = explicitMimeType || packageFile.type;
            let forcedExtension: string | undefined;

            if (shouldConvertImageForScorm(metadata, packageFile)) {
              const converted = await convertImageToPng(packageFile);
              if (converted) {
                packageFile = converted;
                packageMimeType = 'image/png';
                forcedExtension = 'png';
              }
            }

            const packagedName = getPackageFileName(primaryStorageId, asset.name, packageMimeType, forcedExtension);
            const packagedHref = `media/${packagedName}`;
            zip.file(packagedHref, packageFile);
            if (isImageAsset(metadata, asset.file)) {
              imageDiagnostics.push({
                context: 'media-asset',
                storageId: primaryStorageId,
                source: asset.href,
                originalName: asset.name,
                originalMimeType: metadata?.mimeType || asset.file.type,
                packagedHref,
                convertedToPng: forcedExtension === 'png',
                status: 'packaged',
              });
            }

            for (const storageId of storageIds) {
              assetMap.set(storageId, packagedHref);
              assetMap.set(storageId.toLowerCase(), packagedHref);
            }
          } catch (metadataError) {
            console.warn(`Unable to read asset metadata ${metadataStem}.json`, metadataError);
          }
        }

        const uniqueAssets = Array.from(
          new Map(Array.from(assetFiles.values()).map(asset => [asset.href, asset])).values()
        );
        for (const asset of uniqueAssets) {
          const storageId = withoutExtension(asset.name);
          const storageIdLower = storageId.toLowerCase();
          const referencedMedia = referencedMediaByStorageId.get(storageId) || referencedMediaByStorageId.get(storageIdLower);
          const currentHref = assetMap.get(storageId) || assetMap.get(storageIdLower);
          if (!referencedMedia || (currentHref && currentHref !== asset.href)) continue;

          const isReferencedImage = getMediaKind(referencedMedia) === 'image' || isImageAsset({}, asset.file);

          const explicitMimeType = asset.file.type || mimeTypeFromExtension(asset.name) || (getMediaKind(referencedMedia) === 'image' ? await sniffImageMimeType(asset.file) : '');
          let packageFile = withMimeType(asset.file, explicitMimeType, asset.name);
          let packageMimeType = explicitMimeType || packageFile.type;
          let forcedExtension: string | undefined;
          if (shouldConvertImageForScorm({}, packageFile)) {
            const converted = await convertImageToPng(packageFile);
            if (converted) {
              packageFile = converted;
              packageMimeType = 'image/png';
              forcedExtension = 'png';
            }
          }

          const packagedName = getPackageFileName(storageId, asset.name, packageMimeType, forcedExtension);
          const packagedHref = `media/${packagedName}`;
          zip.file(packagedHref, packageFile);
          assetMap.set(storageId, packagedHref);
          assetMap.set(storageIdLower, packagedHref);
          if (isReferencedImage) {
            imageDiagnostics.push({
              context: 'media-asset',
              storageId,
              source: asset.href,
              originalName: asset.name,
              originalMimeType: packageFile.type || asset.file.type,
              packagedHref,
              convertedToPng: forcedExtension === 'png',
              status: 'packaged',
            });
          }
        }
      } catch (error) {
        console.warn('Unable to include linked assets in package.', error);
      }
    }

    for (const media of referencedMediaByStorageId.values()) {
      if (getMediaKind(media) !== 'image' || !media.storageId) continue;
      if (assetMap.has(media.storageId) || assetMap.has(media.storageId.toLowerCase())) continue;

      const urlFile = await getImageFileFromUrl(media);
      if (!urlFile) {
        imageDiagnostics.push({
          context: 'external-media',
          storageId: media.storageId,
          source: summarizeSource(media.url || ''),
          status: 'unresolved',
          reason: 'The media item points to an external/blob URL that could not be fetched into the SCORM package.',
        });
        continue;
      }

      let packageFile = urlFile;
      let packageMimeType = urlFile.type;
      let forcedExtension: string | undefined;
      if (shouldConvertImageForScorm({}, urlFile)) {
        const converted = await convertImageToPng(urlFile);
        if (converted) {
          packageFile = converted;
          packageMimeType = 'image/png';
          forcedExtension = 'png';
        }
      }

      const packagedName = getPackageFileName(media.storageId, urlFile.name, packageMimeType, forcedExtension);
      const packagedHref = `media/${packagedName}`;
      zip.file(packagedHref, packageFile);
      assetMap.set(media.storageId, packagedHref);
      assetMap.set(media.storageId.toLowerCase(), packagedHref);
      imageDiagnostics.push({
        context: 'external-media',
        storageId: media.storageId,
        source: summarizeSource(media.url || ''),
        originalName: urlFile.name,
        originalMimeType: urlFile.type,
        packagedHref,
        convertedToPng: forcedExtension === 'png',
        status: 'packaged',
      });
    }

    const legacyExtraMediaByPageId = await packageLegacyPageImages(pages, zip, assetFiles, assetMap, imageDiagnostics);

    const inlineAssetHrefs: string[] = [];
    const inlineImageCache = new Map<string, string>();
    const processedContentByPageId = new Map<string, string>();
    for (const page of pages) {
      processedContentByPageId.set(page.id, await packageInlineContentImages(page, zip, inlineAssetHrefs, inlineImageCache, imageDiagnostics, assetFiles));
    }

    for (const page of pages) {
      if (!page.caption?.trim()) continue;
      const captionName = `caption-${safeId(page.id)}.vtt`;
      const captionHref = `media/${captionName}`;
      zip.file(captionHref, page.caption.startsWith('WEBVTT') ? page.caption : `WEBVTT\n\n${page.caption}`);
      captionMap.set(page.id, captionHref);
    }

    zip.file('styles/main.css', buildStyles() + buildExportContentStyles() + buildThemeStyles(project.scormConfig.outputTheme || 'dark-violet'));
    zip.file('scripts/scorm-api.js', buildScormApi());
    zip.file('scripts/navigation.js', buildNavigation(pageEntries, project.courseContent.assessment.passMark || 80, project.scormConfig));
    zip.file('project.json', JSON.stringify(project, null, 2));
    const imageReport: ImageExportReport = {
      generatedAt: new Date().toISOString(),
      summary: {
        total: imageDiagnostics.length,
        packaged: imageDiagnostics.filter(item => item.status === 'packaged').length,
        unresolved: imageDiagnostics.filter(item => item.status === 'unresolved').length,
        convertedToPng: imageDiagnostics.filter(item => item.convertedToPng).length,
      },
      images: imageDiagnostics,
    };
    ScormPackager.lastImageReport = imageReport;
    zip.file('diagnostics/scorm-image-report.json', JSON.stringify(imageReport, null, 2));

    for (const page of pages) {
      zip.file(`pages/${safeId(page.id)}.html`, renderPage(page, assetMap, captionMap, processedContentByPageId.get(page.id), legacyExtraMediaByPageId.get(page.id) || []));
    }
    zip.file('pages/assessment.html', renderAssessment(project));

    zip.file('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="styles/main.css"><script src="scripts/scorm-api.js"></script></head><body><nav class="sidebar"><div class="sidebar-header"><div class="course-title">${escapeHtml(title)}</div><div class="progress-wrap"><div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div><div id="progress-text" class="progress-text">0% complete</div></div></div><div class="sidebar-nav">${pageEntries.map((page, index) => `<a href="#" class="nav-item" data-index="${index}">${escapeHtml(page.id !== 'assessment' && (isPowerPointImport || index > 1) ? `${isPowerPointImport ? index + 1 : index - 1}. ${page.title}` : page.title)}</a>`).join('')}</div></nav><main class="main-area"><header class="header"><h1>${escapeHtml(title)}</h1></header><div id="content-container" class="content-container"></div><footer class="footer"><button id="prev-button" class="nav-button secondary" type="button">Previous</button><div id="gate-message" class="muted gate-message"></div><button id="next-button" class="nav-button primary" type="button">Next</button></footer></main><script src="scripts/navigation.js"></script></body></html>`);

    const fileList = Array.from(new Set([
      'index.html',
      'styles/main.css',
      'scripts/scorm-api.js',
      'scripts/navigation.js',
      'project.json',
      'diagnostics/scorm-image-report.json',
      ...pageEntries.map(page => `pages/${page.id}.html`),
      ...Array.from(assetMap.values()),
      ...inlineAssetHrefs,
      ...Array.from(captionMap.values()),
    ]));

    zip.file('imsmanifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${escapeXml(project.project.id)}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="default_org"><organization identifier="default_org"><title>${escapeXml(title)}</title><item identifier="item_1" identifierref="main"><title>${escapeXml(title)}</title><adlcp:masteryscore>${project.courseContent.assessment.passMark || 80}</adlcp:masteryscore></item></organization></organizations>
  <resources><resource identifier="main" type="webcontent" adlcp:scormtype="sco" href="index.html">${fileList.map(file => `<file href="${escapeXml(file)}"/>`).join('')}</resource></resources>
</manifest>`);

    return zip.generateAsync({ type: 'blob' });
  }
}
