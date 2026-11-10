@echo off
cd /d "%~dp0"
chcp 65001 >nul
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo 这台电脑缺少 .NET Framework 编译器，无法启动转盘。
  pause
  exit /b 1
)
"%CSC%" /nologo /optimize+ /r:System.Web.Extensions.dll /out:team-wheel.exe Server.cs
if errorlevel 1 (
  echo 编译失败。
  pause
  exit /b 1
)
team-wheel.exe
pause
