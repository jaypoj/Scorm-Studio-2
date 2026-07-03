import JSZip from 'jszip';
import pdfJsLicense from 'pdfjs-dist/LICENSE?raw';
import pdfJsUrl from './vendor/pdf.min.js?url';
import pdfWorkerUrl from './vendor/pdf.worker.min.js?url';
import { PdfCourseDocument, PdfCourseProject } from './types';
import { sanitizePdfFileName } from './pdfProjectZip';

const escapeHtml = (value: string) => value.replace(/[<>&"']/g, character => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
}[character]!));

const escapeXml = escapeHtml;
const safeId = (value: string) => value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'pdf-sop';
const safeZipName = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '_').slice(0, 100) || 'PDF_SOP';

let pdfJsAssetsPromise: Promise<[Blob, Blob]> | null = null;

const fetchBuildAsset = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load local PDF.js build asset (${response.status}).`);
  return response.blob();
};

const getPdfJsAssets = () => {
  if (!pdfJsAssetsPromise) {
    pdfJsAssetsPromise = Promise.all([
      fetchBuildAsset(pdfJsUrl),
      fetchBuildAsset(pdfWorkerUrl),
    ]);
  }
  return pdfJsAssetsPromise;
};

const buildManifest = (document: PdfCourseDocument, pdfFileName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${escapeXml(`PDF_SOP_${safeId(document.id)}`)}"
  version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
  http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
  http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${escapeXml(document.title)}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>${escapeXml(document.title)}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="styles.css"/>
      <file href="runtime.js"/>
      <file href="pdf-course-metadata.json"/>
      <file href="vendor/pdf.min.js"/>
      <file href="vendor/pdf.worker.min.js"/>
      <file href="vendor/PDFJS-LICENSE.txt"/>
      <file href="pdfs/${escapeXml(pdfFileName)}"/>
    </resource>
  </resources>
</manifest>`;

