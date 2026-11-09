// Bundled into each exported SCORM 1.2 SCO. This is NOT the repository-root legacy scorm-api.js.
// Do not use SCORM 2004 API names here; the package declares SCORM 1.2 in its manifest.
(function (root) {
  'use strict';
  var api = null;
  var phase = 'new';
  var lastError = '';
  var scorePolicy = 'best';

  function success(result) { return result === true || result === 'true'; }

  function discover(start) {
    var win = start;
    for (var i = 0; win && i < 20; i++) {
      try {
        if (win.API && typeof win.API.LMSInitialize === 'function') return win.API;
        if (win.parent === win) break;
        win = win.parent;
      } catch (error) {
        // Cross-origin ancestors cannot be inspected. Try the opener context instead.
        break;
      }
    }
    return null;
  }

  function errorFor(operation) {
    var code = '';
    var detail = '';
    try {
      if (api && typeof api.LMSGetLastError === 'function') {
        code = String(api.LMSGetLastError() || '');
        if (code && code !== '0' && typeof api.LMSGetErrorString === 'function') {
          detail = String(api.LMSGetErrorString(code) || '');
        }
      }
    } catch (error) { /* Diagnostics are optional. */ }
    lastError = operation + ' failed' + (code && code !== '0' ? ' (LMS error ' + code + (detail ? ': ' + detail : '') + ')' : '') + '.';
    return lastError;
  }

  root.SCORM = {
    configure: function (options) {
      var policy = options && options.scoreTracking;
      if (policy === 'best' || policy === 'first' || policy === 'latest') scorePolicy = policy;
    },
    init: function () {
      if (phase === 'active') return true;
      if (phase === 'finished') return false;
      if (!api) {
        api = discover(root);
        if (!api) {
          try { api = discover(root.opener); } catch (error) { /* Blocked opener. */ }
        }
      }
      if (!api) { lastError = 'No SCORM 1.2 LMS API was found.'; return false; }
      try {
        if (success(api.LMSInitialize(''))) {
          phase = 'active';
          lastError = '';
          return true;
        }
      } catch (error) { /* Use LMS diagnostics where possible. */ }
      errorFor('LMSInitialize');
      return false;
    },
    connected: function () { return phase === 'active'; },
    get: function (key) {
      if (phase !== 'active') return '';
      try { return String(api.LMSGetValue(key) || ''); } catch (error) { errorFor('LMSGetValue(' + key + ')'); return ''; }
    },
    set: function (key, value) {
      if (phase !== 'active') { lastError = 'LMS session is not active.'; return false; }
      // Guard older direct status/score writes as well as the current assessment controller.
      // The LMS is authoritative, and the explicit 'latest' policy permits a downgrade.
      try {
        if (scorePolicy !== 'latest') {
          if (key === 'cmi.core.lesson_status' && ['failed', 'incomplete', 'completed'].includes(String(value).toLowerCase()) &&
              String(api.LMSGetValue(key)).toLowerCase() === 'passed') return true;
          if (key === 'cmi.core.score.raw') {
            var previous = String(api.LMSGetValue(key) || '').trim();
            var priorStatus = String(api.LMSGetValue('cmi.core.lesson_status') || '').toLowerCase();
            if (previous !== '' && Number.isFinite(Number(previous)) &&
                ((scorePolicy === 'first' && ['passed', 'failed'].includes(priorStatus)) ||
                 (scorePolicy === 'best' && Number(previous) > Number(value)))) return true;
          }
        }
      } catch (error) { /* An unreadable LMS value must not be invented. */ }
      try { if (success(api.LMSSetValue(key, String(value)))) return true; } catch (error) { /* handled below */ }
      errorFor('LMSSetValue(' + key + ')');
      return false;
    },
    commit: function () {
      if (phase !== 'active') { lastError = 'LMS session is not active.'; return false; }
      try { if (success(api.LMSCommit(''))) return true; } catch (error) { /* handled below */ }
      errorFor('LMSCommit');
      return false;
    },
    finish: function () {
      if (phase === 'finished') return true; // Idempotent after confirmed termination.
      if (phase !== 'active') { lastError = 'LMS session is not active.'; return false; }
      try {
        if (success(api.LMSFinish(''))) { phase = 'finished'; return true; }
      } catch (error) { /* handled below */ }
      errorFor('LMSFinish');
      return false;
    },
    lastError: function () { return lastError; }
  };
  // Compatibility aliases only; all status changes still pass through the one adapter.
  root.SafeSCORM = {
    setValue: function (key, value) { return root.SCORM.set(key, value); },
    getValue: function (key) { return root.SCORM.get(key); },
    setStatus: function (state) {
      var next = state && (state.success || state.completion);
      if (next === 'complete') next = 'completed';
      if (!['passed', 'failed', 'completed', 'incomplete'].includes(next)) return false;
      return root.SCORM.set('cmi.core.lesson_status', next);
    }
  };
})(window);
