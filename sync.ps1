<#
.SYNOPSIS
Safely sync the screen-qa-extension repository, scan for secrets, and commit with smart conventional messaging.

.DESCRIPTION
Pulls the latest changes from origin with rebase and autostash, scans staged changes for accidental credentials/tokens,
generates conventional commit messages based on modified components, and pushes to remote.
#>

[CmdletBinding()]
param (
    [Alias("m")]
    [string]$Message,

    [switch]$PullOnly,

    [switch]$NoPush,

    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Status {
    param(
        [string]$Message,
        [System.ConsoleColor]$Color = [System.ConsoleColor]::Cyan
    )
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $Message" -ForegroundColor $Color
}

function Write-Notice {
    param([string]$Message)
    Write-Status -Message $Message -Color ([System.ConsoleColor]::Yellow)
}

function Write-Success {
    param([string]$Message)
    Write-Status -Message $Message -Color ([System.ConsoleColor]::Green)
}

function Find-StagedSecrets {
    $stagedDiff = git diff --cached -U0 2>$null
    if (-not $stagedDiff) { return @() }

    $addedLines = $stagedDiff | Where-Object { $_ -match '^\+[^+]' } | ForEach-Object { $_.Substring(1) }
    if (-not $addedLines) { return @() }

    $secretPatterns = @(
        'AKIA[0-9A-Z]{16}'
        'sk-[a-zA-Z0-9]{20,}'
        'sk-ant-[a-zA-Z0-9\-]{20,}'
        'ghp_[a-zA-Z0-9]{36}'
        'github_pat_[a-zA-Z0-9_]{20,}'
        'AIza[0-9A-Za-z\-_]{35}'
        'xox[baprs]-[0-9a-zA-Z\-]{10,}'
        '-----BEGIN (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY-----'
        '(?i)(api[_-]?key|secret|password|token|passwd)\s*[:=]\s*[''"][^''"\s]{8,}[''"]'
    )

    $hits = @()
    foreach ($line in $addedLines) {
        foreach ($pattern in $secretPatterns) {
            if ($line -match $pattern) {
                $snippet = $line.Trim()
                $hits += [PSCustomObject]@{
                    Pattern = $pattern
                    Snippet = $snippet.Substring(0, [Math]::Min(60, $snippet.Length))
                }
                break
            }
        }
    }

    return @($hits)
}

function Get-ExtensionScope {
    param([string[]]$ChangedFiles)

    if ($ChangedFiles | Where-Object { $_ -match 'background\.js' }) { return "background" }
    if ($ChangedFiles | Where-Object { $_ -match 'content\.js|overlay\.css' }) { return "content" }
    if ($ChangedFiles | Where-Object { $_ -match 'options\.' }) { return "options" }
    if ($ChangedFiles | Where-Object { $_ -match 'manifest\.json' }) { return "manifest" }
    if ($ChangedFiles | Where-Object { $_ -match 'icons/' }) { return "icons" }
    if ($ChangedFiles | Where-Object { $_ -match 'README\.md|AGENTS\.md|LICENSE' }) { return "docs" }
    if ($ChangedFiles | Where-Object { $_ -match 'sync\.ps1|\.gitignore' }) { return "config" }
    return "general"
}

function Get-AutoCommitMessage {
    $statusLines = git status --porcelain
    if (-not $statusLines) { return $null }

    $modifiedFiles = @()
    $addedFiles = @()
    $deletedFiles = @()
    $allRelativePaths = @()

    foreach ($line in $statusLines) {
        $status = $line.Substring(0, 2).Trim()
        $file = $line.Substring(3).Trim()
        $fileName = Split-Path $file -Leaf
        $allRelativePaths += $file

        if ($status -match 'A|\?\?') { $addedFiles += $fileName }
        elseif ($status -match 'D') { $deletedFiles += $fileName }
        else { $modifiedFiles += $fileName }
    }

    $allChanged = @($addedFiles + $modifiedFiles + $deletedFiles)
    if (@($allChanged).Count -eq 0) { return $null }

    $scope = Get-ExtensionScope -ChangedFiles $allRelativePaths
    $type = "chore"

    if (@($addedFiles).Count -gt 0) {
        $type = "feat"
    }
    elseif ($scope -eq "docs") {
        $type = "docs"
    }
    elseif ($modifiedFiles | Where-Object { $_ -match '\.js$' }) {
        $type = "refactor"
    }

    $prefix = if ($scope -ne "general") { "${type}(${scope})" } else { "${type}" }

    $summary = ""
    if ($allChanged.Count -le 3) {
        $summary = $allChanged -join ", "
    }
    else {
        $firstTwo = ($allChanged[0..1]) -join ", "
        $extraCount = $allChanged.Count - 2
        $summary = "$firstTwo +$extraCount more"
    }

    $rawDiff = git diff --cached -U0 2>$null
    $diffStat = git diff --cached --shortstat 2>$null
    $churn = ""
    if ($diffStat -match '(\d+) insertion') { $ins = $Matches[1] } else { $ins = 0 }
    if ($diffStat -match '(\d+) deletion') { $del = $Matches[1] } else { $del = 0 }
    if (($ins + 0) -gt 0 -or ($del + 0) -gt 0) { $churn = " (+$ins/-$del)" }

    return "${prefix}: update ${summary}${churn}"
}

$RepoPath = $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoPath '.git'))) {
    Write-Error "Not a git repository: $RepoPath"
    exit 1
}

