import JSZip from 'jszip';

/**
 * A self-contained, sandboxed preview of the REAL SCORM 1.2 output.
 * This helper never accesses localStorage, an LMS, or application credentials.
 * The generated navigation code runs ONLY inside an opaque-origin sandboxed frame.
 */
export interface PreviewAsset {
  path: string;
  blob: Blob;
}

export interface ScormPreviewBundle {
  html: string;
  pages: Record<string, string>;
  assets: PreviewAsset[];
}

const assetMimeType = (name: string): string => {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm', vtt: 'text/vtt',
  };
  return types[extension] || 'application/octet-stream';
};

/**
 * Runs inside an iframe with sandbox="allow-scripts", WITHOUT allow-same-origin.
 * The parent provides the exported page HTML and binary assets via postMessage.
 * Object URLs are created INSIDE the sandbox so images, video, VTT and audio
 * share the frame's origin without granting access to the parent app's storage.
 */
export const SCORM_PREVIEW_BOOTSTRAP = `(() => {
  'use strict';
  const pageHtml = Object.create(null);
  const assetUrls = Object.create(null);
  let complete = false;
  let readyResolver;
  const ready = new Promise(resolve => { readyResolver = resolve; });
  const originalFetch = window.fetch.bind(window);

  function resolveAsset(path) {
    const key = String(path || '').replace(/^(?:\\.\\/)+/, '');
    return assetUrls[key] || '';
  }

  function restoreMedia(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    template.content.querySelectorAll('[src], [poster], [href], [data-caption-src], [data-expand-src]').forEach(node => {
      ['src', 'poster', 'href', 'data-caption-src', 'data-expand-src'].forEach(attribute => {
        const original = node.getAttribute(attribute);
        if (!original) return;
        const replacement = resolveAsset(original);
        if (replacement) node.setAttribute(attribute, replacement);
      });
    });
    return template.innerHTML;
  }

  window.fetch = async function(resource, init) {
    const path = typeof resource === 'string' ? resource : String(resource && resource.url || '');
    if (path.startsWith('pages/')) {
      await ready;
      if (!Object.prototype.hasOwnProperty.call(pageHtml, path)) {
        return new Response('Page not found in preview', { status: 404 });
      }
      return new Response(restoreMedia(pageHtml[path]), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return originalFetch(resource, init);
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || complete || !event.data || event.data.type !== 'scorm-studio-preview-payload') return;
    const payload = event.data;
    if (!payload.pages || typeof payload.pages !== 'object' || !Array.isArray(payload.assets)) return;
    Object.keys(payload.pages).forEach(path => {
      if (path.startsWith('pages/') && path.endsWith('.html') && typeof payload.pages[path] === 'string') {
        pageHtml[path] = payload.pages[path];
      }
    });
    payload.assets.forEach(asset => {
      if (typeof asset.path === 'string' && asset.path.startsWith('media/') && asset.blob instanceof Blob) {
        assetUrls[asset.path] = URL.createObjectURL(asset.blob);
      }
    });
    complete = true;
    readyResolver();
  });

  window.addEventListener('pagehide', () => {
    Object.keys(assetUrls).forEach(path => URL.revokeObjectURL(assetUrls[path]));
  });
})();`;

const inlineSafe = (script: string) => script.replace(/<\/script/gi, '<\\/script');

/** Uses the exporter-generated index, CSS and navigation script unmodified. */
export const createPreviewDocument = (index: string, styles: string, navigation: string): string => {
  const cssLink = /<link\b[^>]*href=["']styles\/main\.css["'][^>]*>/i;
  const scormApi = /<script\b[^>]*src=["']scripts\/scorm-api\.js["'][^>]*><\/script\s*>/i;
  const navScript = /<script\b[^>]*src=["']scripts\/navigation\.js["'][^>]*><\/script\s*>/i;
  if (!cssLink.test(index) || !scormApi.test(index) || !navScript.test(index)) {
    throw new Error('This course uses an unsupported launch template. Preview could not be created.');
  }
  return index
    .replace(cssLink, `<style>${styles.replace(/<\/style/gi, '<\\/style')}</style>`)
    .replace(scormApi, '') // No LMS adapter in preview: cannot write scores or completion.
    .replace(navScript, `<script>${inlineSafe(SCORM_PREVIEW_BOOTSTRAP)}</script><script>${inlineSafe(navigation)}</script>`);
};

/**
 * Reads a ZIP that was generated by ScormPackager.createScormPackage.
 * Nothing is written to disk and the archive's project.json is never sent
 * to the iframe (preventing the preview from accessing authoring metadata).
 */
export const createScormPreviewBundle = async (packageBlob: Blob): Promise<ScormPreviewBundle> => {
  const zip = await JSZip.loadAsync(packageBlob);
  const index = zip.file('index.html');
  const styles = zip.file('styles/main.css');
  const navigation = zip.file('scripts/navigation.js');
  if (!index || !styles || !navigation) throw new Error('The SCORM package is missing its learner interface or navigation files.');

  const [indexHtml, cssText, navigationText] = await Promise.all([
    index.async('string'), styles.async('string'), navigation.async('string'),
  ]);
  const html = createPreviewDocument(indexHtml, cssText, navigationText);
  const pages: Record<string, string> = {};
  const assets: PreviewAsset[] = [];
  const pageFiles = Object.values(zip.files).filter(file => !file.dir && /^pages\/[^/]+\.html$/i.test(file.name));
  const mediaFiles = Object.values(zip.files).filter(file => !file.dir && file.name.startsWith('media/'));
  await Promise.all([
    ...pageFiles.map(async file => { pages[file.name] = await file.async('string'); }),
    ...mediaFiles.map(async file => {
      const bytes = await file.async('uint8array');
      assets.push({ path: file.name, blob: new Blob([new Uint8Array(bytes)], { type: assetMimeType(file.name) }) });
    }),
  ]);
  if (!pageFiles.length) throw new Error('The SCORM package has no course pages to preview.');
  return { html, pages, assets };
};
