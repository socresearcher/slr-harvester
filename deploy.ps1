<#
  deploy.ps1 — manually commit and push the repo to GitHub.

  Usage:
    .\deploy.ps1                          # review changes, confirm, commit with an
                                           # auto-generated message, then push
    .\deploy.ps1 -Message "Fix search bug"
    .\deploy.ps1 -Force                   # skip the confirmation prompt

  Pushing to origin/main is enough to deploy the web app: the GitHub Actions
  workflow at .github/workflows/deploy-pages.yml automatically republishes
  slr-harvester-web/ to GitHub Pages on every push to main that touches it.
#>

param(
  [string]$Message,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Output "== SLR Harvester deploy =="
Write-Output "Repo: $repoRoot"

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
  throw "Not a git repository: $repoRoot"
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Output "Branch: $branch"
Write-Output ""

Write-Output "Fetching origin..."
git fetch origin --quiet

$status = git status --short
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Output "Nothing to commit - working tree is clean."
} else {
  Write-Output "Changes to be committed:"
  Write-Output $status
  Write-Output ""

  if (-not $Force) {
    $confirm = Read-Host "Stage and commit all of the above? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
      Write-Output "Aborted - nothing committed or pushed."
      exit 0
    }
  }

  git add -A

  if (-not $Message) {
    $Message = "Deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  }

  git commit -m $Message
  Write-Output ""
}

$ahead = (git rev-list --count "origin/$branch..$branch" 2>$null)
if ([string]::IsNullOrWhiteSpace($ahead) -or $ahead -eq '0') {
  Write-Output "Already up to date with origin/$branch - nothing to push."
  exit 0
}

Write-Output "Pushing $ahead commit(s) to origin/$branch..."
git push origin $branch

Write-Output ""
Write-Output "Done. If slr-harvester-web/** changed, GitHub Pages will redeploy automatically."
