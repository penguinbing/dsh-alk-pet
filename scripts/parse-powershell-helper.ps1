# Parse native/windows/pet.ps1 with the PowerShell parser (Windows PowerShell
# 5.1 and PowerShell 7 share this parser) and fail on syntax errors.
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '..\native\windows\pet.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    [Console]::Error.WriteLine('missing script: ' + $scriptPath)
    exit 1
}
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $scriptPath).Path, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    foreach ($error in $errors) {
        [Console]::Error.WriteLine(('{0}:{1} {2}' -f $error.Extent.StartLineNumber, $error.Extent.StartColumnNumber, $error.Message))
    }
    exit 1
}
exit 0
