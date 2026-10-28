// Web service that starts at boot and launches the Bonsoir UI app.
// CommonJS: the Tizen web service runtime uses module.exports.onStart.
// All state is written to /home/owner/share/tmp/bonsoir-boot.json so it can be
// read from the homebrew app sandbox (the only shared writable path).
var fs = require('fs');
// `tizen` is a runtime global binding in web services; `this.tizen` is undefined at module top level.

var APP_ID = 'BonsoirTV1.Bonsoir';
var TRACE = '/home/owner/share/tmp/bonsoir-boot-trace.json';

function trace(extra) {
  var state = {};
  try { state = JSON.parse(fs.readFileSync(TRACE, 'utf8')); } catch (e) { state = {}; }
  state.last = new Date().toISOString();
  for (var k in extra) state[k] = extra[k];
  try { fs.writeFileSync(TRACE, JSON.stringify(state)); } catch (e) {}
}

function alreadyRunning(cb) {
  try {
    tizen.application.getAppsInfo(function (infos) {
      for (var i = 0; i < infos.length; i++) {
        if (infos[i].appId === APP_ID) { cb(true); return; }
      }
      cb(false);
    }, function () { cb(false); });
  } catch (e) { cb(false); }
}

function launch(attempt) {
  trace({ phase: 'launching', attempt: attempt });
  tizen.application.launch(APP_ID,
    function () { trace({ phase: 'launched', attempt: attempt }); },
    function (e) {
      trace({ phase: 'launch-failed', attempt: attempt, error: e.message });
      if (attempt < 5) setTimeout(function () { launch(attempt + 1); }, 5000 * attempt);
    });
}

module.exports.onStart = function (ev) {
  trace({ phase: 'onStart' });
  setTimeout(function () {
    trace({ phase: 'timer-fired' });
    alreadyRunning(function (running) {
      if (running) { trace({ phase: 'already-running' }); return; }
      launch(1);
    });
  }, 10000);
};
module.exports.onTerminate = function (ev) {
  trace({ phase: 'onTerminate', reason: ev ? ev.reason : 'unknown' });
};
