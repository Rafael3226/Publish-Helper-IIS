# IIS Publish Helper

A small web app that builds Windows deployment scripts for IIS. Fill in the projects, get a
self-contained `.bat` file that stops the application pool, backs up the current files, replaces
them while protecting the configuration files, and starts the pool again.

## Running it

Serve the folder over http and open `index.html` — from IIS (see [Hosting in IIS](#hosting-in-iis)),
or locally with any static server, for example `npx serve .` or VS Code's Live Server. There is no
build step and there are no dependencies — plain HTML, CSS and JavaScript.

Opening `index.html` straight from disk still works, but without the presets: browsers do not let a
`file://` page read other files, so the Presets lists say so instead.

The **Simple** / **Full** switch in the top bar picks between two views. **Simple**, the default,
is a short list: the presets, then **Import** and **New**, then the saved configurations. Each
entry can be opened for editing, or have its `.bat` copied or downloaded straight away without
opening it. **Edit**, Import and New all move on to the full view. Loading something over a script
with unsaved changes asks first. The view you were last in is remembered.

In the **Full** view, the page is a stack of full-width steps — release package, projects, database scripts, generated script —
worked through one at a time: opening a step folds the previous one away, and clicking the open
step closes it. A folded step still shows its headline, so the whole configuration stays readable
at a glance: the zip and where it is unpacked, how many projects are included,
how long the script is. The step you were last in is remembered for the next visit.

Everything that rarely changes lives behind the **Defaults** button in the rail: the deployment
order, auto-elevate, pause at the end and log writing, the file name, the title shown while running, the wait after
stopping a pool, the log folder, and the whole backup and working-folder block. It is an ordinary part of the configuration — saved and exported with the
rest — just kept out of the way until asked for, and it stays visible once opened.

Projects inside step 2 are the exception — they fold independently, so several can be compared
side by side, with **Expand** / **Collapse** in the step header acting on all of them at once.
Each project card shows its pool, destination count and number of protected files while closed.

The rail on the left is built from the same parts as the simple view. **Current script** at the top
shows what is open, whether it was saved and whether it has unsaved changes, with **Save** and
**Export** next to it. Below that come the **Presets**, **Import** / **New** and the saved
**Configurations**. Clicking a row opens it, and the configuration currently open is highlighted.
**View** at the bottom holds the **Defaults** toggle and the theme switch.

Configurations are kept in the browser's local storage. Use **Save** to name and keep several of
them, and **Export** / **Import** to share one as JSON with a colleague or commit it next to the
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

## Database scripts

Step 3 runs SQL scripts as part of the deployment. It is optional: **SQL Server** and **AS400**
each have their own switch, and with both off the generated script has no database code at all.

| Engine | Tools |
|--------|-------|
| SQL Server | `sqlcmd` (default), or `Invoke-Sqlcmd` from the PowerShell SqlServer module. Windows authentication or a SQL login. |
| AS400 (Db2 for i) | The IBM i Access ODBC Driver through PowerShell (default), or the Db2 command line processor `db2` with a catalogued database alias. |

- **Which scripts** — a folder plus an optional list, run in the listed order. An empty list runs
  every `*.sql` in the folder by name, so `01_…`, `02_…` naming is enough. A relative folder is
  read from inside the zip, like a project origin.
- **When** — before IIS is stopped (the default), while IIS is stopped (all-at-a-time order only;
  one-at-a-time falls back to before), or after IIS is started again.
- **Failures** — after a failed script the rest of that database's list is skipped. With
  *A failed script stops the deployment* on, *before* aborts without touching IIS, *while stopped*
  keeps the current files and starts IIS again, and *after* can only count the error. Statements
  that already ran are not rolled back.
- **Passwords** — leave the password empty and the script asks for it once, hidden, before the
  log starts. A password that is filled in is written into the `.bat` in plain text, kept in
  browser storage and in exports — the app flags it. A `!` in a typed password is lost to cmd's
  delayed expansion.
- The ODBC runner splits a file on a `;` at the end of a line and skips `--` comment lines — the
  shape ACS *Run SQL Scripts* saves. Like the unzip helper, it is written next to the exclude lists
  at run time and removed after a clean run.

## Presets

The Presets lists contain starting points taken from the scripts already in use — ACTFMS,
Di-Card (plus its FAT environment) and the ACTPOL Gateway — so a new script can usually be built by editing one of them.

They are loaded from `presets/` every time the page opens. Each file is a configuration in the
same shape **Export** writes, and `presets/index.json` lists them in display order — a browser cannot
list a folder, so a file only shows up once it is named there:

```json
[
  { "file": "actfms.json", "label": "ACTFMS (API + Web, two pools each)", "hint": "From deploy-fms.bat" }
]
```

To add one: build the script in the app, **Export** it, copy the file into `presets/` and add a line
to `index.json`. Fields a file leaves out are filled in from the defaults in `js/presets.js`, so
hand-written presets can stay short. A file that cannot be read is left out and named under the list.

## Hosting in IIS

Copy `index.html`, `web.config`, `css`, `js` and `presets` to a folder on the server and point a
site, application or virtual directory at it. Nothing runs on the server, so any application pool
will do; a dedicated one can be set to *No Managed Code*. `web.config` only adds the `.json` file
type, which IIS 8.5 and older do not serve on their own.

## Hosting on Azure

`deploy-azure.ps1` publishes the app to Azure Static Web Apps on the Free plan. It creates the
resource group and the app on the first run, and on every run deploys only `index.html`, `css`,
`js`, `presets` and the two files in `azure\`. It needs the az CLI (after `az login`) and Node.js.

```powershell
.\deploy-azure.ps1                                  # deploy or update
.\deploy-azure.ps1 -Invite someone@acts-curacao.com # deploy and invite
```

The site sits behind a Microsoft login, and only invited accounts get in (role `deployer`). Each
invitation prints a link that the person opens once, signed in with that account; the link expires
after `-InviteHours` (a week by default). Anyone else who signs in sees `azure\403.html`. The
routing rules are in `azure\staticwebapp.config.json`.

Configurations stay in each browser's local storage, which is tied to the address the page is
opened from — export them from a local copy and import them on the hosted one.

## Layout

```
index.html        the page
css/styles.css    styling
js/presets.js     defaults, and the loader for presets/
presets/          the starting points, one exported configuration each, plus index.json
js/generator.js   configuration  ->  .bat, plus the validation rules
js/app.js         form state, rendering and local storage
web.config        lets older IIS serve .json
azure/            Static Web Apps login rules and the no-access page
deploy-azure.ps1  publishes to Azure Static Web Apps
```
