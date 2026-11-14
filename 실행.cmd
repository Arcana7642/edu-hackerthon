@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "node_modules\qrcode\package.json" if exist "node_modules\jsqr\package.json" if exist "node_modules\pdfjs-dist\package.json" goto run
call npm ci
if errorlevel 1 goto failed
:run
echo 할 수 있어 - http://localhost:4173
node --env-file-if-exists=.env server.mjs
:failed
pause
