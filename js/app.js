/* ------------------------------------------------------------------
 * app.js - form state, rendering, collapse state and persistence
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var STORE_CURRENT = 'iis-publish-helper.current';
  var STORE_SAVED = 'iis-publish-helper.saved';
  var STORE_UI = 'iis-publish-helper.ui';

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

  function loadUi() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_UI) || '{}');
      /* the script is its own always-open column now, never the accordion's active step */
      if (raw.activeStep === 'step-output') raw.activeStep = 'step-settings';
      return {
        activeStep: raw.activeStep === undefined ? 'step-settings' : raw.activeStep,
        showDefaults: !!raw.showDefaults,
        projects: raw.projects || {}
      };
    } catch (e) { return { activeStep: 'step-settings', showDefaults: false, projects: {} }; }
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
    var flags = [state.deployMode === 'sequential' ? 'one project at a time' : 'all together'];
    if (state.autoElevate) flags.push('auto-elevate');
    if (state.pauseAtEnd) flags.push('pause');
    flags.push(state.logEnabled ? 'logged' : 'no log');
    $('#sum-settings').textContent = flags.join('  ·  ');

    $('#sum-package').textContent = state.useZip
      ? ((state.zipSource || '').split(/[\\/]/).pop() || 'no zip chosen') + '  →  ' + (state.extractDir || '?')
      : 'no zip, absolute source folders';

    $('#sum-defaults').textContent = [
      name,
      state.backupEnabled
        ? 'backups ' + (state.backupKeep > 0 ? 'keep ' + state.backupKeep : 'keep all')
        : 'backups off'
    ].join('  ·  ');

    var total = state.projects.length;
    var on = state.projects.filter(function (p) { return p.enabled !== false; }).length;
    $('#sum-projects').textContent = on === total
      ? total + (total === 1 ? ' project' : ' projects')
      : on + ' of ' + total + ' projects included';

    var lines = script.split('\n').length;
    $('#sum-output').textContent = lines + ' lines  ·  ' + name;
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
    renderWarnings();
  }

  function applyConditionals() {
    show('.cond-zip', state.useZip);
    show('.cond-nozip', !state.useZip);
    show('.cond-backup', state.backupEnabled);
    show('.cond-log', state.logEnabled);
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
  $('#btnDownload').addEventListener('click', function () {
    var name = BatGenerator.slug(state.scriptName || state.title) + '.bat';
    download(name, BatGenerator.generate(state));
    toast('Saved ' + name);
  });

  $('#btnCopy').addEventListener('click', function () {
    var text = BatGenerator.generate(state);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('Script copied'); },
        function () { legacyCopy(text); });
    } else { legacyCopy(text); }
  });

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
  function renderSavedList(selected) {
    var sel = $('#savedSelect');
    var all = savedConfigs();
    sel.innerHTML = '<option value="">— saved configurations —</option>';
    Object.keys(all).sort().forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.value = selected || '';
  }

  $('#savedSelect').addEventListener('change', function () {
    var name = this.value;
    if (!name) return;
    var all = savedConfigs();
    if (!all[name]) return;
    state = migrate(JSON.parse(JSON.stringify(all[name])));
    renderAll();
    toast('Loaded "' + name + '"');
  });

  $('#btnSave').addEventListener('click', function () {
    var suggested = $('#savedSelect').value || state.scriptName || state.title;
    var name = prompt('Save this configuration as:', suggested);
    if (!name) return;
    var all = savedConfigs();
    all[name] = JSON.parse(JSON.stringify(state));
    writeSaved(all);
    renderSavedList(name);
    toast('Saved "' + name + '"');
  });

  $('#btnDelete').addEventListener('click', function () {
    var name = $('#savedSelect').value;
    if (!name) { toast('Pick a saved configuration first.'); return; }
    if (!confirm('Delete the saved configuration "' + name + '"?')) return;
    var all = savedConfigs();
    delete all[name];
    writeSaved(all);
    renderSavedList('');
    toast('Deleted "' + name + '"');
  });

  /* ---------------------------------------------------------------- */
  /* import, export, new, presets                                     */
  /* ---------------------------------------------------------------- */
  $('#btnExportJson').addEventListener('click', function () {
    download(BatGenerator.slug(state.scriptName || state.title) + '.json',
      JSON.stringify(state, null, 2));
  });

  $('#btnImport').addEventListener('click', function () { $('#fileImport').click(); });

  $('#fileImport').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state = migrate(JSON.parse(reader.result));
        renderAll();
        toast('Imported ' + file.name);
      } catch (e) {
        toast('That file is not a valid configuration.');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  $('#btnNew').addEventListener('click', function () {
    if (!confirm('Start a new empty script? Unsaved changes are lost.')) return;
    state = migrate(Presets.list[0].build());
    $('#savedSelect').value = '';
    renderAll();
  });

  var menu = $('#presetMenu');
  Presets.list.forEach(function (preset) {
    var b = document.createElement('button');
    b.appendChild(document.createTextNode(preset.label));
    var hint = document.createElement('span');
    hint.className = 'menu-hint';
    hint.textContent = preset.hint;
    b.appendChild(hint);
    b.addEventListener('click', function () {
      menu.hidden = true;
      if (!confirm('Load the preset "' + preset.label + '"? Unsaved changes are lost.')) return;
      state = migrate(preset.build());
      $('#savedSelect').value = '';
      renderAll();
    });
    menu.appendChild(b);
  });

  $('#btnPreset').addEventListener('click', function (ev) {
    ev.stopPropagation();
    var rect = this.getBoundingClientRect();          /* the menu is fixed, so no scroll offset */
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = Math.max(8, rect.left - 60) + 'px';
    menu.hidden = !menu.hidden;
  });

  document.addEventListener('click', function () { menu.hidden = true; });

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
  renderSavedList('');
  renderAll();

})();
