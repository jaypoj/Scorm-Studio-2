/*!
 * Universal SCORM API Wrapper
 */
(function() {
    'use strict';
    window.UniversalSCORM = {
        api: null, initialized: false, available: false, version: null,
        init: function() {
            try {
                this.api = this.findAPI(window);
                this.available = !!this.api;
                if (this.available) {
                    this.version = this.api.LMSInitialize ? "1.2" : "2004";
                    if (this.initialize()) {
                        if (this.version === "1.2") this.setValue('cmi.core.lesson_status', 'incomplete');
                        else this.setValue('cmi.completion_status', 'incomplete');
                        this.commit();
                    } else this.available = true;
                }
            } catch (e) { this.available = false; }
            return this.available;
        },
        findAPI: function(win) {
            let currentWindow = win, attempts = 0;
            while (attempts < 10) {
                if (currentWindow.API) return currentWindow.API;
                if (currentWindow.API_1484_11) return currentWindow.API_1484_11;
                if (attempts === 0 && currentWindow.opener) {
                    const oAPI = this.findAPI(currentWindow.opener);
                    if (oAPI) return oAPI;
                }
                if (currentWindow.parent && currentWindow.parent !== currentWindow) currentWindow = currentWindow.parent;
                else break;
                attempts++;
            }
            if (win.top && win.top !== win) {
                if (win.top.API) return win.top.API;
                if (win.top.API_1484_11) return win.top.API_1484_11;
            }
            return null;
        },
        initialize: function() {
            if (!this.api) return false;
            try { this.initialized = ((this.version === "1.2" ? this.api.LMSInitialize('') : this.api.Initialize('')) === 'true'); return this.initialized; } catch (e) { this.initialized = true; return true; }
        },
        getValue: function(element) {
            if (!this.api) return '';
            try { return (this.version === "1.2" ? this.api.LMSGetValue(element) : this.api.GetValue(element)) || ''; } catch (e) { return ''; }
        },
        setValue: function(element, value) {
            if (!this.api) return false;
            try { const r = (this.version === "1.2" ? this.api.LMSSetValue(element, String(value)) : this.api.SetValue(element, String(value))); return r === 'true' || r === true; } catch (e) { return false; }
        },
        commit: function() {
            if (!this.api) return false;
            try { const r = (this.version === "1.2" ? this.api.LMSCommit('') : this.api.Commit('')); return r === 'true' || r === true; } catch (e) { return false; }
        },
        finish: function() {
            if (!this.api) return false;
            try { const r = (this.version === "1.2" ? this.api.LMSFinish('') : this.api.Terminate('')); return r === 'true' || r === true; } catch (e) { return false; }
        }
    };
    document.addEventListener('DOMContentLoaded', function() { window.UniversalSCORM.init(); });
})();