Push-Location $RepoPath
try {
    $currentBranch = (git branch --show-current 2>$null)
    if ($currentBranch) { $currentBranch = $currentBranch.Trim() }
    if (-not $currentBranch) { $currentBranch = "main" }

    $hasOrigin = $false
    try {
        git remote get-url origin *> $null
        $hasOrigin = $true
    }
    catch {
        $hasOrigin = $false
    }

    Write-Status -Message "Screen Q&A Repository: $RepoPath"
    Write-Status -Message "Active Branch: $currentBranch"

    # 1. Pull latest changes if remote origin exists
    if ($hasOrigin) {
        Write-Status -Message "Pulling latest changes from origin/$currentBranch..."
        git pull --rebase --autostash origin $currentBranch
    }
    else {
        Write-Notice -Message "No 'origin' remote configured; skipping pull step."
    }

    if ($PullOnly) {
        Write-Success -Message "Pull complete. No commit was made because -PullOnly was set."
        exit 0
    }

    # 2. Stage changes
    Write-Status -Message "Staging changes..."
    git add -A

    git diff --cached --quiet 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success -Message "Working directory clean. Nothing to commit."
        exit 0
    }

    # 3. Secret detection scan
    $secretHits = Find-StagedSecrets
    if (@($secretHits).Count -gt 0) {
        Write-Error "Possible secrets or credentials detected in staged changes! Commit aborted."
        foreach ($hit in @($secretHits)) {
            Write-Host "    Pattern: $($hit.Pattern)" -ForegroundColor Yellow
            Write-Host "    Line   : $($hit.Snippet)..." -ForegroundColor Gray
        }
        Write-Notice -Message "Unstage or remove the secrets before re-running sync."
        git reset
        exit 1
    }

    # 4. Commit message determination
    if (-not $Message) {
        $Message = Get-AutoCommitMessage
        if ($Message) {
            Write-Notice -Message "Auto-generated commit message: '$Message'"
        }
    }

    if ($WhatIf) {
        Write-Host "[WhatIf] Changes would be committed with message: $Message" -ForegroundColor Magenta
        exit 0
    }

    if ($Message) {
        Write-Status -Message "Committing: '$Message'..."
        git commit -m "$Message"

        # 5. Push to remote
        if ($hasOrigin -and -not $NoPush) {
            Write-Status -Message "Pushing to origin/$currentBranch..."
            git push origin $currentBranch
            if ($LASTEXITCODE -ne 0) {
                Write-Notice -Message "Push rejected. Pulling with rebase and retrying push..."
                git pull --rebase --autostash origin $currentBranch
                git push origin $currentBranch
            }
        }
        elseif ($NoPush) {
            Write-Notice -Message "Commit created locally; push skipped due to -NoPush."
        }
        else {
            Write-Notice -Message "Commit created locally, but no 'origin' remote is configured."
        }

        Write-Success -Message "Screen Q&A repository synced successfully."
    }
    else {
        Write-Success -Message "No changes to commit."
    }
}
finally {
    Pop-Location
}
