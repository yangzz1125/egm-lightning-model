@echo off
chcp 65001 > nul
echo ========================================================
echo   EGM 全栈仿真器 启动程序 (FastAPI + React)
echo ========================================================

REM 开启后台服务
echo 启动后端 API 服务 (端口: 8000) ...
start "Backend" cmd /c "call .venv\Scripts\activate && uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000"

REM 等待两秒以确保后端准备好
timeout /t 2 /nobreak > nul

REM 开启前端服务
echo 启动前端 React 服务 (端口: 5173 附近) ...
start "Frontend" cmd /c "cd frontend && if not exist node_modules (echo 检测到缺少依赖，正在初始化安装... && npm install --registry=https://registry.npmmirror.com/) && npm run dev"

echo 服务启动指令已下发，请稍后在自动弹出的浏览器窗口中查看！
pause
