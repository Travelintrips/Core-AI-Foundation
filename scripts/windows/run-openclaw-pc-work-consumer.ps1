# Launch the PC work consumer using the existing local AI Core credential file.
# This script must remain local to the authenticated Windows user account.
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $env:USERPROFILE 'aicore-worker-bootstrap\ai-workers.env'
$values = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^([A-Za-z_][A-Za-z_0-9]*)=(.*)$') {
        $values[$matches[1]] = $matches[2].Trim('"', "'")
    }
}
if (-not $values['AI_CORE_BASE_URL'] -or -not $values['AI_CORE_SCOPED_AGENT_TOKEN']) {
    throw 'AI Core PC worker configuration missing'
}
$env:AI_CORE_BASE_URL = $values['AI_CORE_BASE_URL']
$env:AI_CORE_SCOPED_AGENT_TOKEN = $values['AI_CORE_SCOPED_AGENT_TOKEN']
$script = Join-Path $env:LOCALAPPDATA 'AI-Core\openclaw-pc-work-consumer.py'
while ($true) {
    & python $script
    Start-Sleep -Seconds 15
}
