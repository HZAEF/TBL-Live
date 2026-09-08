@echo off
chcp 65001 >nul
title TBL Live - mode reseau local
cd /d "%~dp0"

echo.
echo ============================================================
echo   TBL LIVE - MODE RESEAU LOCAL (sans Internet)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable sur cet ordinateur.
  echo Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

rem --- Premiere preparation (fichier .env avec la base locale) ---
if not exist ".env" (
  echo Preparation de la base de donnees locale...
  call node scripts\build-local.mjs --ensure-env
)

rem --- Installation des composants (premiere fois seulement) ---
if not exist "node_modules\next" (
  echo Premiere installation des composants ^(2 a 4 minutes, une seule fois^)...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue. Verifiez votre connexion Internet puis relancez.
    pause
    exit /b 1
  )
)

rem --- Compilation (premiere fois seulement ou apres une mise a jour) ---
if not exist ".next\standalone\server.js" (
  echo Compilation pour le reseau local ^(1 a 2 minutes^)...
  call node scripts\build-local.mjs
  if errorlevel 1 (
    echo La compilation a echoue. Consultez le journal ci-dessus.
    pause
    exit /b 1
  )
)

echo.
echo ============================================================
echo   LE SERVEUR LOCAL VA DEMARRER.
echo.
echo   Adresses a donner aux etudiants ^(sur le Wi-Fi de la salle^) :
echo ============================================================
node -e "const os=require('os');const n=os.networkInterfaces();let f=0;for(const k of Object.keys(n)){for(const a of n[k]){if(a.family==='IPv4'&&!a.internal){f++;console.log('     http://'+a.address+':3000     ('+k+')')}}}if(!f)console.log('     Aucune adresse reseau trouvee - connectez le Wi-Fi')"
echo.
echo   - Gardez cette fenetre OUVERTE pendant toute la seance.
echo   - Si Windows demande l'autorisation reseau : cliquez AUTORISER.
echo   - Ctrl+C pour arreter le serveur a la fin.
echo ============================================================
echo.

set "HOSTNAME=0.0.0.0"
node --env-file=.env .next\standalone\server.js

echo.
echo Serveur arrete.
pause
