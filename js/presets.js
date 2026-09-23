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
     dropped into presets/ as it is. A browser cannot list a folder, hence the index.
     Only the index is read up front; a preset's file waits until it is used. */
  var DIR = 'presets/';

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
      return res.json();
    });
  }

  /* one entry of the index; its file is fetched the first time it is asked for, and a
     failed fetch is tried again next time */
  function lazyPreset(entry) {
    var text = null;
    return {
      id: entry.file.replace(/\.json$/i, ''),
      file: entry.file,
      label: entry.label || entry.file,
      hint: entry.hint || '',
      /* resolves to a fresh copy every time: the app edits what it is given */
      get: function () {
        var ready = text !== null ? Promise.resolve()
          : getJson(DIR + entry.file).then(function (cfg) { text = JSON.stringify(cfg); });
        return ready.then(function () {
          var copy = JSON.parse(text);
          (copy.projects || []).forEach(function (p) { delete p.uid; });
          return copy;
        });
      }
    };
  }

  /* resolves to [{ id, file, label, hint, get }] from the index alone */
  function load() {
    return getJson(DIR + 'index.json').then(function (index) { return index.map(lazyPreset); });
  }

  global.Presets = { blank: blank, load: load, base: base, project: project, KEEP: KEEP };

})(window);
