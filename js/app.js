/* ------------------------------------------------------------------
 * app.js - form state, rendering, collapse state and persistence
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var STORE_CURRENT = 'iis-publish-helper.current';
  var STORE_SAVED = 'iis-publish-helper.saved';
  var STORE_UI = 'iis-publish-helper.ui';
  var STORE_THEME = 'iis-publish-helper.theme';   /* also read by the inline script in index.html */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var uidSeed = 1;
  var state = load() || migrate(Presets.list[0].build());
  var ui = loadUi();
  var previewTimer = null;

  /* ---------------------------------------------------------------- */
  /* persistence                                                      */
  /* ---------------------------------------------------------------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_CURRENT);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  function persist() {
    try { localStorage.setItem(STORE_CURRENT, JSON.stringify(state)); } catch (e) { /* quota */ }
  }

  /* steps a remembered activeStep may still name: the script is its own always-open
     column now, and the settings step folded into defaults */
  var RETIRED_STEPS = { 'step-output': true, 'step-settings': true };

  /* null means every step was closed on purpose and is kept */
  function rememberedStep(step) {
    return step === undefined || RETIRED_STEPS[step] ? 'step-package' : step;
  }

  function loadUi() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_UI) || '{}');
      return {
        view: raw.view === 'full' ? 'full' : 'simple',
        activeStep: rememberedStep(raw.activeStep),
        showDefaults: !!raw.showDefaults,
        scriptOpen: raw.scriptOpen === true,           /* folded unless opened on purpose */
        dirty: !!raw.dirty,
        savedName: typeof raw.savedName === 'string' ? raw.savedName : '',
        projects: raw.projects || {}
      };
    } catch (e) {
      return { view: 'simple', activeStep: 'step-package', showDefaults: false, scriptOpen: false, dirty: false,
               savedName: '', projects: {} };
    }
  }

  function persistUi() {
    try { localStorage.setItem(STORE_UI, JSON.stringify(ui)); } catch (e) { /* quota */ }
  }

  function savedConfigs() {
    try { return JSON.parse(localStorage.getItem(STORE_SAVED) || '{}'); } catch (e) { return {}; }
  }

  function writeSaved(all) {
    try { localStorage.setItem(STORE_SAVED, JSON.stringify(all)); }
    catch (e) { toast('Could not save — browser storage is full.'); }
  }

  /* fills in anything an older or imported configuration is missing */
  function migrate(cfg) {
    var full = Presets.base({});
    Object.keys(full).forEach(function (k) { if (cfg[k] === undefined) cfg[k] = full[k]; });
    /* dropped: the zip is now read straight from where it is */
    delete cfg.copyZipLocal;
    delete cfg.localZip;
    cfg.projects = (cfg.projects || []).map(function (p) {
      var fp = Presets.project({});
      Object.keys(fp).forEach(function (k) { if (p[k] === undefined) p[k] = fp[k]; });
      if (!Array.isArray(p.targets) || !p.targets.length) p.targets = [''];
      if (!p.uid) p.uid = 'p' + (uidSeed++);
      return p;
    });
    if (!cfg.projects.length) cfg.projects = [Presets.project({ uid: 'p' + (uidSeed++) })];
    normalizeSources(cfg);
    return cfg;
  }

  /* with no zip there is no folder inside one to point at, so every origin is absolute */
  function normalizeSources(cfg) {
    cfg = cfg || state;
    if (cfg.useZip) return;
    (cfg.projects || []).forEach(function (p) { p.sourceMode = 'abs'; });
  }

  /* the script being edited has changes that were never saved or exported */
  function markDirty() {
    if (ui.dirty) return;
    ui.dirty = true;
    persistUi();
    renderCurrent();
  }

  function markClean() {
    ui.dirty = false;
    persistUi();
    renderCurrent();
  }

  /* loading something else throws the edited script away, so ask only when that loses work */
  function confirmReplace(message) {
    return !ui.dirty || confirm(message || 'Replace the script being edited? Unsaved changes are lost.');
  }

  /* savedName: the saved configuration this came from, so Save offers to overwrite it */
  function replaceState(cfg, savedName) {
    state = migrate(cfg);
    ui.dirty = false;
    ui.savedName = savedName || '';
    persistUi();
    renderAll();
    renderSaved();
  }

  function newProject(over) {
    over = over || {};
    over.uid = 'p' + (uidSeed++);
    return Presets.project(over);
  }

  /* ---------------------------------------------------------------- */
  /* collapse state                                                   */
  /* ---------------------------------------------------------------- */
  var closingOthers = false;

  /* the toggle event does not bubble, so it is caught on the way down */
  document.addEventListener('toggle', function (ev) {
    var el = ev.target;

    if (el.classList.contains('step')) {
      if (closingOthers) return;                       /* fired by the line below */
      if (el.open) {
        ui.activeStep = el.id;
        closeOtherSteps(el);
        revealStep(el);
      } else if (ui.activeStep === el.id) {
        ui.activeStep = null;                          /* all steps closed is allowed */
      }
      persistUi();
      return;
    }

    if (el.classList.contains('project')) {
      var p = state.projects[+el.dataset.index];
      if (p) { ui.projects[p.uid] = el.open; persistUi(); }
    }
  }, true);

  /* only one step stays open, the others fold away */
  function closeOtherSteps(keep) {
    closingOthers = true;
    $$('details.step').forEach(function (s) { if (s !== keep) s.open = false; });
    closingOthers = false;
  }

  /* an accordion moves things around, so bring the new step into view.
     scrollIntoView walks up to whichever ancestor actually scrolls — the steps
     column in two-column mode, the window when the layout is stacked. */
  function revealStep(el) {
    if (!el.scrollIntoView) return;
    var soon = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window)
                                            : function (fn) { setTimeout(fn, 16); };
    soon(function () {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      catch (e) { el.scrollIntoView(); }
    });
  }

  /* a button inside a summary must act, not fold the section */
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('summary') && ev.target.closest('button')) ev.preventDefault();
  });

  /* the defaults panel stays out of sight until it is asked for */
  function applyDefaultsVisibility() {
    var panel = $('#step-defaults');
    panel.hidden = !ui.showDefaults;
    $('#btnDefaults').classList.toggle('primary', ui.showDefaults);
    if (!ui.showDefaults && ui.activeStep === 'step-defaults') {
      ui.activeStep = null;
      panel.open = false;
    }
  }

  $('#btnDefaults').addEventListener('click', function () {
    ui.showDefaults = !ui.showDefaults;
    applyDefaultsVisibility();
    if (ui.showDefaults) $('#step-defaults').open = true;   /* the accordion folds the rest */
    persistUi();
  });

  /* the script pane starts folded; while it is, the editor gets the whole width */
  function applyScriptOpen() {
    var shut = !ui.scriptOpen;
    $('.content').classList.toggle('script-shut', shut);
    $('#step-output').classList.toggle('shut', shut);
    $('#scriptBody').hidden = shut;
    $('#scriptHead').setAttribute('aria-expanded', shut ? 'false' : 'true');
  }

  function toggleScript() {
    ui.scriptOpen = !ui.scriptOpen;
    applyScriptOpen();
    persistUi();
  }

  $('#scriptHead').addEventListener('click', function (ev) {
    if (ev.target.closest('button')) return;           /* copy / download act, they do not fold */
    toggleScript();
  });
  $('#scriptHead').addEventListener('keydown', function (ev) {
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleScript(); }
  });

  /* theme: 'system' follows the OS, 'light' / 'dark' pin it via html[data-theme] */
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    $$('[data-theme-choice]').forEach(function (b) {
      var on = b.getAttribute('data-theme-choice') === theme;
      b.classList.toggle('primary', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  $$('[data-theme-choice]').forEach(function (b) {
    b.addEventListener('click', function () {
      var theme = b.getAttribute('data-theme-choice');
      applyTheme(theme);
      try {
        if (theme === 'system') localStorage.removeItem(STORE_THEME);
        else localStorage.setItem(STORE_THEME, theme);
      } catch (e) { /* storage blocked: applies for this visit only */ }
    });
  });

  applyTheme(currentTheme());

  function setAllProjects(open) {
    $('#step-projects').open = true;
    $$('details.project').forEach(function (d) { d.open = open; });
  }

  $('#btnExpandAll').addEventListener('click', function () { setAllProjects(true); });
  $('#btnCollapseAll').addEventListener('click', function () { setAllProjects(false); });

  /* ---------------------------------------------------------------- */
  /* rendering                                                        */
  /* ---------------------------------------------------------------- */
  function renderGlobals() {
    $$('[data-bind]').forEach(function (el) {
      if (el.closest('.project')) return;
      var key = el.dataset.bind;
      if (!(key in state)) return;
      if (el.type === 'checkbox') el.checked = !!state[key];
      else el.value = state[key] === undefined || state[key] === null ? '' : state[key];
    });
    closingOthers = true;
    $$('details.step').forEach(function (d) { d.open = d.id === ui.activeStep; });
    closingOthers = false;
    applyDefaultsVisibility();
    applyScriptOpen();
  }

  function renderProjects() {
    var host = $('#projects');
    host.innerHTML = '';
    state.projects.forEach(function (p, i) { host.appendChild(buildProjectCard(p, i)); });
  }

  function buildProjectCard(p, index) {
    var node = $('#projectTemplate').content.firstElementChild.cloneNode(true);
    node.dataset.index = index;
    node.open = ui.projects[p.uid] !== false;

    $$('[data-bind]', node).forEach(function (el) {
      if (el.closest('.target')) return;
      var key = el.dataset.bind;
      if (el.type === 'checkbox') el.checked = !!p[key];
      else el.value = p[key] === undefined || p[key] === null ? '' : p[key];
    });

    renderTargets(node, p);
    applyProjectState(node, p);
    return node;
  }

  function renderTargets(card, p) {
    var host = $('.target-list', card);
    host.innerHTML = '';
    (p.targets.length ? p.targets : ['']).forEach(function (target, ti) {
      var row = $('#targetTemplate').content.firstElementChild.cloneNode(true);
      row.dataset.index = ti;
      $('input', row).value = target || '';
      host.appendChild(row);
    });
  }

  function applyProjectState(card, p) {
    var mode = state.useZip ? (p.sourceMode === 'abs' ? 'abs' : 'zip') : 'abs';
    card.dataset.mode = mode;
    card.classList.toggle('disabled', p.enabled === false);

    var sel = $('[data-bind="sourceMode"]', card);
    sel.value = mode;                       /* never shows a zip origin while there is no zip */
    sel.disabled = !state.useZip;

    $('.resolved-path', card).textContent = resolvedSource(p) || '(no origin set)';

    /* header summary */
    var index = +card.dataset.index;
    var targets = (p.targets || []).filter(function (x) { return (x || '').trim(); });
    var keep = BatGenerator.parseKeep(p.keepText).length;
    var bits = [];
    if ((p.pool || '').trim()) bits.push('pool ' + p.pool.trim());
    bits.push(targets.length + (targets.length === 1 ? ' destination' : ' destinations'));
    bits.push(keep + ' protected');
    if (state.backupEnabled && p.backup === false) bits.push('no backup');

    $('.pnum', card).textContent = index + 1;
    $('.pname', card).textContent = (p.name || '').trim() || 'Untitled project';
    $('.pmeta', card).textContent = bits.join('  ·  ');
  }

  function resolvedSource(p) {
    if (!state.useZip || p.sourceMode === 'abs') return (p.sourceAbs || '').trim();
    var root = (state.extractDir || '').trim().replace(/[\\/]+$/, '');
    var sub = (p.sourceSub || '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    return sub ? root + '\\' + sub : root;
  }

  function refreshProjectViews() {
    $$('.project').forEach(function (card) {
      applyProjectState(card, state.projects[+card.dataset.index]);
    });
  }

  /* ---------------------------------------------------------------- */
  /* section headlines                                                */
  /* ---------------------------------------------------------------- */
  function renderSummaries(script) {
    var name = BatGenerator.slug(state.scriptName || state.title) + '.bat';
    $('#sum-package').textContent = state.useZip
      ? ((state.zipSource || '').split(/[\\/]/).pop() || 'no zip chosen') + '  →  ' + (state.extractDir || '?')
      : 'no zip, absolute source folders';

    var flags = [name, state.deployMode === 'sequential' ? 'one at a time' : 'all at a time'];
    if (state.autoElevate) flags.push('auto-elevate');
    if (state.pauseAtEnd) flags.push('pause');
    flags.push(state.logEnabled ? 'logged' : 'no log');
    if (state.useZip) flags.push('unzip with ' + (state.unzipMethod || 'cscript'));
    flags.push(state.backupEnabled
      ? 'backups ' + (state.backupKeep > 0 ? 'keep ' + state.backupKeep : 'keep all')
      : 'backups off');
    $('#sum-defaults').textContent = flags.join('  ·  ');

    var db = [];
    if (state.mssqlEnabled) db.push('SQL Server with ' + (state.mssqlTool || 'sqlcmd'));
    if (state.as400Enabled) db.push('AS400 with ' + (state.as400Tool === 'db2' ? 'db2' : 'ODBC'));
    if (db.length) {
      db.push({ before: 'before IIS stops', stopped: 'while IIS is stopped', after: 'after IIS starts' }[state.sqlWhen]
              || 'before IIS stops');
    }
    $('#sum-database').textContent = db.length ? db.join('  ·  ') : 'off';

    var total = state.projects.length;
    var on = state.projects.filter(function (p) { return p.enabled !== false; }).length;
    $('#sum-projects').textContent = on === total
      ? total + (total === 1 ? ' project' : ' projects')
      : on + ' of ' + total + ' projects included';

    var lines = script.split('\n').length;
    $('#sum-output').textContent = lines + ' lines  ·  ' + name;
  }

  /* the rail's "current script" card: what is open and whether it is kept anywhere */
  function currentLines() {
    var lines = [
      { text: ui.savedName ? 'saved as ' + ui.savedName : 'not saved' },
      { text: libraryMeta(state) }
    ];
    if (ui.dirty) lines.push({ text: 'unsaved changes', cls: 'dirty' });
    return lines;
  }

  function renderCurrent() {
    $('#curName').textContent = (state.title || '').trim() || 'Untitled script';
    var meta = $('#curMeta');
    meta.innerHTML = '';
    currentLines().forEach(function (line) {
      var el = document.createElement('span');
      el.className = line.cls || '';
      el.textContent = line.text;
      meta.appendChild(el);
    });
  }

  function renderWarnings() {
    var issues = BatGenerator.validate(state);
    var card = $('#warningsCard');
    var list = $('#warnings');
    list.innerHTML = '';
    if (!issues.length) { card.hidden = true; return; }
    card.hidden = false;
    issues.forEach(function (issue) {
      var li = document.createElement('li');
      li.className = issue.level;
      li.textContent = issue.message;
      list.appendChild(li);
    });
  }

  function renderOutput() {
    var script = BatGenerator.generate(state);
    $('#output').textContent = script;
    $('#zipTree').textContent = BatGenerator.zipTree(state);
    renderSummaries(script);
    renderCurrent();
    renderWarnings();
  }

  function applyConditionals() {
    show('.cond-zip', state.useZip);
    show('.cond-nozip', !state.useZip);
    show('.cond-backup', state.backupEnabled);
    show('.cond-log', state.logEnabled);
    var sql = state.mssqlEnabled || state.as400Enabled;
    show('.cond-sql', sql);
    show('.cond-nosql', !sql);
    show('.cond-mssql', state.mssqlEnabled);
    show('.cond-mssql-sql', state.mssqlAuth === 'sql');
    show('.cond-as400', state.as400Enabled);
    show('.cond-as400-odbc', state.as400Tool !== 'db2');
    show('.cond-as400-db2', state.as400Tool === 'db2');
  }

  function show(sel, on) {
    $$(sel).forEach(function (el) { el.style.display = on ? '' : 'none'; });
  }

  function renderAll() {
    renderGlobals();
    renderProjects();
    applyConditionals();
    renderOutput();
    persist();
  }

  /* light refresh: no DOM rebuild, so the caret stays where it is */
  function touched() {
    markDirty();
    applyConditionals();
    refreshProjectViews();
    persist();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderOutput, 120);
  }

  /* ---------------------------------------------------------------- */
  /* input binding                                                    */
  /* ---------------------------------------------------------------- */
  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') {
      var n = parseInt(el.value, 10);
      return isNaN(n) ? 0 : n;
    }
    return el.value;
  }

  document.addEventListener('input', onFieldChange);
  document.addEventListener('change', onFieldChange);

  function onFieldChange(ev) {
    var el = ev.target;
    if (!el.dataset || !el.dataset.bind) return;

    var card = el.closest('.project');
    if (!card) {
      state[el.dataset.bind] = readValue(el);
      if (el.dataset.bind === 'useZip') { normalizeSources(); renderProjects(); }
      touched();
      return;
    }

    var project = state.projects[+card.dataset.index];
    var targetRow = el.closest('.target');
    if (targetRow) project.targets[+targetRow.dataset.index] = el.value;
    else project[el.dataset.bind] = readValue(el);
    touched();
  }

  /* ---------------------------------------------------------------- */
  /* project and target actions                                       */
  /* ---------------------------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.project');
    var index = +card.dataset.index;
    var project = state.projects[index];

    switch (btn.dataset.act) {
      case 'del':
        if (state.projects.length === 1) { toast('A script needs at least one project.'); return; }
        if (!confirm('Remove project "' + (project.name || index + 1) + '"?')) return;
        delete ui.projects[project.uid];
        state.projects.splice(index, 1);
        break;
      case 'dup': {
        var copy = JSON.parse(JSON.stringify(project));
        copy.uid = 'p' + (uidSeed++);
        copy.name = (project.name || 'Project') + ' copy';
        state.projects.splice(index + 1, 0, copy);
        break;
      }
      case 'up':
        if (index === 0) return;
        state.projects.splice(index - 1, 0, state.projects.splice(index, 1)[0]);
        break;
      case 'down':
        if (index === state.projects.length - 1) return;
        state.projects.splice(index + 1, 0, state.projects.splice(index, 1)[0]);
        break;
      case 'addTarget':
        project.targets.push('');
        renderTargets(card, project);
        touched();
        return;
      case 'delTarget': {
        var row = ev.target.closest('.target');
        if (project.targets.length === 1) project.targets[0] = '';
        else project.targets.splice(+row.dataset.index, 1);
        renderTargets(card, project);
        touched();
        return;
      }
      default: return;
    }
    markDirty();
    renderProjects();
    renderOutput();
    persist();
  });

  function addProject() {
    var last = state.projects[state.projects.length - 1];
    var p = newProject({
      name: 'Project ' + (state.projects.length + 1),
      sourceMode: state.useZip ? 'zip' : 'abs',
      keepText: last ? last.keepText : Presets.KEEP
    });
    ui.projects[p.uid] = true;
    ui.dirty = true;
    state.projects.push(p);
    $('#step-projects').open = true;
    renderProjects();
    renderOutput();
    persist();
    persistUi();
    var cards = $$('.project');
    var added = cards[cards.length - 1];
    if (added && added.scrollIntoView) added.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  $('#btnAddProject').addEventListener('click', addProject);
  $('#btnAddProjectTop').addEventListener('click', addProject);

  /* ---------------------------------------------------------------- */
  /* output actions                                                   */
  /* ---------------------------------------------------------------- */
  function scriptFileName(cfg) {
    return BatGenerator.slug(cfg.scriptName || cfg.title) + '.bat';
  }

  function downloadScript(cfg) {
    var name = scriptFileName(cfg);
    download(name, BatGenerator.generate(cfg));
    toast('Saved ' + name);
  }

  function copyScript(cfg) {
    var text = BatGenerator.generate(cfg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('Script copied'); },
        function () { legacyCopy(text); });
    } else { legacyCopy(text); }
  }

  $('#btnDownload').addEventListener('click', function () { downloadScript(state); });
  $('#btnCopy').addEventListener('click', function () { copyScript(state); });

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Script copied'); }
    catch (e) { toast('Copy failed — select the text manually.'); }
    document.body.removeChild(ta);
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------------------------------------------------------- */
  /* saved configurations                                             */
  /* ---------------------------------------------------------------- */
  function savedCopy(name) {
    var cfg = savedConfigs()[name];
    return cfg ? JSON.parse(JSON.stringify(cfg)) : null;
  }

  $('#btnSave').addEventListener('click', function () {
    var suggested = ui.savedName || state.scriptName || state.title;
    var name = prompt('Save this configuration as:', suggested);
    if (!name) return;
    var all = savedConfigs();
    all[name] = JSON.parse(JSON.stringify(state));
    writeSaved(all);
    ui.savedName = name;
    markClean();
    renderSaved();
    toast('Saved "' + name + '"');
  });

  function deleteSaved(name) {
    if (!confirm('Delete the saved configuration "' + name + '"?')) return;
    var all = savedConfigs();
    delete all[name];
    writeSaved(all);
    if (ui.savedName === name) {
      ui.savedName = '';
      persistUi();
      renderCurrent();
    }
    renderSaved();
    toast('Deleted "' + name + '"');
  }

  /* ---------------------------------------------------------------- */
  /* import, export, new, presets                                     */
  /* ---------------------------------------------------------------- */
  $('#btnExportJson').addEventListener('click', function () {
    download(BatGenerator.slug(state.scriptName || state.title) + '.json',
      JSON.stringify(state, null, 2));
    markClean();
  });

  function startImport() {
    if (!confirmReplace()) return;
    $('#fileImport').click();
  }

  $('#btnImport').addEventListener('click', startImport);
  $('#libImport').addEventListener('click', startImport);

  $('#fileImport').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        replaceState(JSON.parse(reader.result));
        setView('full');
        toast('Imported ' + file.name);
      } catch (e) {
        toast('That file is not a valid configuration.');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  function startNew() {
    if (!confirmReplace('Start a new empty script? Unsaved changes are lost.')) return;
    replaceState(Presets.list[0].build());
    setView('full');
  }

  $('#btnNew').addEventListener('click', startNew);
  $('#libNew').addEventListener('click', startNew);

  function loadPreset(preset) {
    if (!confirmReplace('Load the preset "' + preset.label + '"? Unsaved changes are lost.')) return;
    replaceState(preset.build());
    setView('full');
  }


  /* ---------------------------------------------------------------- */
  /* views: simple (the library) and full (the editor)                */
  /* ---------------------------------------------------------------- */
  function setView(view) {
    ui.view = view === 'full' ? 'full' : 'simple';
    persistUi();
    applyView();
  }

  function applyView() {
    document.documentElement.setAttribute('data-view', ui.view);
    $$('[data-view-choice]').forEach(function (b) {
      var on = b.getAttribute('data-view-choice') === ui.view;
      b.classList.toggle('primary', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  $$('[data-view-choice]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view-choice')); });
  });

  function libraryMeta(cfg, hint) {
    var count = cfg.projects.length;
    var meta = [scriptFileName(cfg), count + (count === 1 ? ' project' : ' projects')];
    if (hint) meta.unshift(hint);
    return meta.join('  ·  ');
  }

  /* one row of the library: { name, hint, get, onEdit, onDelete } —
     `get` builds a fresh copy of the configuration every time it is called */
  function libraryItem(item) {
    var li = $('#libItemTemplate').content.firstElementChild.cloneNode(true);
    $('.lib-name', li).textContent = item.name;
    $('.lib-meta', li).textContent = libraryMeta(migrate(item.get()), item.hint);
    $('[data-lib="edit"]', li).addEventListener('click', item.onEdit);
    $('[data-lib="copy"]', li).addEventListener('click', function () { copyScript(migrate(item.get())); });
    $('[data-lib="download"]', li).addEventListener('click', function () { downloadScript(migrate(item.get())); });
    var del = $('[data-lib="delete"]', li);
    if (item.onDelete) del.addEventListener('click', item.onDelete);
    else del.remove();
    return li;
  }

  /* the blank preset is what New does, so the list keeps the real starting points */
  function renderLibraryPresets() {
    var host = $('#libPresets');
    host.innerHTML = '';
    Presets.list.forEach(function (preset) {
      if (preset.id === 'blank') return;
      host.appendChild(libraryItem({
        name: preset.label, hint: preset.hint, get: preset.build,
        onEdit: function () { loadPreset(preset); }
      }));
    });
  }

  function openSaved(name) {
    if (!confirmReplace('Open "' + name + '"? Unsaved changes are lost.')) return;
    replaceState(savedCopy(name), name);
    setView('full');
    toast('Loaded "' + name + '"');
  }

  function renderLibrarySaved() {
    var host = $('#libSaved');
    var names = Object.keys(savedConfigs()).sort();
    host.innerHTML = '';
    names.forEach(function (name) {
      host.appendChild(libraryItem({
        name: name,
        get: function () { return savedCopy(name); },
        onEdit: function () { openSaved(name); },
        onDelete: function () { deleteSaved(name); }
      }));
    });
    $('#libSavedEmpty').hidden = names.length > 0;
  }

  /* ---------------------------------------------------------------- */
  /* the full view's rail: the same lists, as compact clickable rows  */
  /* ---------------------------------------------------------------- */
  /* a whole row acts as a button: click anywhere but its own buttons, or Enter / Space on it */
  function onActivate(row, fn) {
    row.addEventListener('click', function (ev) { if (!ev.target.closest('button')) fn(); });
    row.addEventListener('keydown', function (ev) {
      if (ev.target !== row || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      fn();
    });
  }

  /* { name, meta, active, onOpen, onDelete } */
  function sideItem(item) {
    var li = $('#sideItemTemplate').content.firstElementChild.cloneNode(true);
    $('.lib-name', li).textContent = item.name;
    $('.lib-meta', li).textContent = item.meta;
    li.title = item.name;
    li.classList.toggle('active', !!item.active);
    onActivate(li, item.onOpen);
    var del = $('[data-side="delete"]', li);
    if (item.onDelete) del.addEventListener('click', item.onDelete);
    else del.remove();
    return li;
  }

  function renderSidePresets() {
    var host = $('#sidePresets');
    host.innerHTML = '';
    Presets.list.forEach(function (preset) {
      if (preset.id === 'blank') return;
      host.appendChild(sideItem({
        name: preset.label, meta: libraryMeta(migrate(preset.build())),
        onOpen: function () { loadPreset(preset); }
      }));
    });
  }

  function renderSideSaved(names) {
    var host = $('#sideSaved');
    host.innerHTML = '';
    names.forEach(function (name) {
      host.appendChild(sideItem({
        name: name, meta: libraryMeta(migrate(savedCopy(name))), active: name === ui.savedName,
        onOpen: function () { openSaved(name); },
        onDelete: function () { deleteSaved(name); }
      }));
    });
    $('#sideSavedEmpty').hidden = names.length > 0;
  }

  /* both lists of saved configurations, the library's and the rail's */
  function renderSaved() {
    renderLibrarySaved();
    renderSideSaved(Object.keys(savedConfigs()).sort());
  }

  /* ---------------------------------------------------------------- */
  /* toast                                                            */
  /* ---------------------------------------------------------------- */
  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* ---------------------------------------------------------------- */
  renderLibraryPresets();
  renderSidePresets();
  renderSaved();
  renderAll();
  applyView();

})();
