/* ------------------------------------------------------------------
 * presets.js - starting points taken from the deployment scripts that
 * are already in use, so a new script can be built by editing rather
 * than typing everything from scratch.
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

  var PRESETS = [
    {
      id: 'blank',
      label: 'Blank script',
      hint: 'One empty project',
      build: function () {
        return base({ projects: [project({ name: 'API' })] });
      }
    },
    {
      id: 'actfms',
      label: 'ACTFMS (API + Web, two pools each)',
      hint: 'From deploy-fms.bat',
      build: function () {
        return base({
          scriptName: 'deploy-actfms',
          title: 'ACTFMS Deployment',
          zipSource: '\\\\actsstorwvd.file.core.windows.net\\wvd-ase\\ACTFMSNEW_LAST_PUBLISH\\ACTFMSNEW_PUBLISH.zip',
          extractDir: 'C:\\Publish\\ACTFMSNEW_PUBLISH',
          projects: [
            project({
              name: 'MPSAPI', sourceSub: 'ACTFMS_API', pool: 'MPSAPI', site: 'MPSAPI',
              targets: ['C:\\Team ACTFMS\\Web services\\MPSAPI']
            }),
            project({
              name: 'MPSAPI_BES', sourceSub: 'ACTFMS_API', pool: 'MPSAPI_BES', site: 'MPSAPI_BES',
              targets: ['C:\\Team ACTFMS\\Web services\\MPSAPI_BES']
            }),
            project({
              name: 'MPSWEB', sourceSub: 'ACTFMS_ADMIN', pool: 'MPSWEB', site: 'MPSWEB',
              targets: ['C:\\Team ACTFMS\\Web Applications\\MPSWEB']
            }),
            project({
              name: 'MPSWEB_BES', sourceSub: 'ACTFMS_ADMIN', pool: 'MPSWEB_BES', site: 'MPSWEB_BES',
              targets: ['C:\\Team ACTFMS\\Web Applications\\MPSWEB_BES']
            })
          ]
        });
      }
    },
    {
      id: 'dicard',
      label: 'Di-Card (4 applications)',
      hint: 'From deploy-dicard.bat',
      build: function () {
        return base({
          scriptName: 'deploy-dicard',
          title: 'Di-Card Deployment',
          zipSource: '\\\\actsstorwvd.file.core.windows.net\\wvd-ase\\DICARD_LAST_PUBLISH\\DICARD_PUBLISH.zip',
          extractDir: 'C:\\Publish\\DICARD_PUBLISH',
          projects: [
            project({
              name: 'BackendAPI', sourceSub: 'DICARD_API', pool: 'EDCARDBACKENDAPI', site: 'EDCARDBACKENDAPI',
              targets: ['C:\\Team ACTBMS\\EDCARD BACKENDAPI']
            }),
            project({
              name: 'Frontend', sourceSub: 'DICARD_FRONTEND', pool: 'EDCARDFRONTEND', site: 'EDCARDFRONTEND',
              targets: ['C:\\Team ACTBMS\\EDCARD FRONTEND']
            }),
            project({
              name: 'Portal', sourceSub: 'DICARD_PORTAL', pool: 'EDCARDPORTAL', site: 'EDCARDPORTAL',
              targets: ['C:\\Team ACTBMS\\EDCARD PORTAL']
            }),
            project({
              name: 'Maintenance', sourceSub: 'DICARD_MAINTENANCE', pool: 'EDCARDMAINTENANCE', site: 'EDCARDMAINTENANCE',
              targets: ['C:\\Team ACTBMS\\EDCARD MAINTENANCE']
            })
          ]
        });
      }
    },
    {
      id: 'actpol',
      label: 'ACTPOL Gateway (single API, local zip)',
      hint: 'From deploy-actpol-gateway.bat',
      build: function () {
        return base({
          scriptName: 'deploy-actpol-gateway',
          title: 'ACTPOL Gateway API Deployment',
          zipSource: 'C:\\@publish\\input\\ACTPOLGatewayAPI_PUBLISH.zip',
          extractDir: 'C:\\@publish\\input\\ACTPOLGatewayAPI_PUBLISH',
          projects: [
            project({
              name: 'ACTPOLGatewayAPI', sourceSub: 'ACTS_API', pool: 'ACTPOLGatewayAPI', site: '',
              targets: ['C:\\Team .NET\\Web services\\ACTPOLGatewayAPI']
            })
          ]
        });
      }
    }
  ];

  global.Presets = { list: PRESETS, base: base, project: project, KEEP: KEEP };

})(window);
