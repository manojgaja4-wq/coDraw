@echo off
echo Starting CoDraw Real-Time Collaborative Canvas Server...
set NODE_EXE="C:\Users\manoj\AppData\Local\ms-playwright-go\1.50.1\node.exe"

if exist %NODE_EXE% (
    %NODE_EXE% server/server.js
) else (
    node server/server.js
)
pause
