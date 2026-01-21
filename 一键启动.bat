@echo off
title AI 工坊启动器
color 0a

echo ==========================================
echo       正在唤醒 AI 魔法工坊...
echo ==========================================

:: 1. 启动后端 (在新窗口中)
echo [1/3] 正在启动 Python 大脑...
start "AI Backend" cmd /k "cd backend && venv\Scripts\activate && python main.py"

:: 2. 启动前端 (在新窗口中)
echo [2/3] 正在启动网页界面...
start "AI Frontend" cmd /k "cd frontend && npm run dev"

:: 3. 等待 3 秒让服务预热，然后打开浏览器
echo [3/3] 正在打开浏览器...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo ==========================================
echo       启动成功！尽情使用吧！
echo    (使用完直接关闭两个黑窗口即可)
echo ==========================================
timeout /t 5 >nul