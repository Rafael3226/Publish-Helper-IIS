/* ------------------------------------------------------------------
 * generator.js - turns a configuration object into a Windows .bat
 * deployment script for IIS.
 *
 * The generated script follows the layout that is known to work on the
 * ACTS servers: config block on top, cscript/tar/7-Zip for unzipping, appcmd for the
 * application pools, xcopy /EXCLUDE for the "do not replace" list and
 * robocopy for the backups.
 * ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var CRLF = '\r\n';
  var RULE = 'REM ' + repeat('=', 58);

  function repeat(s, n) { return new Array(n + 1).join(s); }
  function t(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function trimSlash(p) { return t(p).replace(/[\\/]+$/, ''); }
  function trimBothSlash(p) { return t(p).replace(/^[\\/]+/, '').replace(/[\\/]+$/, ''); }

  /* value of a  set "NAME=value"  line */
  function escSet(v) { return t(v).replace(/%/g, '%%').replace(/"/g, ''); }
  function setv(name, value) { return 'set "' + name + '=' + escSet(value) + '"'; }
  /* same, but keeps %VAR% references written by the generator itself intact */
  function setvRaw(name, value) { return 'set "' + name + '=' + t(value).replace(/"/g, '') + '"'; }

  /* value of an  echo value  line (delayed expansion is off there) */
  function escEcho(v) {
    return t(v).replace(/\^/g, '^^').replace(/([&<>|()])/g, '^$1').replace(/%/g, '%%');
  }

  function bool(v) { return v ? '1' : '0'; }

  function parseKeep(text) {
    return t(text).split(/[\r\n]+/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l && l.indexOf('REM ') !== 0; });
  }

  function enabledProjects(cfg) {
    return (cfg.projects || []).filter(function (p) { return p.enabled !== false; });
  }

  /* source folder of a project, as written in the config block.
     In zip mode the value keeps a live %EXTRACT_DIR% reference, so changing
     the extract folder in the config block moves every project with it. */
  function sourceOf(cfg, p) {
    if (!cfg.useZip || p.sourceMode === 'abs') return trimSlash(p.sourceAbs);
    var sub = trimBothSlash(p.sourceSub);
    return sub ? '%EXTRACT_DIR%\\' + escSet(sub) : '%EXTRACT_DIR%';
  }
  function usesExtractDir(cfg, p) { return !!cfg.useZip && p.sourceMode !== 'abs'; }

  function targetsOf(p) {
    return (p.targets || []).map(trimSlash).filter(Boolean);
  }

  /* cscript is the default: Shell.Application is on every Windows, tar is not */
  var UNZIP_METHODS = ['cscript', 'tar', '7zip'];
  function unzipMethod(cfg) {
    var m = t(cfg.unzipMethod).toLowerCase();
    return UNZIP_METHODS.indexOf(m) === -1 ? 'cscript' : m;
  }

  /* ---------------------------------------------------------------- */
  /* configuration block                                              */
  /* ---------------------------------------------------------------- */
  function configBlock(cfg, L) {
    var projects = enabledProjects(cfg);

    L.push('REM ' + repeat('#', 58));
    L.push('REM #' + center('C O N F I G U R A T I O N', 56) + '#');
    L.push('REM #' + center('everything you may need to change lives here', 56) + '#');
    L.push('REM ' + repeat('#', 58));
    L.push('');

    L.push('REM ---------- General ----------');
    L.push(setv('SCRIPT_TITLE', cfg.title || 'Deployment'));
    L.push(setv('SCRIPT_ID', slug(cfg.scriptName || cfg.title || 'deploy')));
    L.push('REM batch = stop every pool, then copy everything, then start every pool');
    L.push('REM sequential = handle one project completely before moving to the next');
    L.push(setv('DEPLOY_MODE', cfg.deployMode === 'sequential' ? 'sequential' : 'batch'));
    L.push('REM ask for elevation automatically when not started as Administrator');
    L.push(setv('AUTO_ELEVATE', bool(cfg.autoElevate)));
    L.push(setv('PAUSE_AT_END', bool(cfg.pauseAtEnd)));
    L.push('REM seconds to wait after stopping a pool so IIS releases the files');
    L.push(setv('STOP_WAIT_SECONDS', String(numOr(cfg.stopWait, 3))));
    L.push('');

    L.push('REM ---------- Release package ----------');
    L.push(setv('USE_ZIP', bool(cfg.useZip)));
    L.push(setv('ZIP_SOURCE', cfg.zipSource));
    L.push(setv('EXTRACT_DIR', trimSlash(cfg.extractDir)));
    L.push('REM 1 = delete the extract folder before extracting (recommended)');
    L.push(setv('CLEAN_EXTRACT', bool(cfg.cleanExtract)));
    L.push('REM how the zip is opened:');
    L.push('REM   cscript = Windows Script Host, works on every Windows');
    L.push('REM   tar     = only on Windows 10 1803 / Server 2019 and newer');
    L.push('REM   7zip    = 7-Zip, set SEVENZIP_EXE below');
    L.push(setv('UNZIP_METHOD', unzipMethod(cfg)));
    if (unzipMethod(cfg) === '7zip') {
      L.push(setv('SEVENZIP_EXE', t(cfg.sevenZipExe) || 'C:\\Program Files\\7-Zip\\7z.exe'));
    }
    L.push('');

    L.push('REM ---------- Backup ----------');
    L.push(setv('BACKUP_ENABLED', bool(cfg.backupEnabled)));
    L.push(setv('BACKUP_ROOT', trimSlash(cfg.backupRoot)));
    L.push('REM keep only the newest N backup runs, 0 = keep them all');
    L.push(setv('BACKUP_KEEP', String(numOr(cfg.backupKeep, 0))));
    L.push('');

    L.push('REM ---------- Logging ----------');
    L.push(setv('LOG_ENABLED', bool(cfg.logEnabled)));
    L.push(setv('LOG_DIR', trimSlash(cfg.logDir)));
    L.push('');

    L.push('REM ---------- Working folders ----------');
    L.push('REM the "do not replace" lists are written here at run time.');
    L.push('REM this path must NOT contain spaces (xcopy /EXCLUDE cannot be quoted).');
    L.push(setv('EXCLUDE_DIR', trimSlash(cfg.excludeDir)));
    L.push('');

    L.push('REM ---------- Projects ----------');
    L.push(setv('PROJECT_COUNT', String(projects.length)));
    L.push('');

    projects.forEach(function (p, i) {
      var n = i + 1;
      var keep = parseKeep(p.keepText);
      var targets = targetsOf(p);

      L.push('REM --- Project ' + n + ': ' + (t(p.name) || 'project ' + n) + ' ---');
      L.push(setv('P' + n + '_NAME', t(p.name) || 'Project ' + n));
      L.push((usesExtractDir(cfg, p) ? setvRaw : setv)('P' + n + '_SOURCE', sourceOf(cfg, p)));
      L.push(setv('P' + n + '_POOL', p.pool));
      L.push('REM leave the site empty to only stop and start the application pool');
      L.push(setv('P' + n + '_SITE', p.site));
      L.push(setv('P' + n + '_BACKUP', bool(p.backup !== false)));
      L.push(setv('P' + n + '_TARGETS', String(targets.length)));
      targets.forEach(function (target, ti) {
        L.push(setv('P' + n + '_TARGET' + (ti + 1), target));
      });
      L.push('REM files that must never be overwritten in the destination');
      L.push(setv('P' + n + '_KEEP', String(keep.length)));
      keep.forEach(function (k, ki) {
        L.push(setv('P' + n + '_KEEP' + (ki + 1), k));
      });
      L.push('');
    });

    L.push('REM ' + repeat('#', 58));
    L.push('REM #' + center('E N D   O F   C O N F I G U R A T I O N', 56) + '#');
    L.push('REM ' + repeat('#', 58));
  }

  function center(text, width) {
    var pad = Math.max(0, width - text.length);
    var left = Math.floor(pad / 2);
    return repeat(' ', left) + text + repeat(' ', pad - left);
  }

  function numOr(v, d) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? d : n;
  }

  function slug(s) {
    return t(s).toLowerCase().replace(/\.bat$/, '').replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'deploy';
  }

  /* ---------------------------------------------------------------- */
  /* full script                                                      */
  /* ---------------------------------------------------------------- */
  function generate(cfg) {
    var L = [];
    var projects = enabledProjects(cfg);
    var stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

    L.push('@echo off');
    L.push(RULE);
    L.push('REM  ' + (t(cfg.title) || 'Deployment script'));
    L.push('REM  Generated ' + stamp + ' by IIS Publish Helper');
    L.push('REM  MUST BE RUN AS ADMINISTRATOR');
    L.push(RULE);
    L.push('setlocal enabledelayedexpansion');
    L.push('');

    configBlock(cfg, L);
    L.push('');

    /* ---- elevation ---- */
    L.push(RULE);
    L.push('REM  Administrator check');
    L.push(RULE);
    L.push('net session >nul 2>&1');
    L.push('if !errorlevel! neq 0 (');
    if (cfg.autoElevate) {
      L.push('    if "%AUTO_ELEVATE%"=="1" (');
      L.push('        echo Requesting Administrator privileges...');
      L.push('        powershell -NoProfile -Command "Start-Process -FilePath \'%~f0\' -Verb RunAs"');
      L.push('        exit /b 0');
      L.push('    )');
    }
    L.push('    echo.');
    L.push('    echo ERROR: Administrator privileges are required.');
    L.push('    echo Right-click this script and choose "Run as administrator".');
    L.push('    echo.');
    L.push('    pause');
    L.push('    exit /b 1');
    L.push(')');
    L.push('');

    /* ---- timestamp ---- */
    L.push(RULE);
    L.push('REM  Timestamp used for the backup folder and the log file');
    L.push(RULE);
    L.push('set "STAMP="');
    L.push('for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"`) do set "STAMP=%%i"');
    L.push('if not defined STAMP set "STAMP=run_%RANDOM%"');
    L.push('set "ERRORS=0"');
    L.push('set /a _WAITPING=%STOP_WAIT_SECONDS%+1');
    L.push('');

    /* ---- logging ---- */
    L.push(RULE);
    L.push('REM  Logging - re-runs this script once, piped through Tee-Object');
    L.push(RULE);
    L.push('if "%LOG_ENABLED%"=="1" if /I not "%~1"=="--logged" (');
    L.push('    if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1');
    L.push('    set "DEPLOY_LOG=%LOG_DIR%\\%SCRIPT_ID%_!STAMP!.log"');
    L.push('    set "RC_FILE=%LOG_DIR%\\%SCRIPT_ID%.rc"');
    L.push('    del "%LOG_DIR%\\%SCRIPT_ID%.rc" >nul 2>&1');
    L.push('    call "%~f0" --logged 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath $env:DEPLOY_LOG"');
    L.push('    REM a pipe hides the exit code of the inner run, so it is handed over in a file');
    L.push('    set "_RC=!errorlevel!"');
    L.push('    if exist "%LOG_DIR%\\%SCRIPT_ID%.rc" (');
    L.push('        for /f "usebackq delims=" %%r in ("%LOG_DIR%\\%SCRIPT_ID%.rc") do set "_RC=%%r"');
    L.push('        del "%LOG_DIR%\\%SCRIPT_ID%.rc" >nul 2>&1');
    L.push('    )');
    L.push('    echo.');
    L.push('    echo Log written to !DEPLOY_LOG!');
    L.push('    if "%PAUSE_AT_END%"=="1" pause');
    L.push('    exit /b !_RC!');
    L.push(')');
    L.push('');

    /* ---- header ---- */
    L.push('call :Section "%SCRIPT_TITLE%"');
    L.push('echo   Started    : %DATE% %TIME%');
    L.push('echo   Computer   : %COMPUTERNAME%');
    L.push('echo   Projects   : %PROJECT_COUNT%');
    L.push('echo   Mode       : %DEPLOY_MODE%');
    L.push('echo.');
    L.push('');

    /* ---- step 1 : unzip ---- */
    L.push(RULE);
    L.push('REM  Step 1 - Unpack the release');
    L.push(RULE);
    L.push('if "%USE_ZIP%"=="1" (');
    L.push('    call :Section "Step 1 - Unpacking the release"');
    L.push('    call :Unzip');
    L.push('    if !errorlevel! neq 0 goto :Failed');
    L.push(') else (');
    L.push('    call :Section "Step 1 - No zip configured, nothing to unpack"');
    L.push(')');
    L.push('');

    /* ---- step 2 : exclude lists ---- */
    L.push(RULE);
    L.push('REM  Step 2 - Write the "do not replace" lists');
    L.push(RULE);
    L.push('call :Section "Step 2 - Preparing the do-not-replace lists"');
    L.push('if not exist "%EXCLUDE_DIR%" mkdir "%EXCLUDE_DIR%" >nul 2>&1');
    L.push('setlocal disabledelayedexpansion');
    projects.forEach(function (p, i) {
      var n = i + 1;
      var keep = parseKeep(p.keepText);
      var file = '"%EXCLUDE_DIR%\\p' + n + '.txt"';
      if (!keep.length) {
        L.push('REM project ' + n + ' (' + (t(p.name) || n) + ') replaces every file - no exclude list');
        return;
      }
      L.push('REM project ' + n + ' - ' + (t(p.name) || n));
      keep.forEach(function (k, ki) {
        L.push((ki === 0 ? '> ' : '>>') + file + ' echo ' + escEcho(k));
      });
    });
    L.push('endlocal');
    projects.forEach(function (p, i) {
      var n = i + 1;
      var keep = parseKeep(p.keepText);
      var label = escEcho(t(p.name) || 'Project ' + n);
      if (keep.length) {
        L.push('echo   ' + label + ': ' + keep.length + ' file' + (keep.length === 1 ? '' : 's') + ' protected');
      } else {
        L.push('echo   ' + label + ': nothing protected, every file is replaced');
      }
    });
    L.push('');

    /* ---- steps 3..5 ---- */
    L.push(RULE);
    L.push('REM  Step 3 - Stop, back up, copy, start');
    L.push(RULE);
    L.push('if /I "%DEPLOY_MODE%"=="sequential" (');
    L.push('    for /L %%p in (1,1,%PROJECT_COUNT%) do (');
    L.push('        call :Section "Project %%p of %PROJECT_COUNT%"');
    L.push('        call :StopProject %%p');
    L.push('        call :BackupProject %%p');
    L.push('        call :CopyProject %%p');
    L.push('        call :StartProject %%p');
    L.push('    )');
    L.push(') else (');
    L.push('    call :Section "Step 3 - Stopping IIS"');
    L.push('    for /L %%p in (1,1,%PROJECT_COUNT%) do call :StopProject %%p');
    L.push('    call :Section "Step 4 - Backing up the current files"');
    L.push('    for /L %%p in (1,1,%PROJECT_COUNT%) do call :BackupProject %%p');
    L.push('    call :Section "Step 5 - Copying the new files"');
    L.push('    for /L %%p in (1,1,%PROJECT_COUNT%) do call :CopyProject %%p');
    L.push('    call :Section "Step 6 - Starting IIS"');
    L.push('    for /L %%p in (1,1,%PROJECT_COUNT%) do call :StartProject %%p');
    L.push(')');
    L.push('');

    /* ---- retention ---- */
    L.push(RULE);
    L.push('REM  Backup retention');
    L.push(RULE);
    L.push('if "%BACKUP_ENABLED%"=="1" if not "%BACKUP_KEEP%"=="0" call :PruneBackups');
    L.push('');

    /* ---- summary ---- */
    L.push(RULE);
    L.push('REM  Summary');
    L.push(RULE);
    L.push('if !ERRORS! equ 0 (');
    L.push('    call :Section "DEPLOYMENT COMPLETE"');
    L.push(') else (');
    L.push('    call :Section "DEPLOYMENT FINISHED WITH !ERRORS! ERRORS"');
    L.push('    echo   Scroll up to see which step failed.');
    L.push(')');
    L.push('echo   Finished   : %DATE% %TIME%');
    if (cfg.backupEnabled) {
      L.push('if "%BACKUP_ENABLED%"=="1" echo   Backup     : %BACKUP_ROOT%\\!STAMP!');
    }
    L.push('echo.');
    L.push('REM hand the result over to the outer instance when this run is being logged');
    L.push('if "%LOG_ENABLED%"=="1" > "%LOG_DIR%\\%SCRIPT_ID%.rc" echo !ERRORS!');
    L.push('REM when logging is on the outer instance is the one that pauses');
    L.push('if "%PAUSE_AT_END%"=="1" if /I not "%~1"=="--logged" pause');
    L.push('exit /b !ERRORS!');
    L.push('');
    L.push(':Failed');
    L.push('call :Section "DEPLOYMENT ABORTED"');
    L.push('echo   The release could not be unpacked, nothing was changed on this server.');
    L.push('echo.');
    L.push('if "%LOG_ENABLED%"=="1" > "%LOG_DIR%\\%SCRIPT_ID%.rc" echo 1');
    L.push('REM when logging is on the outer instance is the one that pauses');
    L.push('if "%PAUSE_AT_END%"=="1" if /I not "%~1"=="--logged" pause');
    L.push('exit /b 1');
    L.push('');

    subroutines(L);

    return L.join(CRLF) + CRLF;
  }

  /* ---------------------------------------------------------------- */
  /* the unzip helper the cscript method writes at run time            */
  /* ---------------------------------------------------------------- */
  /* Written flat, without indentation or blank lines: every line goes
     through  echo  in the .bat, which would eat the first space and
     turn an empty line into "ECHO is on". */
  function unzipVbs() {
    return [
      'Option Explicit',
      'Dim fso, sh, args, zipPath, dstPath, src, dst, want, waited, maxWait, stable, prev, cur, gap, told',
      'Set args = WScript.Arguments',
      'If args.Count < 2 Then WScript.Echo "      usage: unzip.vbs zipfile destination" : WScript.Quit 2',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'zipPath = args(0)',
      'dstPath = args(1)',
      'If Not fso.FileExists(zipPath) Then WScript.Echo "      zip not found: " & zipPath : WScript.Quit 3',
      'If Not fso.FolderExists(dstPath) Then fso.CreateFolder dstPath',
      'Set sh = CreateObject("Shell.Application")',
      'Set src = sh.NameSpace(zipPath)',
      'If src Is Nothing Then WScript.Echo "      this file cannot be opened as a zip: " & zipPath : WScript.Quit 4',
      'Set dst = sh.NameSpace(dstPath)',
      'If dst Is Nothing Then WScript.Echo "      cannot open the destination: " & dstPath : WScript.Quit 5',
      'want = src.Items().Count',
      'If want = 0 Then WScript.Echo "      the zip is empty" : WScript.Quit 6',
      "' 16 = yes to all, 4 = no progress window, 512 = no confirmation, 1024 = no error popup",
      'dst.CopyHere src.Items(), 16 + 4 + 512 + 1024',
      "' CopyHere returns at once, so wait until the destination stops growing.",
      "' Each check walks the whole extract folder, so the gap between checks",
      "' widens as the unpack goes on - on a big package a one second poll costs",
      "' more than it is worth and competes with the copy for the disk.",
      'maxWait = 1800',
      'waited = 0',
      'stable = 0',
      'gap = 2',
      'told = 0',
      'prev = ""',
      'Do',
      'WScript.Sleep gap * 1000',
      'waited = waited + gap',
      'If waited > 30 Then gap = 5',
      'If waited > 120 Then gap = 10',
      'cur = Snapshot(dstPath)',
      'If waited >= 60 And Split(cur, " ")(0) = "0" Then WScript.Echo "      nothing was extracted" : WScript.Quit 8',
      'If cur = prev Then stable = stable + 1 Else stable = 0',
      'prev = cur',
      'If waited - told >= 30 And stable = 0 Then',
      'WScript.Echo "      " & Split(cur, " ")(0) & " files after " & waited & " seconds"',
      'told = waited',
      'End If',
      'Loop Until (stable >= 3 And dst.Items().Count >= want) Or waited >= maxWait',
      'If waited >= maxWait Then WScript.Echo "      gave up waiting after " & maxWait & " seconds" : WScript.Quit 7',
      'WScript.Echo "      " & Split(prev, " ")(0) & " files unpacked"',
      'WScript.Quit 0',
      'Function Snapshot(folderPath)',
      'Dim n, s',
      'n = 0',
      's = 0',
      'Walk folderPath, n, s',
      'Snapshot = n & " " & s',
      'End Function',
      'Sub Walk(folderPath, n, s)',
      'Dim f, fl, sf',
      'On Error Resume Next',
      'Set f = fso.GetFolder(folderPath)',
      'If Err.Number <> 0 Then',
      'Err.Clear',
      'Exit Sub',
      'End If',
      'For Each fl In f.Files',
      'n = n + 1',
      's = s + fl.Size',
      'Next',
      'For Each sf In f.SubFolders',
      'Walk sf.Path, n, s',
      'Next',
      'On Error GoTo 0',
      'End Sub'
    ];
  }

  /* ---------------------------------------------------------------- */
  /* subroutines                                                      */
  /* ---------------------------------------------------------------- */
  function subroutines(L) {
    L.push(RULE);
    L.push('REM  Subroutines');
    L.push(RULE);
    L.push('');

    /* ---- Section ---- */
    L.push(':Section');
    L.push('REM the caption goes through a variable so that & < > in a name cannot break the echo');
    L.push('set "_SEC=%~1"');
    L.push('echo.');
    L.push('echo ' + repeat('=', 60));
    L.push('echo  !_SEC!');
    L.push('echo ' + repeat('=', 60));
    L.push('goto :EOF');
    L.push('');

    /* ---- Unzip ---- */
    L.push(':Unzip');
    L.push('if not exist "%ZIP_SOURCE%" (');
    L.push('    echo   ERROR: zip file not found: %ZIP_SOURCE%');
    L.push('    exit /b 1');
    L.push(')');
    L.push('if "%CLEAN_EXTRACT%"=="1" if exist "%EXTRACT_DIR%" (');
    L.push('    echo   Removing the previous extract folder...');
    L.push('    rmdir /s /q "%EXTRACT_DIR%"');
    L.push(')');
    L.push('if not exist "%EXTRACT_DIR%" mkdir "%EXTRACT_DIR%"');
    L.push('echo   Extracting %ZIP_SOURCE%');
    L.push('echo   using %UNZIP_METHOD%');
    L.push('set "_UZRC=9"');
    L.push('if /I "%UNZIP_METHOD%"=="cscript" (');
    L.push('    call :UnzipVbs');
    L.push('    set "_UZRC=!errorlevel!"');
    L.push(')');
    L.push('if /I "%UNZIP_METHOD%"=="tar" (');
    L.push('    call :UnzipTar');
    L.push('    set "_UZRC=!errorlevel!"');
    L.push(')');
    L.push('if /I "%UNZIP_METHOD%"=="7zip" (');
    L.push('    call :Unzip7z');
    L.push('    set "_UZRC=!errorlevel!"');
    L.push(')');
    L.push('if "!_UZRC!"=="9" (');
    L.push('    echo   ERROR: UNZIP_METHOD is "%UNZIP_METHOD%" - use cscript, tar or 7zip.');
    L.push('    exit /b 1');
    L.push(')');
    L.push('if not "!_UZRC!"=="0" (');
    L.push('    echo   ERROR: extracting the zip failed.');
    L.push('    exit /b 1');
    L.push(')');
    L.push('echo   Extracted to %EXTRACT_DIR%');
    L.push('exit /b 0');
    L.push('');

    /* ---- Unzip: tar ---- */
    L.push(':UnzipTar');
    L.push('where tar >nul 2>&1');
    L.push('if !errorlevel! neq 0 (');
    L.push('    echo      tar is not installed on this machine.');
    L.push('    exit /b 1');
    L.push(')');
    L.push('tar -xf "%ZIP_SOURCE%" -C "%EXTRACT_DIR%"');
    L.push('exit /b !errorlevel!');
    L.push('');

    /* ---- Unzip: 7-Zip ---- */
    L.push(':Unzip7z');
    L.push('if not exist "%SEVENZIP_EXE%" (');
    L.push('    echo      7-Zip not found: %SEVENZIP_EXE%');
    L.push('    exit /b 1');
    L.push(')');
    L.push('"%SEVENZIP_EXE%" x "%ZIP_SOURCE%" -o"%EXTRACT_DIR%" -y');
    L.push('exit /b !errorlevel!');
    L.push('');

    /* ---- Unzip: Windows Script Host ---- */
    L.push(':UnzipVbs');
    L.push('if not exist "%EXCLUDE_DIR%" mkdir "%EXCLUDE_DIR%" >nul 2>&1');
    L.push('set "_VBS=%EXCLUDE_DIR%\\unzip.vbs"');
    L.push('call :WriteUnzipVbs');
    L.push('cscript //nologo "!_VBS!" "%ZIP_SOURCE%" "%EXTRACT_DIR%"');
    L.push('set "_VBSRC=!errorlevel!"');
    L.push('if "!_VBSRC!"=="0" (');
    L.push('    del "!_VBS!" >nul 2>&1');
    L.push(') else (');
    L.push('    echo      the helper script was left at !_VBS!');
    L.push(')');
    L.push('exit /b !_VBSRC!');
    L.push('');

    L.push(':WriteUnzipVbs');
    L.push('REM Shell.Application copies in the background, so the script waits for the');
    L.push('REM destination to stop growing before it reports success.');
    L.push('setlocal disabledelayedexpansion');
    unzipVbs().forEach(function (line, i) {
      L.push((i === 0 ? '> ' : '>>') + '"%EXCLUDE_DIR%\\unzip.vbs" echo ' + escEcho(line));
    });
    L.push('endlocal');
    L.push('goto :EOF');
    L.push('');

    /* ---- StopProject ---- */
    L.push(':StopProject');
    L.push('set "_I=%~1"');
    L.push('set "_NAME=!P%_I%_NAME!"');
    L.push('set "_POOL=!P%_I%_POOL!"');
    L.push('set "_SITE=!P%_I%_SITE!"');
    L.push('echo.');
    L.push('echo   [!_NAME!] stopping');
    L.push('if defined _SITE (');
    L.push('    "%windir%\\system32\\inetsrv\\appcmd.exe" stop site /site.name:"!_SITE!" >nul 2>&1');
    L.push('    if !errorlevel! equ 0 (');
    L.push('        echo      site !_SITE! stopped.');
    L.push('    ) else (');
    L.push('        echo      site !_SITE! not found or already stopped.');
    L.push('    )');
    L.push(')');
    L.push('if defined _POOL (');
    L.push('    "%windir%\\system32\\inetsrv\\appcmd.exe" stop apppool /apppool.name:"!_POOL!" >nul 2>&1');
    L.push('    if !errorlevel! equ 0 (');
    L.push('        echo      pool !_POOL! stopped.');
    L.push('    ) else (');
    L.push('        echo      pool !_POOL! not found or already stopped.');
    L.push('    )');
    L.push('    if %STOP_WAIT_SECONDS% GTR 0 (');
    L.push('        REM timeout refuses to run when stdin is redirected, ping is the fallback');
    L.push('        timeout /t %STOP_WAIT_SECONDS% /nobreak >nul 2>&1');
    L.push('        if !errorlevel! neq 0 ping -n !_WAITPING! 127.0.0.1 >nul 2>&1');
    L.push('    )');
    L.push(')');
    L.push('goto :EOF');
    L.push('');

    /* ---- StartProject ---- */
    L.push(':StartProject');
    L.push('set "_I=%~1"');
    L.push('set "_NAME=!P%_I%_NAME!"');
    L.push('set "_POOL=!P%_I%_POOL!"');
    L.push('set "_SITE=!P%_I%_SITE!"');
    L.push('echo.');
    L.push('echo   [!_NAME!] starting');
    L.push('if defined _POOL (');
    L.push('    "%windir%\\system32\\inetsrv\\appcmd.exe" start apppool /apppool.name:"!_POOL!" >nul 2>&1');
    L.push('    if !errorlevel! equ 0 (');
    L.push('        echo      pool !_POOL! started.');
    L.push('    ) else (');
    L.push('        echo      ERROR: pool !_POOL! could not be started.');
    L.push('        set /a ERRORS+=1');
    L.push('    )');
    L.push(')');
    L.push('if defined _SITE (');
    L.push('    "%windir%\\system32\\inetsrv\\appcmd.exe" start site /site.name:"!_SITE!" >nul 2>&1');
    L.push('    if !errorlevel! equ 0 (');
    L.push('        echo      site !_SITE! started.');
    L.push('    ) else (');
    L.push('        echo      ERROR: site !_SITE! could not be started.');
    L.push('        set /a ERRORS+=1');
    L.push('    )');
    L.push(')');
    L.push('goto :EOF');
    L.push('');

    /* ---- BackupProject ---- */
    L.push(':BackupProject');
    L.push('set "_I=%~1"');
    L.push('set "_NAME=!P%_I%_NAME!"');
    L.push('if not "%BACKUP_ENABLED%"=="1" goto :EOF');
    L.push('if not "!P%_I%_BACKUP!"=="1" (');
    L.push('    echo.');
    L.push('    echo   [!_NAME!] backup disabled for this project');
    L.push('    goto :EOF');
    L.push(')');
    L.push('echo.');
    L.push('echo   [!_NAME!] backing up');
    L.push('for /L %%t in (1,1,!P%_I%_TARGETS!) do call :BackupOne %_I% %%t');
    L.push('goto :EOF');
    L.push('');

    L.push(':BackupOne');
    L.push('set "_I=%~1"');
    L.push('set "_T=%~2"');
    L.push('set "_NAME=!P%_I%_NAME!"');
    L.push('set "_TGT=!P%_I%_TARGET%_T%!"');
    L.push('if not exist "!_TGT!" (');
    L.push('    echo      nothing to back up, folder does not exist yet: !_TGT!');
    L.push('    goto :EOF');
    L.push(')');
    L.push('for %%d in ("!_TGT!") do set "_LEAF=%%~nxd"');
    L.push('set "_DEST=%BACKUP_ROOT%\\!STAMP!\\!_NAME!\\!_LEAF!"');
    L.push('echo      !_TGT!');
    L.push('echo        -^> !_DEST!');
    L.push('robocopy "!_TGT!" "!_DEST!" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul');
    L.push('if !errorlevel! GEQ 8 (');
    L.push('    echo      ERROR: backup failed.');
    L.push('    set /a ERRORS+=1');
    L.push(') else (');
    L.push('    echo      backup ok.');
    L.push(')');
    L.push('goto :EOF');
    L.push('');

    /* ---- CopyProject ---- */
    L.push(':CopyProject');
    L.push('set "_I=%~1"');
    L.push('set "_NAME=!P%_I%_NAME!"');
    L.push('set "_SRC=!P%_I%_SOURCE!"');
    L.push('echo.');
    L.push('echo   [!_NAME!] copying files');
    L.push('if not exist "!_SRC!" (');
    L.push('    echo      ERROR: source folder not found: !_SRC!');
    L.push('    set /a ERRORS+=1');
    L.push('    goto :EOF');
    L.push(')');
    L.push('for /L %%t in (1,1,!P%_I%_TARGETS!) do call :CopyOne %_I% %%t');
    L.push('goto :EOF');
    L.push('');

    L.push(':CopyOne');
    L.push('set "_I=%~1"');
    L.push('set "_T=%~2"');
    L.push('set "_SRC=!P%_I%_SOURCE!"');
    L.push('set "_TGT=!P%_I%_TARGET%_T%!"');
    L.push('set "_EXC="');
    L.push('if !P%_I%_KEEP! GTR 0 set "_EXC=/EXCLUDE:%EXCLUDE_DIR%\\p%_I%.txt"');
    L.push('if not exist "!_TGT!" (');
    L.push('    echo      creating destination !_TGT!');
    L.push('    mkdir "!_TGT!"');
    L.push(')');
    L.push('echo      !_SRC!');
    L.push('echo        -^> !_TGT!');
    L.push('xcopy "!_SRC!\\*" "!_TGT!\\" /E /Y /I /Q !_EXC!');
    L.push('if !errorlevel! neq 0 (');
    L.push('    echo      ERROR: copy failed.');
    L.push('    set /a ERRORS+=1');
    L.push(') else (');
    L.push('    echo      copy ok.');
    L.push(')');
    L.push('goto :EOF');
    L.push('');

    /* ---- PruneBackups ---- */
    L.push(':PruneBackups');
    L.push('echo.');
    L.push('echo   Keeping only the newest %BACKUP_KEEP% backup runs in %BACKUP_ROOT%');
    L.push('powershell -NoProfile -Command "$r=$env:BACKUP_ROOT; $k=[int]$env:BACKUP_KEEP; if (Test-Path -LiteralPath $r) { Get-ChildItem -LiteralPath $r -Directory | Sort-Object Name -Descending | Select-Object -Skip $k | ForEach-Object { Write-Host (\'      removing \' + $_.Name); Remove-Item -LiteralPath $_.FullName -Recurse -Force } }"');
    L.push('goto :EOF');
    L.push('');
  }

  /* ---------------------------------------------------------------- */
  /* validation                                                       */
  /* ---------------------------------------------------------------- */
  function validate(cfg) {
    var out = [];
    var projects = enabledProjects(cfg);

    function err(m) { out.push({ level: 'err', message: m }); }
    function warn(m) { out.push({ level: 'warn', message: m }); }

    if (!t(cfg.scriptName)) err('The script has no file name.');
    if (/\s/.test(t(cfg.excludeDir))) err('The exclude folder contains a space — xcopy /EXCLUDE will fail. Use a path such as C:\\Publish\\_excludes.');
    if (!t(cfg.excludeDir)) err('The exclude folder is empty.');

    if (cfg.useZip) {
      if (!t(cfg.zipSource)) err('No zip file configured.');
      if (!t(cfg.extractDir)) err('No extract folder configured.');
      if (/^\\\\/.test(t(cfg.zipSource))) warn('The zip sits on a UNC share — an elevated session does not always have credentials for one. Point this at a local copy if the extract step fails.');
      if (/^\\\\/.test(t(cfg.extractDir))) warn('The extract folder is a UNC path — extract to a local drive instead.');
      if (unzipMethod(cfg) === 'cscript' && !cfg.cleanExtract) {
        warn('cscript unpacks through Windows Explorer, which may stop and ask before it replaces a file. Switch on "Empty the extract folder before extracting" so it never has to.');
      }
      if (unzipMethod(cfg) === 'tar') {
        warn('tar only exists on Windows 10 1803 / Server 2019 and newer. Run  where tar  on the target server before you rely on it.');
      }
    }
    if (cfg.backupEnabled && !t(cfg.backupRoot)) err('Backups are on but no backup root is set.');
    if (cfg.logEnabled && !t(cfg.logDir)) err('Logging is on but no log folder is set.');
    if (!projects.length) err('No enabled projects — the script would do nothing.');

    var names = {}, allTargets = {};
    projects.forEach(function (p, i) {
      var label = t(p.name) || 'Project ' + (i + 1);
      if (!t(p.name)) warn(label + ': no name.');
      if (names[t(p.name).toLowerCase()]) warn('Two projects are called "' + t(p.name) + '" — backups of both land in the same folder.');
      names[t(p.name).toLowerCase()] = true;

      if (!sourceOf(cfg, p) || (!cfg.useZip || p.sourceMode === 'abs') && !t(p.sourceAbs)) {
        err(label + ': no origin folder.');
      }
      var targets = targetsOf(p);
      if (!targets.length) err(label + ': no destination folder.');
      targets.forEach(function (target) {
        if (allTargets[target.toLowerCase()]) warn('Destination used by more than one project: ' + target);
        allTargets[target.toLowerCase()] = true;
        if (cfg.useZip && t(cfg.extractDir) && target.toLowerCase().indexOf(t(cfg.extractDir).toLowerCase()) === 0) {
          err(label + ': the destination sits inside the extract folder, which is deleted on every run.');
        }
      });
      if (!t(p.pool) && !t(p.site)) warn(label + ': no application pool and no site — files are copied while IIS keeps running and may be locked.');
      if (!parseKeep(p.keepText).length) warn(label + ': nothing on the do-not-replace list — appsettings.json and web.config will be overwritten.');
    });

    return out;
  }

  /* ---------------------------------------------------------------- */
  /* zip structure preview                                            */
  /* ---------------------------------------------------------------- */
  function zipTree(cfg) {
    var projects = enabledProjects(cfg);
    var zipName = (t(cfg.zipSource).split(/[\\/]/).pop()) || 'release.zip';
    var lines = [zipName];
    var inZip = projects.filter(function (p) { return p.sourceMode !== 'abs'; });

    if (!inZip.length) { lines.push('  (no project reads from the zip)'); return lines.join('\n'); }

    inZip.forEach(function (p, i) {
      var last = i === inZip.length - 1;
      var sub = trimBothSlash(p.sourceSub) || '(root)';
      lines.push((last ? ' └─ ' : ' ├─ ') + sub + '   →  ' + (t(p.name) || 'project'));
      var targets = targetsOf(p);
      targets.forEach(function (target) {
        lines.push((last ? '    ' : ' │  ') + '     ' + target);
      });
    });
    return lines.join('\n');
  }

  global.BatGenerator = {
    generate: generate,
    validate: validate,
    zipTree: zipTree,
    slug: slug,
    parseKeep: parseKeep
  };

})(window);
