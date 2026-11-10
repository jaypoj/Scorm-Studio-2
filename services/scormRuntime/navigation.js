// Runtime bundled into each exported SCORM 1.2 SCO.
// PAGES and COURSE_SETTINGS are prepended by services/scormPackager.ts.
'use strict';

const sessionStartedAt = Date.now();
const hasAssessment = Boolean(COURSE_SETTINGS.hasAssessment);
const passMark = COURSE_SETTINGS.passMark;
const maxAttempts = COURSE_SETTINGS.maxAttempts;
const scoreTracking = COURSE_SETTINGS.scoreTracking;
const reviewPolicy = COURSE_SETTINGS.reviewPolicy;
const knowledgePolicy = COURSE_SETTINGS.knowledgeCheckPolicy;
const pageIds = new Set(PAGES.map(page => page.id));
const contentPages = PAGES.filter(page => !page.assessment);
const previewKey = 'scormArchitectPreview:' + COURSE_SETTINGS.projectId;
if (window.SCORM) window.SCORM.configure({ scoreTracking: scoreTracking });
const connected = Boolean(window.SCORM && window.SCORM.init());
let current = 0;
let navigating = false;
let failedPageIndex = -1;
let exitCompleted = false;
let exiting = false;
let lastSaveError = '';
const previewMode = !connected;

