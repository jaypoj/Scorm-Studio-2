// SCORM Navigation System - Enhanced for Universal LMS Compatibility
// Uses UniversalSCORM API for better compatibility with VelocityEHS and other platforms

(function() {
    'use strict';

    window.onAudioTimeUpdate = window.onAudioTimeUpdate || function() {};
    window.onAudioEnded = window.onAudioEnded || function() {};
    window.onAudioMetadataLoaded = window.onAudioMetadataLoaded || function() {};
    window.onAudioLoaded = window.onAudioLoaded || function() {};
    window.togglePlayPause = window.togglePlayPause || function() {};

    const COURSE_ID = '[[COURSE_ID]]';
    const AUTOPLAY_KEY = COURSE_ID ? `audioAutoplay_${COURSE_ID}` : 'audioAutoplay';

    const SafeStorage = (function() {
        const memoryFallback = {};
        let storageAvailable = null;

        function isAvailable() {
            if (storageAvailable !== null) return storageAvailable;
            try {
                const testKey = '__storage_test__';
                localStorage.setItem(testKey, testKey);
                localStorage.removeItem(testKey);
                storageAvailable = true;
            } catch (e) {
                storageAvailable = false;
            }
            return storageAvailable;
        }

        return {
            getItem: function(key) {
                try {
                    if (isAvailable()) return localStorage.getItem(key);
                    return memoryFallback[key] || null;
                } catch (e) {
                    return memoryFallback[key] || null;
                }
            },
            setItem: function(key, value) {
                try {
                    if (isAvailable()) localStorage.setItem(key, value);
                    memoryFallback[key] = value;
                    return true;
                } catch (e) {
                    memoryFallback[key] = value;
                    if (window.showToast) window.showToast('Settings saved for this session only', 'warning');
                    return false;
                }
            },
            removeItem: function(key) {
                try {
                    if (isAvailable()) localStorage.removeItem(key);
                    delete memoryFallback[key];
                } catch (e) { delete memoryFallback[key]; }
            }
        };
    })();

    function initializeSCORM() {
        if (window.UniversalSCORM) {
            if (!window.UniversalSCORM.available) window.UniversalSCORM.init();
            return true;
        }
        return false;
    }
    
    const SafeSCORM = {
        get api() { return window.UniversalSCORM ? window.UniversalSCORM.api : null; },
        get initialized() { return window.UniversalSCORM ? window.UniversalSCORM.initialized : false; },
        get available() { return window.UniversalSCORM ? window.UniversalSCORM.available : false; },
        init: function() { return initializeSCORM(); },
        findAPI: function(win) { return window.UniversalSCORM ? window.UniversalSCORM.findAPI(win) : null; },
        getValue: function(element) { return window.UniversalSCORM ? window.UniversalSCORM.getValue(element) : ''; },
        setValue: function(element, value) { return window.UniversalSCORM ? window.UniversalSCORM.setValue(element, value) : false; },
        commit: function() { return window.UniversalSCORM ? window.UniversalSCORM.commit() : false; },
        finish: function() { return window.UniversalSCORM ? window.UniversalSCORM.finish() : false; },
        getLastError: function() { return window.UniversalSCORM ? window.UniversalSCORM.getLastError() : '0'; },
        setScore: function(score) {
            if (!window.UniversalSCORM || !window.UniversalSCORM.available) return false;
            let success = false;
            const version = (window.UniversalSCORM && window.UniversalSCORM.version) || "1.2";
            const rawElement = version === "1.2" ? 'cmi.core.score.raw' : 'cmi.score.raw';
            const minElement = version === "1.2" ? 'cmi.core.score.min' : 'cmi.score.min';
            const maxElement = version === "1.2" ? 'cmi.core.score.max' : 'cmi.score.max';
            const approaches = [
                () => { this.setValue(minElement, '0.00'); this.setValue(maxElement, '100.00'); this.setValue(rawElement, score.toFixed(2)); this.commit(); },
                () => { this.setValue(minElement, '0'); this.setValue(maxElement, '100'); this.setValue(rawElement, Math.round(score).toString()); this.commit(); },
                () => { this.setValue(rawElement, Math.round(score).toString()); this.commit(); }
            ];
            for (let i = 0; i < approaches.length; i++) {
                try { approaches[i].call(this); if (this.getLastError() === '0' || this.getLastError() === 0) { success = true; break; } } catch (e) {}
            }
            return success;
        },
        setStatus: function({ completion, success }) {
            if (!window.UniversalSCORM || !window.UniversalSCORM.available) return false;
            const version = (window.UniversalSCORM && window.UniversalSCORM.version) || "1.2";
            if (version === "1.2") {
                let statusValue;
                if (success === 'passed' && completion === 'completed') statusValue = 'passed';
                else if (success === 'failed') statusValue = 'failed';
                else if (completion) statusValue = completion;
                if (statusValue) this.setValue('cmi.core.lesson_status', statusValue);
            } else {
                if (completion) this.setValue('cmi.completion_status', completion);
                if (success) this.setValue('cmi.success_status', success);
            }
            this.commit();
            return true;
        }
    };
    
    SafeSCORM.init();
    window.SafeSCORM = SafeSCORM;
    
    const sessionStartTime = new Date();
    window.getSessionTime = function() {
        const now = new Date();
        const elapsedMs = now - sessionStartTime;
        const totalSeconds = Math.floor(elapsedMs / 1000);
        const pad = (num, size) => num.toString().padStart(size, '0');
        return `${pad(Math.floor(totalSeconds / 3600), 2)}:${pad(Math.floor((totalSeconds % 3600) / 60), 2)}:${pad(totalSeconds % 60, 2)}.${pad(Math.floor((elapsedMs % 1000) / 10), 2)}`;
    }
    
    window.addEventListener('beforeunload', function(e) {
        const isPreviewMode = window.__PREVIEW_MODE__ === true;
        if (COURSE_SETTINGS.confirmExit && !isPreviewMode) {
            const message = 'Are you sure you want to exit the course? Your progress will be saved.';
            e.preventDefault(); e.returnValue = message; return message;
        }
        SafeSCORM.setValue('cmi.core.session_time', window.getSessionTime());
        saveProgress();
        SafeSCORM.finish();
    });
    
    window.currentPage = 'welcome';
    window.completedPages = new Set();
    window.courseStructure = [];
    window.knowledgeCheckAttempts = {};
    window.answeredQuestions = {};
    window.assessmentAttempts = 0;
    window.assessmentData = { attempts: 0, scores: [], lastAnswers: {} };
    window.sessionData = { startTime: Date.now(), totalTimeSpent: 0, pageStartTime: Date.now(), pageTimers: {}, lastAutoSave: Date.now(), lastTimeSyncTime: Date.now() };
    window.hasRestoredProgress = false;
    window.autoSaveTimer = null;
    window.timeLimitTimer = null;
    window.courseStartTime = null;
    window.timeWarningsShown = { tenMinute: false, fiveMinute: false, twoMinute: false };
    window.autoAdvanceTimer = null;
    window.completedAudio = new Set();
    const REQUIRE_AUDIO_COMPLETION = false;
    
    const COURSE_SETTINGS = {
        autoAdvance: false, allowPreviousReview: true, allowRetake: true, retakeDelay: 0,
        completionCriteria: '[[COMPLETION_CRITERIA]]', showProgress: true, showOutline: true,
        confirmExit: true, fontSize: 'medium', timeLimit: 0, sessionTimeout: 30, minimumTimeSpent: 0,
        keyboardNavigation: true, printable: false, navigationMode: 'free', passMark: [[PASS_MARK]]
    };
    
    if (COURSE_SETTINGS.fontSize !== 'medium') document.documentElement.classList.add(`font-${COURSE_SETTINGS.fontSize}`);
    
    const COURSE_PAGES = [[COURSE_PAGES]];
    window.courseStructure = COURSE_PAGES;
    const PAGES_WITH_KNOWLEDGE_CHECKS = [[PAGES_WITH_KNOWLEDGE_CHECKS]];
    
    function updateNavigationState() {
        const currentIndex = COURSE_PAGES.indexOf(window.currentPage);
        const prevButton = document.getElementById('prev-button');
        if (prevButton) prevButton.disabled = currentIndex <= 0;
        const nextButton = document.getElementById('next-button');
        if (nextButton) {
            const navResult = shouldBlockNavigation('forward');
            nextButton.disabled = navResult.blocked || currentIndex >= COURSE_PAGES.length - 1;
        }
        updateSidebarNavigationState();
    }
    
    function shouldBlockNavigation(direction = 'forward', targetIndex = null) {
        if (direction === 'backward' && COURSE_SETTINGS.allowPreviousReview) return { blocked: false, reason: null, message: null };
        if (COURSE_SETTINGS.navigationMode === 'linear' && direction === 'jump') {
            const currentIndex = COURSE_PAGES.indexOf(window.currentPage);
            if ((targetIndex !== null ? targetIndex : 0) > currentIndex) return { blocked: true, reason: 'sequential', message: 'Please complete pages in order.' };
        }
        if ((direction === 'forward' || direction === 'jump') && REQUIRE_AUDIO_COMPLETION) {
            const currentPageAudio = document.querySelector(`audio[data-page-id="${window.currentPage}"]`) || document.querySelector(`#topic-audio-${window.currentPage}`);
            if (currentPageAudio && !window.completedAudio.has(window.currentPage)) return { blocked: true, reason: 'audio', message: 'Please listen to the complete audio before continuing.' };
        }
        if (!PAGES_WITH_KNOWLEDGE_CHECKS[window.currentPage]) return { blocked: false, reason: null, message: null };
        
        const pageQuestions = document.querySelectorAll('.knowledge-check-container');
        if (pageQuestions.length === 0) return { blocked: false, reason: null, message: null };
        
        let allAnswered = true;
        const allMcQuestions = document.querySelectorAll('.kc-question-wrapper');
        allMcQuestions.forEach((q, i) => {
            if (!window.answeredQuestions[`${window.currentPage}_q${i}`] && !window.answeredQuestions[`${window.currentPage}_fill-blank-${i}`]) allAnswered = false;
        });

        if (!allAnswered) return { blocked: true, reason: 'knowledge_check', message: 'Please complete the knowledge check on this page before proceeding.' };
        return { blocked: false, reason: null, message: null };
    }
    
    function updateSidebarNavigationState() {
        const currentIndex = COURSE_PAGES.indexOf(window.currentPage);
        document.querySelectorAll('.nav-item').forEach((item, index) => {
            if (index > currentIndex && shouldBlockForwardNavigation(currentIndex, index)) item.classList.add('nav-disabled');
            else item.classList.remove('nav-disabled');
        });
    }
    
    function shouldBlockForwardNavigation(fromIndex, toIndex) {
        for (let i = fromIndex; i < toIndex; i++) {
            const pageId = COURSE_PAGES[i];
            if (PAGES_WITH_KNOWLEDGE_CHECKS[pageId]) {
                const hasAnyAnswer = Object.keys(window.answeredQuestions).some(k => k.startsWith(pageId + '_'));
                if (!hasAnyAnswer) return true;
                for (let q=0; q<50; q++) {
                    if (window.answeredQuestions[`${pageId}_q${q}`] === false || window.answeredQuestions[`${pageId}_fill-blank-${q}`] === false) return true;
                }
            }
        }
        return false;
    }
    
    function navigateToPage(pageId) {
        if (window.autoAdvanceTimer) { clearTimeout(window.autoAdvanceTimer); window.autoAdvanceTimer = null; }
        if (window.currentPage && window.sessionData.pageStartTime) {
            const timeSpent = Date.now() - window.sessionData.pageStartTime;
            window.sessionData.totalTimeSpent += timeSpent;
            window.sessionData.pageTimers[window.currentPage] = (window.sessionData.pageTimers[window.currentPage] || 0) + timeSpent;
        }
        window.sessionData.pageStartTime = Date.now();
        
        const contentContainer = document.getElementById('content-container');
        if (!contentContainer) return;
        
        fetch(`pages/${pageId}.html`)
            .then(res => res.text())
            .then(html => {
                contentContainer.innerHTML = html;
                window.currentPage = pageId;
                window.completedPages.add(pageId);
                
                initializePageAudio(pageId);
                initializePageVideo(pageId);
                restoreAnsweredQuestions(pageId);
                updateNavigationState();
                updateProgress();
                updateSidebarActiveState();
                updateSidebarCompletionState();
                saveProgress();
                contentContainer.scrollTop = 0;
            });
    }
    
    function handleNext() {
        const navCheck = shouldBlockNavigation('forward');
        if (navCheck.blocked) { showNavigationBlockedAlert(navCheck.message); return; }
        const currentIndex = COURSE_PAGES.indexOf(window.currentPage);
        if (currentIndex < COURSE_PAGES.length - 1) navigateToPage(COURSE_PAGES[currentIndex + 1]);
    }

    function handlePrevious() {
        const navCheck = shouldBlockNavigation('backward');
        if (navCheck.blocked) { showNavigationBlockedAlert(navCheck.message); return; }
        const currentIndex = COURSE_PAGES.indexOf(window.currentPage);
        if (currentIndex > 0) navigateToPage(COURSE_PAGES[currentIndex - 1]);
    }

    function handleSidebarClick(event) {
        event.preventDefault();
        const targetPage = event.currentTarget.dataset.page;
        const currentIndex = COURSE_PAGES.indexOf(window.currentPage), targetIndex = COURSE_PAGES.indexOf(targetPage);
        const direction = targetIndex > currentIndex ? 'jump' : targetIndex < currentIndex ? 'backward' : 'current';
        const navCheck = shouldBlockNavigation(direction, targetIndex);
        if (navCheck.blocked) { showNavigationBlockedAlert(navCheck.message); return; }
        if (targetIndex > currentIndex && shouldBlockForwardNavigation(currentIndex, targetIndex)) { showNavigationBlockedAlert(); return; }
        navigateToPage(targetPage);
    }
    
    function showNavigationBlockedAlert(message = 'Please complete the knowledge check on this page before proceeding.') {
        const alertContainer = document.getElementById('scorm-alert-container');
        if (alertContainer) {
            const alert = document.createElement('div');
            alert.className = 'scorm-alert scorm-alert-warning';
            alert.textContent = message;
            alertContainer.appendChild(alert);
            setTimeout(() => alert.remove(), 5000);
        }
    }

    window.submitMultipleChoice = function(qIdx) {} // Default ignored

    window.submitAllKnowledgeChecks = function() {
        const kcContainer = document.querySelector('.knowledge-check-container');
        if (!kcContainer) return;
        let allAnswered = true;
        kcContainer.querySelectorAll('.kc-question-wrapper').forEach((wrapper, index) => {
            const rInputs = wrapper.querySelectorAll('input[type="radio"]');
            if (rInputs.length > 0) {
                const selected = wrapper.querySelector('input[type="radio"]:checked');
                if (!selected) { allAnswered = false; return; }
                const isCorrect = selected.value === wrapper.dataset.correctAnswer;
                wrapper.querySelectorAll('.kc-option').forEach(opt => {
                    const inp = opt.querySelector('input');
                    opt.classList.remove('correct-answer', 'incorrect-answer');
                    if (inp.value === selected.value && !isCorrect) opt.classList.add('incorrect-answer');
                    if (inp.value === selected.value && isCorrect) opt.classList.add('correct-answer');
                    if (!isCorrect && inp.value === wrapper.dataset.correctAnswer) opt.classList.add('correct-answer');
                });
                window.answeredQuestions[`${window.currentPage}_q${index}`] = true;
                const fb = wrapper.querySelector('.feedback');
                if (fb) {
                    fb.textContent = isCorrect ? wrapper.dataset.correctFeedback : wrapper.dataset.incorrectFeedback;
                    fb.className = isCorrect ? 'feedback correct' : 'feedback incorrect';
                    fb.style.display = 'block';
                }
                rInputs.forEach(i => i.disabled = true);
            }
        });
        if (!allAnswered) { showNavigationBlockedAlert('Please answer all questions before submitting.'); return; }
        const btn = kcContainer.querySelector('.kc-submit');
        if(btn) { btn.disabled = true; btn.textContent = 'All Answers Submitted'; }
        updateNavigationState();
        saveProgress();
    };
    
    window.audioPlayers = window.audioPlayers || {};
    function initializePageAudio(pageId) {
        const audio = document.getElementById(`topic-audio-${pageId}`);
        if(audio) {
            window.audioPlayers[pageId] = audio;
            if (SafeStorage.getItem(AUTOPLAY_KEY) === 'true') {
                audio.play().then(() => {
                    const btn = document.querySelector(`audio[data-page-id="${pageId}"]`)?.parentElement?.querySelector('.audio-play-pause');
                    if(btn) { btn.querySelector('.play-icon').style.display='none'; btn.querySelector('.pause-icon').style.display='inline'; }
                }).catch(e=>{});
            }
        }
    }
    
    function initializePageVideo(pageId) {}

    window.togglePlayPause = function(pageId) {
        const audio = window.audioPlayers[pageId];
        if(!audio) return;
        const btn = document.querySelector(`audio[data-page-id="${pageId}"]`)?.parentElement?.querySelector('.audio-play-pause');
        if (audio.paused) {
            audio.play();
            if(btn) { btn.querySelector('.play-icon').style.display='none'; btn.querySelector('.pause-icon').style.display='inline'; }
        } else {
            audio.pause();
            if(btn) { btn.querySelector('.play-icon').style.display='inline'; btn.querySelector('.pause-icon').style.display='none'; }
        }
    };
    
    window.seekAudio = function(pid, ev) { const a = window.audioPlayers[pid]; if(a) a.currentTime = (ev.offsetX / ev.currentTarget.offsetWidth) * a.duration; };
    window.skipBackward = function(pid, s) { const a = window.audioPlayers[pid]; if(a) a.currentTime = Math.max(0, a.currentTime - s); };
    window.skipForward = function(pid, s) { const a = window.audioPlayers[pid]; if(a) a.currentTime = Math.min(a.duration, a.currentTime + s); };
    window.toggleMute = function(pid) { const a = window.audioPlayers[pid]; if(a) a.muted = !a.muted; };
    window.setVolume = function(pid, ev) { const a = window.audioPlayers[pid]; if(a) { a.volume = ev.offsetX / ev.currentTarget.offsetWidth; const f = document.getElementById(`volume-${pid}`); if(f) f.style.width=(a.volume*100)+'%'; } };
    window.setPlaybackSpeed = function(pid, s) { const a = window.audioPlayers[pid]; if(a) a.playbackRate = parseFloat(s); };
    
    window.toggleCaptions = function(pid) {
        const c = document.getElementById(`captions-${pid}`);
        if(c) {
            c.style.display = c.style.display === 'none' ? 'block' : 'none';
            const btn = document.querySelector(`button[onclick="window.toggleCaptions('${pid}')"]`);
            if (btn) btn.style.backgroundColor = c.style.display === 'none' ? '' : '#e2e8f0';
        }
    };
    
    window.onAudioTimeUpdate = function(pid) {
        const a = window.audioPlayers[pid];
        if(!a) return;
        const ct = document.getElementById(`current-time-${pid}`);
        if(ct) ct.textContent = Math.floor(a.currentTime/60)+":"+Math.floor(a.currentTime%60).toString().padStart(2,'0');
        const p = document.getElementById(`progress-${pid}`);
        if(p && a.duration) p.style.width = ((a.currentTime/a.duration)*100)+'%';
        
        // Handle captions
        const cap = document.getElementById(`captions-${pid}`);
        if(cap && cap.style.display !== 'none' && a.textTracks && a.textTracks.length > 0) {
            const track = a.textTracks[0];
            if(track.mode !== 'hidden') track.mode = 'hidden'; // Hide default browser overlay
            const activeCues = track.activeCues;
            if(activeCues && activeCues.length > 0) {
                cap.innerHTML = activeCues[0].text.replace(/\\n/g, '<br>');
            } else {
                cap.innerHTML = '';
            }
        }
    };
    window.onAudioLoaded = function(pid) {
        const a = window.audioPlayers[pid];
        if(!a) return;
        const o = document.getElementById(`duration-${pid}`);
        if(o) o.textContent = Math.floor(a.duration/60)+":"+Math.floor(a.duration%60).toString().padStart(2,'0');
    };
    window.onAudioEnded = function(pid) {
        const btn = document.querySelector(`audio[data-page-id="${pid}"]`)?.parentElement?.querySelector('.audio-play-pause');
        if(btn) { btn.querySelector('.play-icon').style.display='inline'; btn.querySelector('.pause-icon').style.display='none'; }
    };
    
    function updateProgress() {
        const p = Math.round(((COURSE_PAGES.indexOf(window.currentPage)+1) / COURSE_PAGES.length) * 100);
        document.querySelector('.progress-circle-text').textContent = p+'%';
        document.querySelector('.progress-circle-fill').style.strokeDashoffset = (283 - (p/100)*283);
    }
    
    function updateSidebarActiveState() {
        document.querySelectorAll('.nav-item').forEach(i => i.dataset.page===window.currentPage ? i.classList.add('active') : i.classList.remove('active'));
    }
    
    function updateSidebarCompletionState() {
        document.querySelectorAll('.nav-item').forEach(i => { if(window.completedPages.has(i.dataset.page)) i.classList.add('completed'); });
    }
    
    function restoreAnsweredQuestions(pid) {
        document.querySelectorAll('.kc-question-wrapper').forEach((w, i) => {
            if(window.answeredQuestions[`${pid}_q${i}`]) {
                const b=w.querySelector('.kc-submit'); if(b) { b.disabled=true; b.textContent='Answer Submitted'; }
                w.classList.add('question-answered');
            }
        });
    }
    
    function loadSavedProgress() {
        let pLoaded = false, sLoc = null;
        try {
            sLoc = SafeSCORM.getValue('cmi.core.lesson_location');
            if (sLoc && sLoc !== '' && sLoc !== COURSE_PAGES[0]) { window.currentPage = sLoc; pLoaded = true; }
            const sData = SafeSCORM.getValue('cmi.suspend_data');
            if (sData) {
                const d = JSON.parse(sData);
                if (d.completedPages) window.completedPages = new Set(d.completedPages);
                if (d.answeredQuestions) window.answeredQuestions = d.answeredQuestions;
                if (d.assessmentAttempts !== undefined) { window.assessmentData.attempts = d.assessmentAttempts; window.assessmentData.scores = d.attemptHistory || []; }
                pLoaded = true;
            }
            if (SafeSCORM.getValue('cmi.core.lesson_status') === 'completed' || SafeSCORM.getValue('cmi.core.lesson_status') === 'passed') window.completedPages.add('assessment');
        } catch(e) {}
        window.hasRestoredProgress = pLoaded;
        return pLoaded;
    }
    
    function saveProgress() {
        if(window.currentPage) SafeSCORM.setValue('cmi.core.lesson_location', window.currentPage);
        SafeSCORM.setValue('cmi.suspend_data', JSON.stringify({
            completedPages: Array.from(window.completedPages), answeredQuestions: window.answeredQuestions,
            assessmentAttempts: window.assessmentData.attempts, attemptHistory: window.assessmentData.scores
        }));
        
        const isComplete = window.completedPages.size >= COURSE_PAGES.length - 1 && window.assessmentData.scores.some(s => s >= COURSE_SETTINGS.passMark);
        if (isComplete) SafeSCORM.setValue('cmi.core.lesson_status', 'completed');
        else if(SafeSCORM.getValue('cmi.core.lesson_status') !== 'completed') SafeSCORM.setStatus({ completion: 'incomplete' });
        SafeSCORM.commit();
    }
    
    function initializeNavigation() {
        if (!loadSavedProgress()) { SafeSCORM.setValue('cmi.core.lesson_location', COURSE_PAGES[0]); SafeSCORM.commit(); }
        const n = document.getElementById('next-button'), p = document.getElementById('prev-button');
        if(n) n.addEventListener('click', handleNext); if(p) p.addEventListener('click', handlePrevious);
        document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', handleSidebarClick));
        navigateToPage(window.currentPage);
    }
    
    window.submitAssessment = function() {
        const qC = document.querySelectorAll('.question-container');
        let s = 0, a = 0;
        qC.forEach((c,i) => {
            const ss = c.querySelector('input[type="radio"]:checked');
            if(ss) {
                a++;
                const isC = ss.dataset.correct === ss.value;
                if(isC) s++;
                c.querySelectorAll('.kc-option').forEach(o => {
                    const inp = o.querySelector('input');
                    if(inp.value===ss.value) o.classList.add(isC?'correct-answer':'incorrect-answer');
                });
                const f = document.getElementById(`assessment-feedback-${i}`);
                if(f) { f.textContent = isC ? c.dataset.correctFeedback : c.dataset.incorrectFeedback; f.className = isC?'feedback correct':'feedback incorrect'; f.style.display='block'; }
            }
        });
        if(a < qC.length) { showNavigationBlockedAlert('Please answer all questions before submitting.'); return; }
        window.assessmentData.attempts++;
        const pct = Math.round((s/qC.length)*100);
        window.assessmentData.scores.push(pct);
        const best = Math.max(...window.assessmentData.scores);
        SafeSCORM.setValue('cmi.core.lesson_location', 'assessment-completed');
        SafeSCORM.setScore(best);
        if(pct >= COURSE_SETTINGS.passMark) { SafeSCORM.setStatus({completion: 'completed', success: 'passed'}); window.completedPages.add('assessment'); }
        else SafeSCORM.setStatus({success: 'failed'});
        saveProgress();
        document.getElementById('assessment-results').style.display='block';
        document.getElementById('score-percentage').textContent=pct+'%';
        const c = document.getElementById('score-circle-fill');
        if(c) { c.style.strokeDasharray=2*Math.PI*50; c.style.strokeDashoffset=(2*Math.PI*50)*(1 - pct/100); c.style.stroke=pct>=COURSE_SETTINGS.passMark?'#28a745':'#dc3545'; }
        const subm = document.querySelector('.submit-assessment'); if(subm && pct>=COURSE_SETTINGS.passMark) subm.style.display='none'; else if(subm) subm.textContent='Submit Again';
        const msg = document.getElementById('score-message'), cm = document.getElementById('completion-message');
        if(pct >= COURSE_SETTINGS.passMark) { if(msg) { msg.textContent=`Passed with ${pct}%!`; msg.className='score-message success'; } if(cm) cm.style.display='block'; }
        else { if(msg) { msg.textContent=`Failed with ${pct}%. Answer correctly to pass.`; msg.className='score-message error'; } if(cm) cm.style.display='none'; }
    };
    
    window.toggleAudioAutoplay = function() {
        const cur = SafeStorage.getItem(AUTOPLAY_KEY)==='true';
        SafeStorage.setItem(AUTOPLAY_KEY, (!cur).toString());
        const t=document.querySelector('.audio-autoplay-toggle');
        if(t) { t.classList.toggle('enabled', !cur); t.querySelector('.autoplay-label').textContent=!cur?'Autoplay On':'Autoplay Off'; }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeNavigation);
    else initializeNavigation();
})();
