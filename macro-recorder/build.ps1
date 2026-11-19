# Build StitchKeys Macro Recorder into a standalone .exe
# Usage:  cd macro-recorder && .\build.ps1
# Requires Python + pynput + pyinstaller:
#   pip install pynput pyinstaller

$ErrorActionPreference = 'Stop'

Write-Host "Installing/updating dependencies..."
python -m pip install -q pynput pyinstaller

Write-Host "Building executable..."
python -m PyInstaller `
    --onefile `
    --windowed `
    --name "StitchKeys-MacroRecorder" `
    macro_recorder.py

Write-Host ""
Write-Host "Done!  Output: dist\StitchKeys-MacroRecorder.exe"