function el(id) { return document.getElementById(id); }
function showStatus(message, isError) {
  const region = el('runtime-status');
  if (region) {
    region.textContent = message;
    region.className = 'runtime-status' + (isError ? ' is-error' : '');
    region.hidden = !message;
  }
}
function showAlert(message) {
  const region = el('runtime-alert');
  if (region) {
    region.textContent = message;
    region.hidden = !message;
  }
}
function parseJson(text) {
  if (!text || typeof text !== 'string') return {};
  try { const parsed = JSON.parse(text); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch (error) { return {}; }
}
const isolatedPreview = window.origin === 'null'; // Opaque origin: srcDoc sandbox without allow-same-origin.
let ephemeralPreviewData = '';
function readPreviewState() {
  if (isolatedPreview) return parseJson(ephemeralPreviewData);
  try { return parseJson(window.localStorage.getItem(previewKey)); } catch (error) { return {}; }
}
function readStoredState() {
  // The LMS is authoritative. Never merge or fall back to another registration's browser state.
  return connected ? parseJson(window.SCORM.get('cmi.suspend_data')) : readPreviewState();
}
const storedState = readStoredState();

function encodePages(set) {
  const bytes = new Uint8Array(Math.ceil(PAGES.length / 8));
  PAGES.forEach((page, index) => { if (set.has(page.id)) bytes[index >> 3] |= 1 << (index & 7); });
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function decodePages(bitString) {
  const output = new Set();
  if (typeof bitString !== 'string') return output;
  try {
    const binary = atob(bitString);
    PAGES.forEach((page, index) => {
      if ((binary.charCodeAt(index >> 3) || 0) & (1 << (index & 7))) output.add(page.id);
    });
  } catch (error) { /* Malformed older state is treated as empty. */ }
  return output;
}
function restoreSet(bitKey, legacyKey) {
  if (storedState.v === 2) return decodePages(storedState[bitKey === 'v' ? 'w' : bitKey]);
  const saved = Array.isArray(storedState[legacyKey]) ? storedState[legacyKey] : [];
  return new Set(saved.filter(id => pageIds.has(id)));
}
const visited = restoreSet('v', 'visited');
const completedKnowledgeChecks = restoreSet('k', 'knowledgeChecks');
const completedAudioPages = restoreSet('u', 'audioPages');
const savedAssessment = storedState.a && typeof storedState.a === 'object' ? storedState.a : {};
const assessmentState = {
  attempts: Math.max(0, Math.floor(Number(savedAssessment.n) || 0)),
  submitted: Boolean(savedAssessment.d),
  score: savedAssessment.s == null ? null : (Number.isFinite(Number(savedAssessment.s)) ? Number(savedAssessment.s) : null),
  passed: Boolean(savedAssessment.ok),
  answers: Array.isArray(savedAssessment.ans) ? savedAssessment.ans : [],
  // The reported result may differ from the most recent score under best/first tracking.
  reportedScore: savedAssessment.rs != null && Number.isFinite(Number(savedAssessment.rs)) ? Number(savedAssessment.rs) : null,
  reportedStatus: ['passed', 'failed'].includes(savedAssessment.st) ? savedAssessment.st : '',
};
// If an older package left a confirmed LMS pass without suspend state, honor the LMS result.
// Do not erase an explicitly saved in-progress retake (which has an assessment state).
if (connected && !storedState.a && window.SCORM.get('cmi.core.lesson_status') === 'passed') {
  const oldRawScore = window.SCORM.get('cmi.core.score.raw');
  const oldScore = oldRawScore.trim() !== '' && Number.isFinite(Number(oldRawScore)) ? Number(oldRawScore) : null;
  assessmentState.submitted = true;
  assessmentState.passed = true;
  assessmentState.score = oldScore;
  assessmentState.reportedScore = oldScore;
  assessmentState.reportedStatus = 'passed';
  assessmentState.attempts = 1;
}

function currentPageId() { return PAGES[current] ? PAGES[current].id : ''; }
function viewedPercent() {
  if (!contentPages.length) return 100;
  const count = contentPages.filter(page => visited.has(page.id)).length;
  return Math.max(0, Math.min(100, Math.round((count / contentPages.length) * 100)));
}
function requiredActivitiesComplete() {
  return PAGES.every(page => page.assessment ||
    ((knowledgePolicy !== 'pass' && knowledgePolicy !== 'attempt' || !page.knowledge || completedKnowledgeChecks.has(page.id)) &&
     (!COURSE_SETTINGS.requireAudioCompletionBeforeContinue || !page.audio || completedAudioPages.has(page.id))));
}
function renderProgress() {
  const progress = viewedPercent();
  if (el('progress-fill')) el('progress-fill').style.width = progress + '%';
  if (el('progress-text')) el('progress-text').textContent = progress + '% of lessons viewed';
}
function progressPayload() {
  return {
    v: 2,
    p: current,
    w: encodePages(visited),
    k: encodePages(completedKnowledgeChecks),
    u: encodePages(completedAudioPages),
    a: {
      n: assessmentState.attempts,
      d: assessmentState.submitted ? 1 : 0,
      s: assessmentState.score,
      ok: assessmentState.passed ? 1 : 0,
      ans: assessmentState.answers,
      rs: assessmentState.reportedScore,
      st: assessmentState.reportedStatus
    }
  };
}
function persistState(commitNow) {
  renderProgress();
  lastSaveError = '';
  const serialized = JSON.stringify(progressPayload());
  if (serialized.length > 4096) {
    lastSaveError = 'Resume data exceeds the SCORM 1.2 limit of 4,096 characters. Progress was not saved.';
    showStatus(lastSaveError, true);
    return false;
  }
  if (previewMode) {
    if (isolatedPreview) { ephemeralPreviewData = serialized; return true; } // Only for this Preview window.
    try { window.localStorage.setItem(previewKey, serialized); return true; }
    catch (error) {
      lastSaveError = 'Browser preview storage is unavailable.';
      showStatus(lastSaveError, true);
      return false;
    }
  }
  const scorm = window.SCORM;
  let ok = scorm.set('cmi.suspend_data', serialized);
  ok = scorm.set('cmi.core.lesson_location', currentPageId()) && ok;
  ok = scorm.set('cmi.core.exit', 'suspend') && ok;
  // The saved passing result is never replaced by page visits or a new retake.
  if (!hasAssessment && viewedPercent() === 100 && requiredActivitiesComplete()) {
    const status = scorm.get('cmi.core.lesson_status');
    if (status !== 'passed' && status !== 'completed') ok = scorm.set('cmi.core.lesson_status', 'completed') && ok;
  } else {
    const status = scorm.get('cmi.core.lesson_status');
    if (status === 'completed' && hasAssessment || !['passed', 'completed', 'failed', 'incomplete'].includes(status)) {
      ok = scorm.set('cmi.core.lesson_status', 'incomplete') && ok;
    }
  }
  if (assessmentState.submitted && assessmentState.reportedStatus) {
    if (assessmentState.reportedScore !== null) {
      ok = scorm.set('cmi.core.score.raw', assessmentState.reportedScore) && ok;
      ok = scorm.set('cmi.core.score.min', '0') && ok;
      ok = scorm.set('cmi.core.score.max', '100') && ok;
    }
    ok = scorm.set('cmi.core.lesson_status', assessmentState.reportedStatus) && ok;
  }
  if (commitNow) ok = scorm.commit() && ok;
  if (!ok) {
    lastSaveError = 'The LMS could not save the learner state. ' + (scorm.lastError() || 'Try again.');
    showStatus(lastSaveError, true);
  }
  return ok;
}
function save() { return persistState(true); }

function pageGate(pageId) {
  const page = PAGES.find(item => item.id === pageId);
  if (!page || page.assessment) return [];
  const messages = [];
  if (page.knowledge && knowledgePolicy !== 'optional' && !completedKnowledgeChecks.has(pageId)) {
    messages.push(knowledgePolicy === 'attempt' ? 'Attempt the knowledge check to continue.' : 'Pass the knowledge check to continue.');
  }
  if (page.audio && COURSE_SETTINGS.requireAudioCompletionBeforeContinue && !completedAudioPages.has(pageId)) {
    messages.push('Listen to the full narration to continue.');
  }
  return messages;
}
function prerequisitesFor(target) {
  const messages = [];
  for (let i = 0; i < target; i++) {
    const page = PAGES[i];
    if (!page.assessment && !visited.has(page.id)) messages.push('Visit earlier lessons before advancing.');
    messages.push(...pageGate(page.id));
  }
  return [...new Set(messages)];
}
function getGateState() {
  const page = PAGES[current];
  if (!page) return ['No page is available.'];
  if (page.assessment) {
    if (!assessmentState.submitted || assessmentState.reportedStatus !== 'passed') return ['A passing result must be recorded under the selected score-tracking policy before finishing.'];
    return [];
  }
  return pageGate(page.id);
}
function updateNextGate() {
  const next = el('next-button');
  if (!next) return;
  const messages = getGateState();
  next.disabled = navigating || (failedPageIndex < 0 && messages.length > 0);
  next.title = failedPageIndex >= 0 ? 'Retry the page that failed to load' : messages.join(' ');
  if (el('gate-message')) el('gate-message').textContent = failedPageIndex >= 0
    ? 'Page loading failed. Select Retry Page to try again.' : messages.join(' ');
}
function setNav() {
  document.querySelectorAll('.nav-item').forEach((item, index) => {
    item.classList.toggle('active', index === current);
    if (index === current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  if (el('prev-button')) el('prev-button').disabled = navigating || current === 0;
  if (el('next-button')) el('next-button').textContent = failedPageIndex >= 0
    ? 'Retry Page' : current === PAGES.length - 1 ? 'Finish' : 'Next';
  updateNextGate();
}

function timeToSeconds(value) {
  const clean = String(value || '').trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(clean) || 0;
}
function cleanCaptionText(value) {
  const div = document.createElement('div');
  div.innerHTML = String(value || '').replace(/<[^>]+>/g, '');
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}
function parseVtt(text) {
  const source = String(text || '').replace(/\r/g, '').replace(/^\s*```(?:webvtt|vtt)?/i, '').replace(/```\s*$/, '');
  const lines = source.split('\n');
  const cues = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || !line.includes('-->')) continue;
    const timing = line.split('-->');
    const start = timeToSeconds(timing[0]);
    const end = timeToSeconds((timing[1] || '').trim().split(/\s+/)[0]);
    const textLines = [];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (next.includes('-->')) { i--; break; }
      if (!/^\d+$/.test(next)) textLines.push(next);
      i++;
    }
    const cueText = cleanCaptionText(textLines.join(' '));
    if (cueText && Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: cueText });
  }
  return cues;
}
function setCaptionText(box, text, active) {
  box.textContent = text;
  box.classList.toggle('is-active', Boolean(active));
}
function initializeCaptions() {
  document.querySelectorAll('.synced-caption[data-caption-src]').forEach(async box => {
    const audio = el(box.dataset.audioId);
    if (!audio) return;
    try {
      const response = await fetch(box.dataset.captionSrc, { cache: 'no-store' });
      if (!response.ok) throw new Error('Captions unavailable');
      const cues = parseVtt(await response.text());
      if (!cues.length) { setCaptionText(box, 'Captions are attached, but no timed lines were found.', false); return; }
      let lastText = '';
      const update = () => {
        const t = audio.currentTime;
        const cue = cues.find(item => t >= item.start && t <= item.end);
        const nextText = cue ? cue.text : (audio.paused && lastText ? lastText : 'Captions will appear during playback.');
        setCaptionText(box, nextText, Boolean(cue));
        if (cue) lastText = cue.text;
      };
      box._captionUpdate = update;
      for (const event of ['timeupdate', 'play', 'pause', 'seeked', 'loadedmetadata']) audio.addEventListener(event, update);
      update();
    } catch (error) { setCaptionText(box, 'Captions could not load in this player.', false); }
  });
}
function toggleCaptions(button) {
  const box = el(button.dataset.captionTarget);
  if (!box) return;
  const enabled = box.hidden;
  box.hidden = !enabled;
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? 'CC On' : 'CC Off';
  if (enabled && box._captionUpdate) box._captionUpdate();
}
function initializeCompletionGate() {
  const pageId = currentPageId();
  const check = document.querySelector('.knowledge-check');
  if (check && completedKnowledgeChecks.has(pageId)) {
    check.dataset.completed = 'true';
    const button = check.querySelector('.check-button');
    if (button) { button.textContent = 'Knowledge Check Complete'; button.disabled = true; }
  }
  document.querySelectorAll('.narration-audio').forEach(audio => {
    if (completedAudioPages.has(pageId)) audio.dataset.completed = 'true';
    const update = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (audio.ended || (duration > 0 && audio.currentTime >= Math.max(0, duration - .75))) {
        audio.dataset.completed = 'true';
        if (!completedAudioPages.has(pageId)) { completedAudioPages.add(pageId); save(); }
      }
      updateNextGate();
    };
    for (const event of ['timeupdate', 'ended', 'loadedmetadata']) audio.addEventListener(event, update);
    update();
  });
  updateNextGate();
}
function gradeQuestion(question, showFeedback) {
  const selected = question.querySelector('input:checked');
  const answer = selected ? String(selected.value).trim() : '';
  const correct = Boolean(selected && answer === String(question.dataset.correctOptionId).trim());
  if (showFeedback) {
    const feedback = question.querySelector('.feedback');
    if (feedback) {
      feedback.textContent = !selected ? 'Choose an answer first.' :
        correct ? question.dataset.correctFeedback : question.dataset.incorrectFeedback;
      feedback.className = 'feedback ' + (!selected || !correct ? 'incorrect' : 'correct');
    }
  }
  return { answered: Boolean(selected), correct: correct, answer: answer };
}
function submitKnowledgeCheck(button) {
  const box = button.closest('.knowledge-check');
  if (!box || box.dataset.completed === 'true') return;
  const questions = Array.from(box.querySelectorAll('.question'));
  if (!questions.length) return;
  const answers = questions.map(question => gradeQuestion(question, false));
  if (!answers.every(answer => answer.answered)) {
    questions.forEach(question => { if (!question.querySelector('input:checked')) gradeQuestion(question, true); });
    showAlert('Answer every knowledge-check question before submitting.');
    return;
  }
  const allCorrect = answers.every(answer => answer.correct);
  questions.forEach(question => gradeQuestion(question, true));
  if (allCorrect || knowledgePolicy === 'attempt') {
    completedKnowledgeChecks.add(currentPageId());
    box.dataset.completed = 'true';
    button.textContent = 'Knowledge Check Complete';
    button.disabled = true;
    // The question feedback and disabled submit button already confirm completion.
    // Clear any earlier warning instead of showing a redundant red success alert.
    showAlert('');
    save();
  } else {
    showAlert('Review the feedback and retry the knowledge check.');
  }
  updateNextGate();
}
function collectAnswers(questions) {
  return questions.map(question => {
    const inputs = Array.from(question.querySelectorAll('input'));
    return inputs.findIndex(input => input.checked);
  });
}
function restoreAnswers(questions) {
  questions.forEach((question, index) => {
    const inputs = Array.from(question.querySelectorAll('input'));
    const answerIndex = Number(assessmentState.answers[index]);
    if (Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < inputs.length) inputs[answerIndex].checked = true;
  });
}
function renderAssessmentState() {
  const card = document.querySelector('.assessment-card');
  if (!card) return;
  const questions = Array.from(card.querySelectorAll('.question'));
  restoreAnswers(questions);
  const submit = el('assessment-submit');
  const retake = el('assessment-retake');
  const result = el('assessment-result');
  const exitButton = el('assessment-save-exit');
  if (!assessmentState.submitted) {
    if (submit) { submit.hidden = false; submit.disabled = maxAttempts !== null && assessmentState.attempts >= maxAttempts; }
    if (retake) retake.hidden = true;
    if (exitButton) exitButton.hidden = true;
    if (result) result.textContent = submit && submit.disabled ? 'No assessment attempts remain.' : '';
    return;
  }
  const showReview = reviewPolicy === 'immediate' || (reviewPolicy === 'after-pass' && assessmentState.passed);
  questions.forEach(question => {
    if (showReview) gradeQuestion(question, true);
    else {
      const feedback = question.querySelector('.feedback');
      if (feedback) { feedback.textContent = ''; feedback.className = 'feedback'; }
    }
  });
  if (submit) submit.hidden = true;
  const canRetake = maxAttempts === null || assessmentState.attempts < maxAttempts;
  if (retake) retake.hidden = !canRetake;
  if (exitButton) exitButton.hidden = false;
  if (result) {
    result.textContent = 'Score: ' + (assessmentState.score === null ? 'not available' : assessmentState.score + '%') + ' — ' + (assessmentState.passed ? 'Passed.' : 'Not passed.') +
      (!assessmentState.passed && assessmentState.reportedStatus === 'passed' ? ' Your earlier pass remains recorded.' : '') +
      (assessmentState.passed && assessmentState.reportedStatus !== 'passed' ? ' The selected first-score policy retains your earlier nonpassing LMS result.' : '') +
      (canRetake ? ' You may begin a new full attempt.' : ' No attempts remain.');
    result.className = 'assessment-result ' + (assessmentState.passed ? 'pass' : 'fail');
  }
}
function chooseReportedOutcome(newScore, newPassed) {
  if (previewMode) {
    if (scoreTracking === 'first' && assessmentState.reportedScore !== null) {
      return { score: assessmentState.reportedScore, status: assessmentState.reportedStatus };
    }
    if (scoreTracking === 'best' && assessmentState.reportedStatus === 'passed' && assessmentState.reportedScore === null) {
      return { score: null, status: 'passed' };
    }
    if (scoreTracking === 'best' && assessmentState.reportedScore !== null) {
      const score = Math.max(newScore, assessmentState.reportedScore);
      return { score: score, status: assessmentState.reportedStatus === 'passed' || newPassed ? 'passed' : 'failed' };
    }
    return { score: newScore, status: newPassed ? 'passed' : 'failed' };
  }
  const lms = window.SCORM;
  const priorStatus = lms.get('cmi.core.lesson_status').toLowerCase();
  const raw = lms.get('cmi.core.score.raw');
  const priorScore = raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
  if (scoreTracking === 'first' && ['passed', 'failed'].includes(priorStatus)) {
    return { score: priorScore, status: priorStatus };
  }
  if (scoreTracking === 'best') {
    // A prior pass without a readable numeric score must not be replaced with a guessed score.
    if (priorStatus === 'passed' && priorScore === null) return { score: null, status: 'passed' };
    const score = priorScore === null ? newScore : Math.max(priorScore, newScore);
    return { score: score, status: priorStatus === 'passed' || score >= passMark ? 'passed' : 'failed' };
  }
  return { score: newScore, status: newPassed ? 'passed' : 'failed' };
}
function recordAssessmentInteractions(questions, evaluations) {
  if (previewMode) return;
  const scorm = window.SCORM;
  const count = Number(scorm.get('cmi.interactions._count'));
  const first = Number.isInteger(count) && count >= 0 ? count : 0;
  questions.forEach((question, index) => {
    const base = 'cmi.interactions.' + (first + index);
    const type = question.dataset.questionType === 'true-false' ? 'true-false' : 'choice';
    const response = evaluations[index].answer;
    const expected = question.dataset.correctOptionId || '';
    const values = {
      id: (question.dataset.questionId || 'question_' + index) + '_attempt_' + assessmentState.attempts,
      type: type,
      student_response: type === 'true-false' ? (response === 'option_1' ? 't' : 'f') : response,
      'correct_responses.0.pattern': type === 'true-false' ? (expected === 'option_1' ? 't' : 'f') : expected,
      result: evaluations[index].correct ? 'correct' : 'wrong',
      weighting: '1'
    };
    for (const [field, value] of Object.entries(values)) {
      // cmi.interactions is optional in SCORM 1.2. Never fail core status reporting if absent.
      if (!scorm.set(base + '.' + field, value)) break;
    }
  });
}
function submitAssessment() {
  if (assessmentState.submitted || (maxAttempts !== null && assessmentState.attempts >= maxAttempts)) return;
  const questions = Array.from(document.querySelectorAll('.assessment-card .question'));
  if (!questions.length) return;
  const evaluations = questions.map(question => gradeQuestion(question, false));
  if (!evaluations.every(result => result.answered)) {
    questions.forEach(question => { if (!question.querySelector('input:checked')) gradeQuestion(question, true); });
    showAlert('Answer all required assessment questions before submitting.');
    return;
  }
  const rawScore = 100 * evaluations.filter(result => result.correct).length / questions.length;
  const score = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));
  const passed = rawScore >= passMark;
  const outcome = chooseReportedOutcome(score, passed);
  assessmentState.attempts += 1;
  assessmentState.score = score;
  assessmentState.passed = passed;
  assessmentState.submitted = true;
  assessmentState.answers = collectAnswers(questions);
  assessmentState.reportedScore = outcome.score;
  assessmentState.reportedStatus = outcome.status;
  recordAssessmentInteractions(questions, evaluations);
  renderAssessmentState();
  updateNextGate();
  if (!save()) showAlert('Assessment graded, but LMS save failed. Use Save & Exit to retry.');
}
function retakeAssessment() {
  if (!assessmentState.submitted || (maxAttempts !== null && assessmentState.attempts >= maxAttempts)) return;
  assessmentState.submitted = false;
  assessmentState.answers = [];
  assessmentState.passed = false;
  assessmentState.score = 0;
  // Do not erase reportedScore/status: an existing pass or best score remains authoritative.
  const questions = Array.from(document.querySelectorAll('.assessment-card .question'));
  questions.forEach(question => {
    question.querySelectorAll('input').forEach(input => { input.checked = false; });
    const feedback = question.querySelector('.feedback');
    if (feedback) { feedback.textContent = ''; feedback.className = 'feedback'; }
  });
  const result = el('assessment-result');
  if (result) { result.textContent = ''; result.className = 'assessment-result'; }
  renderAssessmentState();
  updateNextGate();
  save();
}
function sessionTime() {
  const seconds = Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000));
  const hrs = Math.min(9999, Math.floor(seconds / 3600));
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return String(hrs).padStart(4, '0') + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}
function saveAndExitCourse() {
  if (exitCompleted || exiting) return;
  if (previewMode) {
    if (save()) showStatus(isolatedPreview
      ? 'Course Preview finished. No LMS progress was recorded. Select Close Preview to return to the editor.'
      : 'Standalone Preview: progress saved in this browser only. No LMS session was closed.', false);
    return;
  }
  exiting = true;
  const scorm = window.SCORM;
  if (!persistState(false)) {
    exiting = false;
    showStatus('Save & Exit failed. ' + lastSaveError + ' You may retry.', true);
    return;
  }
  if (!scorm.set('cmi.core.session_time', sessionTime()) || !scorm.commit()) {
    exiting = false;
    showStatus('Save & Exit failed: ' + scorm.lastError() + ' You may retry.', true);
    return;
  }
  if (!scorm.finish()) {
    exiting = false;
    showStatus('LMS saved progress but did not confirm session termination: ' + scorm.lastError() + ' Please retry.', true);
    return;
  }
  exitCompleted = true;
  showStatus('Progress saved and LMS session ended. If this window stays open, use Workday/LMS Close or close the window.', false);
  try { window.close(); } catch (error) { /* LMS-specific windows may block close. */ }
}
function finishCourse() {
  if (!hasAssessment && viewedPercent() === 100 && requiredActivitiesComplete()) {
    saveAndExitCourse();
    return;
  }
  if (hasAssessment && assessmentState.submitted && assessmentState.reportedStatus === 'passed') {
    saveAndExitCourse();
    return;
  }
  showAlert('Required course activities are not complete.');
}
async function loadPage(index) {
  if (navigating || !Number.isInteger(index) || index < 0 || index >= PAGES.length) return;
  const target = PAGES[index];
  navigating = true;
  setNav();
  try {
    const response = await fetch('pages/' + target.id + '.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    current = index;
    failedPageIndex = -1;
    const container = el('content-container');
    container.innerHTML = html;
    // The alert describes the previous lesson. Do not carry success/error feedback
    // into a different lesson, where it can falsely imply an unanswered check is done.
    showAlert('');
    container.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    initializeCaptions();
    initializeCompletionGate();
    if (target.assessment) renderAssessmentState();
    else visited.add(target.id);
    save();
    window.scrollTo(0, 0);
  } catch (error) {
    failedPageIndex = index;
    showStatus('Could not load ' + target.title + ': ' + (error.message || error) + '. Select Retry Page.', true);
  } finally {
    navigating = false;
    setNav();
  }
}
function nextPage() {
  if (navigating) return;
  if (failedPageIndex >= 0) { loadPage(failedPageIndex); return; }
  const gate = getGateState();
  if (gate.length) { showAlert(gate.join(' ')); return; }
  if (current < PAGES.length - 1) loadPage(current + 1);
  else finishCourse();
}
function prevPage() { if (current > 0 && !navigating) loadPage(current - 1); }
function navigateSidebar(index) {
  if (!Number.isInteger(index) || index < 0 || index >= PAGES.length || navigating) return;
  if (index > current) {
    const missing = prerequisitesFor(index);
    if (missing.length) { showAlert(missing.join(' ')); return; }
  }
  loadPage(index);
}
function getInitialPageIndex() {
  // Bookmark from the current LMS registration takes priority over serialized page index.
  const bookmark = connected ? window.SCORM.get('cmi.core.lesson_location') : '';
  let index = PAGES.findIndex(page => page.id === bookmark);
  if (index < 0 && Number.isInteger(storedState.p)) index = storedState.p;
  if (index < 0) index = PAGES.findIndex(page => page.id === storedState.currentPageId);
  return index >= 0 && index < PAGES.length ? index : 0;
}

// Media lightbox and caption behavior are retained from the previous generated runtime.
function ensureMediaLightbox() {
  let lightbox = el('media-lightbox');
  if (lightbox) return lightbox;
  lightbox = document.createElement('div');
  lightbox.id = 'media-lightbox';
  lightbox.className = 'media-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Expanded media viewer');
  lightbox.innerHTML = '<div class="media-lightbox-panel"><button class="media-lightbox-close" type="button" aria-label="Close expanded media">&times;</button><div class="media-lightbox-title"></div><div class="media-lightbox-body"></div></div>';
  document.body.appendChild(lightbox);
  lightbox.addEventListener('click', event => {
    if (event.target === lightbox || event.target.closest('.media-lightbox-close')) closeMediaLightbox();
  });
  return lightbox;
}
function closeMediaLightbox() {
  const lightbox = el('media-lightbox');
  if (!lightbox) return;
  const body = lightbox.querySelector('.media-lightbox-body');
  if (body) body.innerHTML = '';
  lightbox.classList.remove('is-open');
  document.body.classList.remove('media-lightbox-locked');
}
function openMediaLightbox(options) {
  const lightbox = ensureMediaLightbox();
  const title = lightbox.querySelector('.media-lightbox-title');
  const body = lightbox.querySelector('.media-lightbox-body');
  if (!body || !options.src) return;
  body.innerHTML = '';
  if (title) title.textContent = options.title || '';
  let node;
  if (options.kind === 'video') {
    node = document.createElement('video'); node.controls = true; node.autoplay = false; node.src = options.src;
  } else if (options.kind === 'iframe') {
    node = document.createElement('iframe'); node.src = options.src; node.title = options.title || 'Expanded video';
    node.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    node.allowFullscreen = true;
  } else {
    node = document.createElement('img'); node.src = options.src; node.alt = options.title || 'Expanded image'; node.referrerPolicy = 'no-referrer';
  }
  body.appendChild(node);
  lightbox.classList.add('is-open');
  document.body.classList.add('media-lightbox-locked');
  const close = lightbox.querySelector('.media-lightbox-close');
  if (close) close.focus();
}
function handleMediaExpandClick(event) {
  const explicit = event.target.closest('[data-expand-src]');
  const inlineImage = !explicit && event.target.closest('.topic-text img[src]');
  if (!explicit && !inlineImage) return;
  if (event.target.closest('a')) return;
  event.preventDefault();
  const source = explicit || inlineImage;
  const tag = (source.tagName || '').toLowerCase();
  openMediaLightbox({
    kind: source.dataset.expandKind || (tag === 'video' ? 'video' : 'image'),
    src: source.dataset.expandSrc || source.getAttribute('src'),
    title: source.dataset.expandTitle || source.getAttribute('alt') || source.getAttribute('title') || 'Expanded media'
  });
}

