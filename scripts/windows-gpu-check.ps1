$ErrorActionPreference = "Stop"

Write-Host "PowerMesh Windows GPU readiness check" -ForegroundColor Cyan

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "WSL is not installed. Run: wsl --install -d Ubuntu"
}

wsl.exe --status
wsl.exe --update

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is not available on PATH. Install it and enable the WSL2 backend."
}

docker.exe info --format "Docker server: {{.OperatingSystem}}"
Write-Host "Testing NVIDIA passthrough inside a Linux container..." -ForegroundColor Cyan
docker.exe run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi

Write-Host "READY: Docker can see the NVIDIA GPU through WSL2." -ForegroundColor Green
