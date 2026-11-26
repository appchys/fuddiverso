param(
  [string]$Project = "multitienda-69778",
  [string]$Zone = "us-central1-a",
  [string]$Instance = "fuddi-whatsapp-worker"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$BundleDir = Join-Path $env:TEMP "fuddi-whatsapp-worker-bundle"
$ArchivePath = Join-Path $env:TEMP "fuddi-whatsapp-worker.tar.gz"

if (Test-Path $BundleDir) { Remove-Item -Recurse -Force $BundleDir }
New-Item -ItemType Directory -Path (Join-Path $BundleDir "src\lib") -Force | Out-Null

Copy-Item (Join-Path $PSScriptRoot "package.json") $BundleDir
Copy-Item (Join-Path $PSScriptRoot "tsconfig.json") $BundleDir
Copy-Item (Join-Path $PSScriptRoot "server.ts") $BundleDir
Copy-Item (Join-Path $RootDir "src\lib\whatsapp-baileys-manager.ts") (Join-Path $BundleDir "src\lib")
Copy-Item (Join-Path $RootDir "src\lib\firebase-admin.ts") (Join-Path $BundleDir "src\lib")
Copy-Item (Join-Path $RootDir "src\lib\link-preview.ts") (Join-Path $BundleDir "src\lib")
Copy-Item (Join-Path $RootDir "src\lib\store-utils.ts") (Join-Path $BundleDir "src\lib")
if (Test-Path (Join-Path $RootDir "src\types")) { Copy-Item -Recurse (Join-Path $RootDir "src\types") (Join-Path $BundleDir "src\types") }

if (Test-Path $ArchivePath) { Remove-Item -Force $ArchivePath }
tar -czf $ArchivePath -C $BundleDir .

Write-Host "Subiendo bundle a $Instance ($Zone)..." -ForegroundColor Cyan
gcloud compute scp $ArchivePath "${Instance}:/tmp/fuddi-whatsapp-worker.tar.gz" --project=$Project --zone=$Zone --tunnel-through-iap --quiet

$RemoteCmd = @'
set -e
sudo mkdir -p /opt/fuddi-whatsapp-worker
sudo tar -xzf /tmp/fuddi-whatsapp-worker.tar.gz -C /opt/fuddi-whatsapp-worker
rm -f /tmp/fuddi-whatsapp-worker.tar.gz
cd /opt/fuddi-whatsapp-worker
sudo npm install --omit=dev
sudo systemctl restart fuddi-whatsapp-worker
sleep 3
sudo systemctl status fuddi-whatsapp-worker --no-pager -l
'@

Write-Host "Instalando y reiniciando servicio systemd..." -ForegroundColor Cyan
gcloud compute ssh $Instance --project=$Project --zone=$Zone --tunnel-through-iap --quiet --command="$RemoteCmd"
