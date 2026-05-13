import JSZip from 'jszip';
import { FileSystemDirectoryHandle, MediaItem, Question, ScormProject, Topic, WelcomePage, LearningObjectivesPage } from '../types';

type Page = Topic | WelcomePage | LearningObjectivesPage;

const escapeXml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));
const escapeHtml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]!));
const safeId = (value: string) => value.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();

const getMediaKind = (media: MediaItem) => (media.type || '').toLowerCase();

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

const renderTopMedia = (page: Page, assetMap: Map<string, string>, captionMap: Map<string, string>) => {
  const visual = (page.media || []).filter(media => ['image', 'video'].includes(getMediaKind(media)));
  const audio = (page.media || []).find(media => getMediaKind(media) === 'audio');
  const visualHtml = visual.map(media => {
    const kind = getMediaKind(media);
    const src = assetMap.get(media.storageId) || media.url || '';
    if (!src) return '';
    if (kind === 'image') {
      return `<figure class="media-frame"><img src="${escapeHtml(src)}" alt="${escapeHtml(media.title || page.title)}"></figure>`;
    }
    if (src.includes('youtube.com/embed') || src.includes('youtu.be')) {
      return `<div class="video-frame"><iframe src="${escapeHtml(src)}" title="${escapeHtml(media.title || 'Video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    }
    return `<div class="video-frame"><video controls src="${escapeHtml(src)}"></video></div>`;
  }).filter(Boolean).join('');

  const audioSrc = audio ? (assetMap.get(audio.storageId) || audio.url || '') : '';
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

const renderPage = (page: Page, assetMap: Map<string, string>, captionMap: Map<string, string>) => {
  const media = renderTopMedia(page, assetMap, captionMap);
  return `<div class="content-wrapper">
    <section class="page-card">
      <div class="page-header"><h2>${escapeHtml(page.title)}</h2></div>
      ${media}
      <main class="content-column">
        <div class="topic-text">${page.content || ''}</div>
        ${renderKnowledgeCheck(page)}
      </main>
    </section>
  </div>`;
};

const buildStyles = () => `*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:"Century Gothic","Segoe UI",Arial,sans-serif;background:#17141d;color:#f7f3ff}body{display:flex;overflow:hidden}.sidebar{width:250px;background:#0f0e13;border-right:1px solid #3b3148;height:100vh;display:flex;flex-direction:column}.sidebar-header{padding:22px;border-bottom:1px solid #31283d}.course-title{font-size:15px;font-weight:700;line-height:1.35}.progress-wrap{margin-top:14px}.progress-bar{height:8px;background:#272231;border-radius:999px;overflow:hidden}.progress-fill{height:100%;width:0;background:linear-gradient(90deg,#8b5cf6,#5b21b6);transition:width .25s ease}.progress-text{font-size:12px;color:#cfc5e3;margin-top:7px}.sidebar-nav{padding:12px;overflow:auto;flex:1}.nav-item{display:block;color:#cfc5e3;text-decoration:none;padding:10px 12px;border-radius:7px;margin-bottom:4px;font-size:13px;transition:all .16s ease}.nav-item:hover,.nav-item.active{background:rgba(124,58,237,.18);color:#fff;box-shadow:0 0 24px -16px rgba(167,139,250,.9)}.main-area{flex:1;height:100vh;display:flex;flex-direction:column;background:radial-gradient(circle at 78% 10%,rgba(124,58,237,.18),transparent 30rem),#17141d}.header{padding:18px 28px;border-bottom:1px solid #3b3148;background:#1b1821;display:flex;justify-content:space-between;gap:18px;align-items:center}.header h1{font-size:20px;margin:0}.content-container{flex:1;overflow:auto;padding:26px}.footer{padding:14px 24px;border-top:1px solid #3b3148;background:#1b1821;display:flex;justify-content:space-between;align-items:center;gap:18px}.gate-message{flex:1;text-align:center;font-size:13px;color:#d9ccff}.nav-button,.check-button{border:0;border-radius:7px;padding:10px 18px;color:#fff;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#8b5cf6,#4c1d95);transition:transform .16s ease,box-shadow .16s ease}.nav-button:hover,.check-button:hover{transform:translateY(-1px);box-shadow:0 16px 44px -24px rgba(167,139,250,.95)}.nav-button:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}.secondary{background:#272231;color:#d7cdeb}.page-card{background:#211d29;border:1px solid #463855;border-radius:8px;padding:24px;box-shadow:0 24px 70px -48px #000}.page-header h2{margin:0 0 18px;font-size:26px}.top-media-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:16px;align-items:start;margin:0 0 24px}.visual-media-strip{display:flex;gap:16px;overflow-x:auto;overflow-y:hidden;scrollbar-color:#8b5cf6 #17141d;scrollbar-width:thin;padding:2px 2px 12px;min-height:170px}.visual-media-strip.empty-strip{min-height:0;padding:0}.media-frame,.video-frame{margin:0;flex:0 0 min(58vw,620px);border:1px solid #463855;border-radius:10px;background:#111016;overflow:hidden;box-shadow:0 16px 40px -34px #000}.media-frame img{display:block;width:100%;height:100%;max-height:340px;object-fit:contain;background:#0f0e13}.video-frame{aspect-ratio:16/9;height:min(340px,30vw)}.video-frame iframe,.video-frame video{width:100%;height:100%;border:0;display:block}.audio-dock{position:sticky;top:0;background:linear-gradient(160deg,#17141d,#211d29);border:1px solid #5a4a6a;border-radius:10px;padding:14px;box-shadow:0 18px 48px -36px rgba(167,139,250,.9)}.audio-title{font-size:13px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:#d9ccff;margin-bottom:10px}.audio-dock audio{width:100%}.caption-toggle{margin-top:10px;border:1px solid #6d56a3;border-radius:999px;background:#14111b;color:#d9ccff;font-weight:800;font-size:12px;letter-spacing:.04em;padding:7px 12px;cursor:pointer;transition:all .16s ease}.caption-toggle:hover,.caption-toggle[aria-pressed="true"]{background:linear-gradient(135deg,#8b5cf6,#4c1d95);color:#fff;box-shadow:0 12px 30px -20px rgba(167,139,250,.95)}.synced-caption{margin-top:12px;min-height:70px;border-radius:8px;background:#0f0e13;border:1px solid #463855;padding:12px 14px;color:#fff;font-size:15px;line-height:1.5}.synced-caption[hidden]{display:none}.synced-caption.is-active{border-color:#8b5cf6;box-shadow:0 0 28px -18px rgba(167,139,250,.95)}.content-column{max-width:1120px}.topic-text{font-size:17px;line-height:1.65;color:#f7f3ff}.topic-text h2,.topic-text h3{color:#fff}.topic-text table{width:100%;border-collapse:collapse;margin:16px 0}.topic-text th,.topic-text td{border:1px solid #5a4a6a;padding:10px;text-align:left}.topic-text th{background:#30283b}.knowledge-check,.assessment-card{margin-top:24px;background:#17141d;border:1px solid #463855;border-radius:8px;padding:18px}.question{margin:16px 0;padding:14px;border-radius:7px;background:#211d29;border:1px solid #3f344d}.question-text{font-weight:700}.option{display:flex;gap:10px;align-items:center;margin:8px 0;padding:8px;border-radius:6px;background:#17141d}.feedback,.assessment-result{margin-top:10px;font-weight:700}.feedback.correct,.assessment-result.pass{color:#a78bfa}.feedback.incorrect,.assessment-result.fail{color:#fca5a5}.muted{color:#cfc5e3}.scorm-alert{position:fixed;right:20px;top:20px;background:#211d29;border:1px solid #8b5cf6;color:#fff;padding:12px 16px;border-radius:8px;z-index:1000}@media(max-width:900px){body{display:block;overflow:auto}.sidebar{width:100%;height:auto}.main-area{height:auto}.content-container{padding:16px}.top-media-layout{display:flex;flex-direction:column}.audio-dock{position:relative;width:100%}.media-frame,.video-frame{flex-basis:min(86vw,620px)}.video-frame{height:auto}}`;

const buildScormApi = () => `window.SCORM={api:null,initialized:false,findAPI:function(w){var tries=0;while(w&&tries<10){if(w.API)return w.API;w=w.parent;tries++}return null},init:function(){this.api=this.findAPI(window)||this.findAPI(window.opener);if(this.api&&!this.initialized){this.api.LMSInitialize('');this.initialized=true}return this.initialized},set:function(k,v){try{if(this.api)this.api.LMSSetValue(k,String(v))}catch(e){}},commit:function(){try{if(this.api)this.api.LMSCommit('')}catch(e){}},finish:function(){try{if(this.api)this.api.LMSFinish('')}catch(e){}}};window.addEventListener('load',function(){SCORM.init();SCORM.set('cmi.core.lesson_status','incomplete');SCORM.commit()});window.addEventListener('beforeunload',function(){SCORM.commit();SCORM.finish()});`;

const buildExportContentStyles = () => `.topic-text ul,.topic-text ol{margin:12px 0 16px;padding-left:28px}.topic-text ul{list-style:disc}.topic-text ol{list-style:decimal}.topic-text li{margin:6px 0;padding-left:3px}.topic-text li>ul,.topic-text li>ol{margin:6px 0 6px 8px}.topic-text table{table-layout:auto;margin:16px 0 20px}.topic-text th,.topic-text td{vertical-align:top}.topic-text th{color:#fff}.topic-text tr:nth-child(even) td{background:#272231}`;

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
  static async createScormPackage(project: ScormProject, assetsHandle: FileSystemDirectoryHandle | null): Promise<Blob> {
    const zip = new JSZip();
    const title = project.courseData.title || project.project.name;
    const pages: Page[] = [project.courseContent.welcomePage, project.courseContent.learningObjectivesPage, ...project.courseContent.topics];
    const pageEntries = [...pages.map(page => ({ id: safeId(page.id), title: page.title })), { id: 'assessment', title: 'Assessment' }];
    const assetMap = new Map<string, string>();
    const captionMap = new Map<string, string>();

    if (assetsHandle) {
      try {
        // @ts-ignore browser File System Access API async iterator
        for await (const entry of assetsHandle.values()) {
          if (entry.kind !== 'file') continue;
          const file = await (entry as any).getFile();
          if (entry.name.toLowerCase().endsWith('.json')) continue;
          const href = `media/${entry.name}`;
          zip.file(href, file);
          const storageId = entry.name.replace(/\.[^.]+$/, '');
          assetMap.set(storageId, href);
        }
      } catch (error) {
        console.warn('Unable to include linked assets in package.', error);
      }
    }

    for (const page of pages) {
      if (!page.caption?.trim()) continue;
      const captionName = `caption-${safeId(page.id)}.vtt`;
      const captionHref = `media/${captionName}`;
      zip.file(captionHref, page.caption.startsWith('WEBVTT') ? page.caption : `WEBVTT\n\n${page.caption}`);
      captionMap.set(page.id, captionHref);
    }

    zip.file('styles/main.css', buildStyles() + buildExportContentStyles());
    zip.file('scripts/scorm-api.js', buildScormApi());
    zip.file('scripts/navigation.js', buildNavigation(pageEntries, project.courseContent.assessment.passMark || 80, project.scormConfig));
    zip.file('project.json', JSON.stringify(project, null, 2));

    for (const page of pages) {
      zip.file(`pages/${safeId(page.id)}.html`, renderPage(page, assetMap, captionMap));
    }
    zip.file('pages/assessment.html', renderAssessment(project));

    zip.file('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="styles/main.css"><script src="scripts/scorm-api.js"></script></head><body><nav class="sidebar"><div class="sidebar-header"><div class="course-title">${escapeHtml(title)}</div><div class="progress-wrap"><div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div><div id="progress-text" class="progress-text">0% complete</div></div></div><div class="sidebar-nav">${pageEntries.map((page, index) => `<a href="#" class="nav-item" data-index="${index}">${escapeHtml(index > 1 && page.id !== 'assessment' ? `${index - 1}. ${page.title}` : page.title)}</a>`).join('')}</div></nav><main class="main-area"><header class="header"><h1>${escapeHtml(title)}</h1></header><div id="content-container" class="content-container"></div><footer class="footer"><button id="prev-button" class="nav-button secondary" type="button">Previous</button><div id="gate-message" class="muted gate-message"></div><button id="next-button" class="nav-button primary" type="button">Next</button></footer></main><script src="scripts/navigation.js"></script></body></html>`);

    const fileList = [
      'index.html',
      'styles/main.css',
      'scripts/scorm-api.js',
      'scripts/navigation.js',
      'project.json',
      ...pageEntries.map(page => `pages/${page.id}.html`),
      ...Array.from(assetMap.values()),
      ...Array.from(captionMap.values()),
    ];

    zip.file('imsmanifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${escapeXml(project.project.id)}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="default_org"><organization identifier="default_org"><title>${escapeXml(title)}</title><item identifier="item_1" identifierref="main"><title>${escapeXml(title)}</title><adlcp:masteryscore>${project.courseContent.assessment.passMark || 80}</adlcp:masteryscore></item></organization></organizations>
  <resources><resource identifier="main" type="webcontent" adlcp:scormtype="sco" href="index.html">${fileList.map(file => `<file href="${escapeXml(file)}"/>`).join('')}</resource></resources>
</manifest>`);

    return zip.generateAsync({ type: 'blob' });
  }
}