document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMediaLightbox(); });
document.addEventListener('click', handleMediaExpandClick);
document.addEventListener('click', event => {
  const nav = event.target.closest('.nav-item');
  if (nav) { event.preventDefault(); navigateSidebar(Number(nav.dataset.index)); }
});
document.addEventListener('change', event => {
  if (!assessmentState.submitted && event.target.closest('.assessment-card') && event.target.matches('input[type="radio"]')) {
    assessmentState.answers = collectAnswers(Array.from(document.querySelectorAll('.assessment-card .question')));
    save();
  }
});
window.addEventListener('pagehide', () => {
  if (exitCompleted || exiting || previewMode || !window.SCORM.connected()) return;
  if (persistState(false)) {
    window.SCORM.set('cmi.core.session_time', sessionTime());
    if (window.SCORM.commit()) window.SCORM.finish();
  }
});
document.addEventListener('DOMContentLoaded', () => {
  if (previewMode) showStatus('Preview Mode — not connected to an LMS. Only local browser progress is available.', false);
  if (el('prev-button')) el('prev-button').onclick = prevPage;
  if (el('next-button')) el('next-button').onclick = nextPage;
  if (el('save-exit-button')) el('save-exit-button').onclick = saveAndExitCourse;
  renderProgress();
  loadPage(getInitialPageIndex());
});
