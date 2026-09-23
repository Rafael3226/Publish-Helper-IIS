# IIS Publish Helper

A small web app that builds Windows deployment scripts for IIS. Fill in the projects, get a
self-contained `.bat` file that stops the application pool, backs up the current files, replaces
them while protecting the configuration files, and starts the pool again.

## Running it

Open `index.html` in a browser. There is no build step, no server and no dependencies — plain
HTML, CSS and JavaScript loaded straight from disk.

The page is a stack of full-width steps — release package, projects, generated script —
worked through one at a time: opening a step folds the previous one away, and clicking the open
step closes it. A folded step still shows its headline, so the whole configuration stays readable
at a glance: the zip and where it is unpacked, how many projects are included,
how long the script is. The step you were last in is remembered for the next visit.

Everything that rarely changes lives behind the **Defaults** button in the toolbar: the deployment
order, auto-elevate, pause at the end and log writing, the file name, the title shown while running, the wait after
stopping a pool, the log folder, and the whole backup and working-folder block. It is an ordinary part of the configuration — saved and exported with the
rest — just kept out of the way until asked for, and it stays visible once opened.

Projects inside step 2 are the exception — they fold independently, so several can be compared
side by side, with **Expand** / **Collapse** in the step header acting on all of them at once.
Each project card shows its pool, destination count and number of protected files while closed.

Configurations are kept in the browser's local storage. Use **Save** to name and keep several of
them, and **Export JSON** / **Import JSON** to share one with a colleague or commit it next to the
script it produces.

## What the app produces

One `.bat` file per script, holding as many projects as needed. Every project has its own origin,
its own destinations, its own pool and — importantly — **its own do-not-replace list**. Adding a
project copies the previous project's list as a starting point, and from then on the two are
independent.

The whole configuration sits in one block at the top of the generated file, so a path can be
corrected on the server without touching the logic below it.

```batch
REM ---------- Projects ----------
set "PROJECT_COUNT=2"

REM --- Project 1: MPSAPI ---
set "P1_NAME=MPSAPI"
set "P1_SOURCE=%EXTRACT_DIR%\ACTFMS_API"
set "P1_POOL=MPSAPI"
set "P1_SITE=MPSAPI"
set "P1_BACKUP=1"
set "P1_TARGETS=1"
set "P1_TARGET1=C:\Team ACTFMS\Web services\MPSAPI"
set "P1_KEEP=3"
set "P1_KEEP1=appsettings.json"
set "P1_KEEP2=appsettings.Development.json"
set "P1_KEEP3=web.config"
```

## What the generated script does

| Step | Action |
|------|--------|
| 1 | Extracts the zip, straight from wherever it is, with the configured unpack method |
| 2 | Writes one exclude list per project into the working folder |
| 3 | Stops the application pool, and the site when one is configured |
| 4 | Copies each destination to `<backup root>\<timestamp>\<project>\<folder>` with `robocopy` |
| 5 | Copies the new files with `xcopy /E /Y /I /Q /EXCLUDE:` |
| 6 | Starts the pool and the site again |

Two orders are available:

- **All projects at a time** — stop all, back up all, copy all, start all: the whole set goes
  down together. This is what the existing hand-written scripts do, and the right choice when
  the applications share files or call each other during start-up.
- **One project at a time** — each project is down only for its own copy.

Extra behaviour worth knowing:

- **Exit code** is the number of errors, `0` when everything worked. A failed unzip aborts before
  anything on the server is touched, and exits `1`.
- **Logging** re-runs the script once, piped through `Tee-Object`, so the full console output is
  both on screen and in `<log folder>\<script>_<timestamp>.log`.
- **Backup retention** removes older backup runs when a number is set. `0` keeps everything.
- **Auto-elevate** re-launches the script through UAC when it was not started as Administrator.

The zip is read from wherever it is configured, with no intermediate local copy. An elevated
session does not always carry credentials for a UNC share, so a zip on a share is flagged as a
warning — point the zip at a local copy if the extract step fails on your server.

**How the zip is unpacked** is chosen under Defaults:

- `cscript` (default) — a small VBScript written next to the exclude lists at run time, which
  unpacks through `Shell.Application`. Windows Script Host is present on every Windows version,
  which is why this is the default. It copies in the background, so the script waits for the
  extract folder to stop growing before it moves on.
- `tar` — one call to the `tar` that ships with Windows 10 1803 / Server 2019 and newer. Older
  servers do not have it: run `where tar` before choosing this.
- `7zip` — `7z.exe x`. The path lives in `SEVENZIP_EXE` in the generated script.

## Do-not-replace lists

Entries are matched by `xcopy` against the full source path, so `web.config` also protects
`sub\web.config`. Listed files are never copied, which means a file that does not exist in the
destination yet will not be created there either — the same behaviour as the existing scripts.
The first deployment of a new site therefore needs its `appsettings.json` placed by hand.

The lists are written by the script itself at run time, so the `.bat` file needs no companion
files. That is why the exclude folder **must not contain spaces**: `xcopy /EXCLUDE:` does not
accept a quoted path. The app flags this.

## Presets

The Presets menu contains starting points taken from the scripts already in use — ACTFMS,
Di-Card (plus its FAT environment) and the ACTPOL Gateway — so a new script can usually be built by editing one of them.

## Layout

```
index.html        the page
css/styles.css    styling
js/presets.js     defaults and the starting points
js/generator.js   configuration  ->  .bat, plus the validation rules
js/app.js         form state, rendering and local storage
```
