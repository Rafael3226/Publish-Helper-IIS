/* ------------------------------------------------------------------
 * presets.js - the defaults every configuration is filled in from, and
 * the loader for the starting points in presets/*.json, taken from the
 * deployment scripts already in use.
 * ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var KEEP = 'appsettings.json\nappsettings.Development.json\nweb.config';

  function base(over) {
    var cfg = {
      scriptName: 'deploy',
      title: 'Deployment',
      deployMode: 'batch',
      autoElevate: false,
      pauseAtEnd: true,
      stopWait: 3,
      useZip: true,
      zipSource: '',
      extractDir: '',
      cleanExtract: true,
      unzipMethod: 'cscript',
      backupEnabled: true,
      backupRoot: 'C:\\Publish\\_backups',
      backupKeep: 0,
      logEnabled: true,
      logDir: 'C:\\Publish\\_logs',
      excludeDir: 'C:\\Publish\\_excludes',
      /* database scripts - both engines off unless asked for */
      sqlWhen: 'before',
      sqlStopOnError: true,
      mssqlEnabled: false,
      mssqlTool: 'sqlcmd',
      mssqlServer: '',
      mssqlDatabase: '',
      mssqlAuth: 'windows',
      mssqlUser: '',
      mssqlPassword: '',
      mssqlTrustCert: false,
      mssqlDir: '',
      mssqlFiles: '',
      as400Enabled: false,
      as400Tool: 'odbc',
      as400System: '',
      as400Database: '',
      as400Library: '',
      as400User: '',
      as400Password: '',
      as400Driver: 'IBM i Access ODBC Driver',
      as400Dir: '',
      as400Files: '',
      projects: []
    };
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) cfg[k] = over[k];
    return cfg;
  }

  function project(over) {
    var p = {
      enabled: true,
      name: 'API',
      sourceMode: 'zip',
      sourceSub: '',
      sourceAbs: '',
      targets: [''],
      pool: '',
      site: '',
      backup: true,
      keepText: KEEP
    };
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) p[k] = over[k];
    return p;
  }

  /* what New starts from; the real starting points live in presets/ */
  function blank() {
    return base({ projects: [project({ name: 'API' })] });
  }

  /* presets/index.json lists the files, in display order: [{ file, label, hint }].
     Each file is a configuration in the same shape Export writes, so an export can be
     dropped into presets/ as it is. A browser cannot list a folder, hence the index. */
  var DIR = 'presets/';

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
      return res.json();
    });
  }

  /* resolves to [{ id, label, hint, build }]; a file that fails is left out and named in
     `failed`, so one broken preset does not hide the others */
  function load() {
    return getJson(DIR + 'index.json').then(function (index) {
      return Promise.all(index.map(function (entry) {
        return getJson(DIR + entry.file).then(function (cfg) {
          var text = JSON.stringify(cfg);
          return {
            id: entry.file.replace(/\.json$/i, ''),
            label: entry.label || entry.file,
            hint: entry.hint || '',
            /* a fresh copy every time: the app edits what it is given */
            build: function () {
              var copy = JSON.parse(text);
              (copy.projects || []).forEach(function (p) { delete p.uid; });
              return copy;
            }
          };
        }, function () { return { failed: entry.file }; });
      }));
    }).then(function (results) {
      var list = results.filter(function (r) { return !r.failed; });
      list.failed = results.filter(function (r) { return r.failed; }).map(function (r) { return r.failed; });
      return list;
    });
  }

  global.Presets = { blank: blank, load: load, base: base, project: project, KEEP: KEEP };

})(window);
