<#
.SYNOPSIS
  Publishes the IIS Publish Helper to Azure Static Web Apps (Free plan), behind a Microsoft login.

.DESCRIPTION
  Creates the resource group and the Static Web App when they do not exist yet, stages only the
  app files and presets plus azure\staticwebapp.config.json and azure\403.html, and deploys them with the
  Static Web Apps CLI. Safe to run again for every update.

  Only accounts that were invited get in (role "deployer"). Pass -Invite to send invitations;
  each one prints a link that the person opens once while signed in with that account.

  Needs: az CLI (logged in with az login) and Node.js (for npx).

.EXAMPLE
  .\deploy-azure.ps1

.EXAMPLE
  .\deploy-azure.ps1 -Invite r.uribe@acts-curacao.com, colleague@acts-curacao.com
#>
param(
  [string]   $Name          = 'publish-helper',
  [string]   $ResourceGroup = 'rg-publish-helper',
  [string]   $Location      = 'eastus2',
  [string[]] $Invite        = @(),
  [int]      $InviteHours   = 168
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Invoke-Az {
  $out = & az @args
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit $LASTEXITCODE)" }
  $out
}

foreach ($tool in 'az', 'npx') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool was not found on PATH." }
}

$account = Invoke-Az account show --query '{name:name, user:user.name}' -o tsv
Write-Host "Subscription / user: $account"

# ---------- resource group and app ----------
if ((Invoke-Az group exists -n $ResourceGroup) -ne 'true') {
  Write-Host "Creating resource group $ResourceGroup ..."
  Invoke-Az group create -n $ResourceGroup -l $Location -o none
}

$existing = Invoke-Az staticwebapp list -g $ResourceGroup --query "[?name=='$Name'].name" -o tsv
if (-not $existing) {
  Write-Host "Creating Static Web App $Name (Free) ..."
  Invoke-Az staticwebapp create -n $Name -g $ResourceGroup -l $Location --sku Free -o none
}

$hostname = Invoke-Az staticwebapp show -n $Name -g $ResourceGroup --query defaultHostname -o tsv

# ---------- stage only what the site needs ----------
$stage = Join-Path $env:TEMP "publish-helper-swa"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
Copy-Item (Join-Path $root 'index.html') $stage
Copy-Item (Join-Path $root 'css') $stage -Recurse
Copy-Item (Join-Path $root 'js')  $stage -Recurse
Copy-Item (Join-Path $root 'presets') $stage -Recurse
Copy-Item (Join-Path $root 'azure\staticwebapp.config.json') $stage
Copy-Item (Join-Path $root 'azure\403.html') $stage

# ---------- deploy ----------
$token = Invoke-Az staticwebapp secrets list -n $Name -g $ResourceGroup --query properties.apiKey -o tsv
Write-Host "Deploying ..."
& npx --yes @azure/static-web-apps-cli deploy $stage --deployment-token $token --env production
if ($LASTEXITCODE -ne 0) { throw "Deployment failed (exit $LASTEXITCODE)" }
Remove-Item $stage -Recurse -Force

# ---------- invitations ----------
foreach ($user in $Invite) {
  $link = Invoke-Az staticwebapp users invite -n $Name -g $ResourceGroup `
    --authentication-provider AAD --user-details $user --roles deployer `
    --domain $hostname --invitation-expiration-in-hours $InviteHours `
    --query invitationUrl -o tsv
  Write-Host "Invitation for ${user}: $link"
}

Write-Host ""
Write-Host "Live at https://$hostname"
