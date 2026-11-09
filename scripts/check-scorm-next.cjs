'use strict';
// Compatibility command for the previously deployed Next-button test suite.
// The new SCORM runtime tests exercise the actual export's Next, Retry Page,
// completion gates, assessment retakes, resume and Save & Exit logic.
console.log('Next-button checks are included in the generated SCORM runtime suite.');
require('./check-scorm-runtime.cjs');
