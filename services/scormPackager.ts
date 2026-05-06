import JSZip from 'jszip';
import { FileSystemDirectoryHandle, ScormProject } from '../types';

const escapeXml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));

export class ScormPackager {
  static async createScormPackage(project: ScormProject, assetsHandle: FileSystemDirectoryHandle | null): Promise<Blob> {
    const zip = new JSZip();
    const title = escapeXml(project.courseData.title || project.project.name);

    zip.file('imsmanifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${escapeXml(project.project.id)}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1"><organization identifier="ORG-1"><title>${title}</title><item identifier="ITEM-1" identifierref="RES-1"><title>${title}</title></item></organization></organizations>
  <resources><resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/><file href="scorm-api.js"/><file href="project.json"/></resource></resources>
</manifest>`);

    zip.file('project.json', JSON.stringify(project, null, 2));
    zip.file('scorm-api.js', `function findAPI(win){return win.API||null;} window.API = window.API || { LMSInitialize:function(){return 'true';}, LMSFinish:function(){return 'true';}, LMSGetValue:function(){return '';}, LMSSetValue:function(){return 'true';}, LMSCommit:function(){return 'true';}, LMSGetLastError:function(){return '0';}, LMSGetErrorString:function(){return '';}, LMSGetDiagnostic:function(){return '';} };`);
    zip.file('index.html', `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,sans-serif;margin:2rem;line-height:1.5}.topic{margin:2rem 0;padding-bottom:1rem;border-bottom:1px solid #ddd}</style></head><body><main id="course"></main><script src="scorm-api.js"></script><script>const p=${JSON.stringify(project)};const pages=[p.courseContent.welcomePage,p.courseContent.learningObjectivesPage,...p.courseContent.topics];document.getElementById('course').innerHTML='<h1>'+p.courseData.title+'</h1>'+pages.map(x=>'<section class="topic"><h2>'+x.title+'</h2>'+x.content+'</section>').join('');</script></body></html>`);

    if (assetsHandle) {
      try {
        // @ts-ignore browser File System Access API async iterator
        for await (const entry of assetsHandle.values()) {
          if (entry.kind === 'file') {
            const file = await (entry as any).getFile();
            zip.file(`assets/${entry.name}`, file);
          }
        }
      } catch (error) {
        console.warn('Unable to include linked assets in package.', error);
      }
    }

    return zip.generateAsync({ type: 'blob' });
  }
}