const buildIndex = (document: PdfCourseDocument, pdfFileName: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(document.title)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="sop-header">
    <div>
      <p class="eyebrow">${escapeHtml(document.sopNumber || 'SOP acknowledgement')}</p>
      <h1>${escapeHtml(document.title)}</h1>
      ${document.description ? `<p class="instructions">${escapeHtml(document.description)}</p>` : ''}
    </div>
    <div class="progress-card" aria-live="polite">
      <strong id="progress-percent">0%</strong>
      <span id="progress-label">Preparing document...</span>
    </div>
  </header>
  <main>
    <div id="status" class="status">Loading PDF...</div>
    <div id="pdf-scroll" class="pdf-scroll" tabindex="0" aria-label="Scrollable SOP document">
      <div id="pdf-pages" class="pdf-pages"></div>
    </div>
    <section class="ack-panel">
      <div>
        <h2>Acknowledgement</h2>
        <p>${escapeHtml(document.acknowledgementText)}</p>
        <p id="unlock-help" class="unlock-help">Review the required document progress to unlock acknowledgement.</p>
      </div>
      <button id="acknowledge" type="button" disabled>Acknowledge and complete</button>
    </section>
    <div id="completion-message" class="completion-message" hidden role="status">
      Completed. Your acknowledgement has been recorded.
    </div>
  </main>
  <script>
    (function(){
      function showRuntimeError(message){
        var status=document.getElementById('status');
        if(!status)return;
        status.classList.add('error');
        status.textContent='PDF viewer failed to start: '+message;
      }
      window.addEventListener('error',function(event){
        showRuntimeError(event.message||'Unknown script loading error.');
      });
      window.addEventListener('unhandledrejection',function(event){
        var reason=event.reason;
        showRuntimeError(reason&&reason.message?reason.message:String(reason||'Unknown module error.'));
      });
      window.setTimeout(function(){
        var status=document.getElementById('status');
        if(status&&status.textContent==='Loading PDF...'){
          showRuntimeError('The PDF.js runtime did not load. Check that vendor/pdf.min.js and vendor/pdf.worker.min.js are available.');
        }
      },12000);
    })();
    window.PDF_COURSE_CONFIG = ${JSON.stringify({
      title: document.title,
      pdfPath: `pdfs/${pdfFileName}`,
      requiredScrollThreshold: document.requiredScrollThreshold,
      estimatedTimeMinutes: document.estimatedTimeMinutes || null,
    }).replace(/</g, '\\u003c')};
  </script>
  <script src="vendor/pdf.min.js"></script>
  <script src="runtime.js"></script>
</body>
</html>`;

const styles = `:root{color-scheme:light;--ink:#18221d;--paper:#f4f0e7;--cream:#fffdf7;--rule:#c9bea8;--accent:#a9472b;--green:#41644a}*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Georgia,"Times New Roman",serif;background:var(--paper);color:var(--ink)}body{padding:0 0 40px}.sop-header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:24px;align-items:center;padding:18px 28px;background:rgba(255,253,247,.97);border-bottom:2px solid var(--ink);box-shadow:0 8px 24px rgba(24,34,29,.08)}.eyebrow{margin:0 0 4px;text-transform:uppercase;letter-spacing:.14em;font:700 11px/1.3 Arial,sans-serif;color:var(--accent)}h1{margin:0;font-size:clamp(22px,3vw,34px);line-height:1.1}.instructions{margin:8px 0 0;max-width:760px;color:#526058;font:14px/1.45 Arial,sans-serif}.progress-card{min-width:128px;padding:10px 14px;border:1px solid var(--rule);background:var(--paper);text-align:right}.progress-card strong{display:block;font:800 24px/1 Arial,sans-serif}.progress-card span{font:11px/1.3 Arial,sans-serif;color:#59645d}main{width:min(1180px,calc(100% - 28px));margin:20px auto}.status{padding:12px 16px;border:1px solid var(--rule);background:var(--cream);font:13px Arial,sans-serif}.pdf-scroll{height:calc(100vh - 270px);min-height:420px;overflow:auto;margin-top:12px;padding:24px;background:#343a36;border:3px solid var(--ink);scrollbar-color:var(--accent) #222}.pdf-pages{display:flex;flex-direction:column;align-items:center;gap:22px}.pdf-page{position:relative;background:white;box-shadow:0 12px 30px rgba(0,0,0,.32)}.page-number{position:absolute;right:8px;bottom:6px;padding:3px 7px;background:rgba(24,34,29,.85);color:white;font:11px Arial,sans-serif}.pdf-page canvas{display:block;max-width:100%;height:auto}.ack-panel{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-top:18px;padding:20px 22px;background:var(--cream);border:2px solid var(--ink)}.ack-panel h2{margin:0 0 6px}.ack-panel p{margin:0;line-height:1.5}.unlock-help{margin-top:8px!important;color:#6a746d;font:12px Arial,sans-serif}.ack-panel button{min-width:220px;padding:14px 18px;border:0;background:var(--green);color:white;font:800 14px Arial,sans-serif;cursor:pointer}.ack-panel button:disabled{background:#a8aea9;cursor:not-allowed}.completion-message{margin-top:14px;padding:16px 20px;background:#e2efe4;border:2px solid var(--green);font-weight:700}.error{color:#8d2518;border-color:#b64b39;background:#fff0ed}@media(max-width:760px){.sop-header,.ack-panel{align-items:flex-start;flex-direction:column}.progress-card{width:100%;text-align:left}.pdf-scroll{height:62vh;padding:10px}.ack-panel button{width:100%}}`;

const runtime = `const pdfjsLib = window.pdfjsLib;
if(!pdfjsLib)throw new Error('The local PDF.js library did not initialize.');
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';

const config = window.PDF_COURSE_CONFIG;
const scrollBox = document.getElementById('pdf-scroll');
const pagesBox = document.getElementById('pdf-pages');
const statusBox = document.getElementById('status');
const percentBox = document.getElementById('progress-percent');
const labelBox = document.getElementById('progress-label');
const acknowledgeButton = document.getElementById('acknowledge');
const unlockHelp = document.getElementById('unlock-help');
const completionMessage = document.getElementById('completion-message');
const startedAt = Date.now();
let api = null;
let totalPages = 0;
let maxPageReached = 0;
let percentViewed = 0;
let endReached = false;
let acknowledgementClicked = false;
let completed = false;

function findApi(win){
  let current=win;
  for(let i=0;i<12&&current;i++){
    try{if(current.API)return current.API;}catch(_){}
    try{if(current.parent===current)break;current=current.parent;}catch(_){break;}
  }
  try{current=window.opener;for(let i=0;i<12&&current;i++){if(current.API)return current.API;if(current.parent===current)break;current=current.parent;}}catch(_){}
  return null;
}
function call(name,...args){try{return api&&typeof api[name]==='function'?api[name](...args):null}catch(_){return null}}
function state(){return{maxPageReached,totalPages,percentViewed,endReached,acknowledgementClicked,completed,timestamp:new Date().toISOString()}}
function save(){
  if(!api)return;
  call('LMSSetValue','cmi.suspend_data',JSON.stringify(state()));
  call('LMSSetValue','cmi.core.lesson_location',String(maxPageReached));
  call('LMSSetValue','cmi.core.score.raw',completed?'100':String(Math.round(percentViewed)));
  call('LMSCommit','');
}
function restore(){
  if(!api)return;
  const raw=call('LMSGetValue','cmi.suspend_data');
  if(!raw)return;
  try{
    const saved=JSON.parse(raw);
    maxPageReached=Number(saved.maxPageReached)||0;
    percentViewed=Number(saved.percentViewed)||0;
    endReached=Boolean(saved.endReached);
    acknowledgementClicked=Boolean(saved.acknowledgementClicked);
    completed=Boolean(saved.completed);
  }catch(_){}
}
function sessionTime(){
  const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
  const h=String(Math.floor(seconds/3600)).padStart(2,'0');
  const m=String(Math.floor((seconds%3600)/60)).padStart(2,'0');
  const s=String(seconds%60).padStart(2,'0');
  return h+':'+m+':'+s;
}
function finish(){
  if(!api)return;
  call('LMSSetValue','cmi.core.session_time',sessionTime());
  save();
  call('LMSFinish','');
}
function updateUi(){
  percentBox.textContent=Math.round(percentViewed)+'%';
  labelBox.textContent=totalPages?('Page '+Math.min(maxPageReached,totalPages)+' of '+totalPages):'Preparing document...';
  const thresholdReached=endReached&&percentViewed>=config.requiredScrollThreshold;
  acknowledgeButton.disabled=!thresholdReached||completed;
  unlockHelp.textContent=completed?'Acknowledgement recorded.':thresholdReached?'Document review requirement reached. You may now acknowledge.':('Reach '+config.requiredScrollThreshold+'% document progress to unlock.');
  completionMessage.hidden=!completed;
}
function trackProgress(){
  if(!totalPages)return;
  const viewBottom=scrollBox.scrollTop+scrollBox.clientHeight;
  document.querySelectorAll('.pdf-page').forEach((page,index)=>{
    if(page.offsetTop<=viewBottom-20)maxPageReached=Math.max(maxPageReached,index+1);
  });
  const atBottom=scrollBox.scrollTop+scrollBox.clientHeight>=scrollBox.scrollHeight-24;
  if(atBottom){maxPageReached=totalPages;endReached=true;}
  percentViewed=Math.max(percentViewed,(maxPageReached/totalPages)*100);
  updateUi();
  save();
}
async function render(){
  try{
    api=findApi(window);
    if(api){
      call('LMSInitialize','');
      restore();
      if(!completed)call('LMSSetValue','cmi.core.lesson_status','incomplete');
    }
    const loadingTask=pdfjsLib.getDocument(config.pdfPath);
    const pdf=await loadingTask.promise;
    totalPages=pdf.numPages;
    for(let pageNumber=1;pageNumber<=totalPages;pageNumber++){
      const page=await pdf.getPage(pageNumber);
      const base=page.getViewport({scale:1});
      const available=Math.max(280,scrollBox.clientWidth-64);
      const scale=Math.min(1.6,available/base.width);
      const viewport=page.getViewport({scale});
      const wrapper=document.createElement('div');
      wrapper.className='pdf-page';
      wrapper.dataset.page=String(pageNumber);
      const canvas=document.createElement('canvas');
      const ratio=window.devicePixelRatio||1;
      canvas.width=Math.floor(viewport.width*ratio);
      canvas.height=Math.floor(viewport.height*ratio);
      canvas.style.width=Math.floor(viewport.width)+'px';
      canvas.style.height=Math.floor(viewport.height)+'px';
      const context=canvas.getContext('2d');
      const badge=document.createElement('span');
      badge.className='page-number';
      badge.textContent='Page '+pageNumber+' / '+totalPages;
      wrapper.append(canvas,badge);
      pagesBox.appendChild(wrapper);
      await page.render({canvas,canvasContext:context,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:undefined}).promise;
    }
    statusBox.textContent='Document loaded. Scroll through the controlled viewer to record progress.';
    const resumePage=Math.min(maxPageReached,totalPages);
    if(resumePage>1){
      const resumeElement=pagesBox.querySelector('[data-page="'+resumePage+'"]');
      if(resumeElement)scrollBox.scrollTop=Math.max(0,resumeElement.offsetTop-12);
    }
    updateUi();
    trackProgress();
  }catch(error){
    statusBox.classList.add('error');
    statusBox.textContent='The PDF could not be rendered: '+(error&&error.message?error.message:String(error));
  }
}
scrollBox.addEventListener('scroll',trackProgress,{passive:true});
acknowledgeButton.addEventListener('click',()=>{
  if(acknowledgeButton.disabled)return;
  acknowledgementClicked=true;
  completed=true;
  if(api){
    call('LMSSetValue','cmi.core.lesson_status','completed');
    call('LMSSetValue','cmi.core.score.raw','100');
    save();
  }
  updateUi();
});
window.addEventListener('beforeunload',finish);
render();`;

export interface PdfScormPackage {
  blob: Blob;
  fileName: string;
}

export const buildPdfScormPackage = async (
  project: PdfCourseProject,
  document: PdfCourseDocument,
): Promise<PdfScormPackage> => {
  const zip = new JSZip();
  const pdfFileName = sanitizePdfFileName(document.fileName);
  const [pdfLibrary, pdfWorker] = await getPdfJsAssets();

  zip.file('imsmanifest.xml', buildManifest(document, pdfFileName));
  zip.file('index.html', buildIndex(document, pdfFileName));
  zip.file('styles.css', styles);
  zip.file('runtime.js', runtime);
  zip.file(`pdfs/${pdfFileName}`, document.file);
  zip.file('vendor/pdf.min.js', pdfLibrary);
  zip.file('vendor/pdf.worker.min.js', pdfWorker);
  zip.file('vendor/PDFJS-LICENSE.txt', pdfJsLicense);
  zip.file('pdf-course-metadata.json', JSON.stringify({
    projectId: project.id,
    projectName: project.name,
    documentId: document.id,
    title: document.title,
    sopNumber: document.sopNumber,
    category: document.category,
    completionMethod: document.completionMethod,
    requiredScrollThreshold: document.requiredScrollThreshold,
    generatedAt: new Date().toISOString(),
  }, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const verificationZip = await JSZip.loadAsync(blob);
  const requiredFiles = [
    'imsmanifest.xml',
    'index.html',
    'runtime.js',
    'vendor/pdf.min.js',
    'vendor/pdf.worker.min.js',
    'vendor/PDFJS-LICENSE.txt',
    `pdfs/${pdfFileName}`,
  ];
  const missingFiles = requiredFiles.filter(path => !verificationZip.file(path));
  if (missingFiles.length) {
    throw new Error(`SCORM package validation failed for ${document.title}. Missing: ${missingFiles.join(', ')}`);
  }

  return {
    blob,
    fileName: `${safeZipName(document.sopNumber ? `${document.sopNumber}_${document.title}` : document.title)}_SCORM1.2.zip`,
  };
};
