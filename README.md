# 🎵 ForliMusicPlayer (Apple Music Web Replica)

[![Platform](https://img.shields.io/badge/Platform-Web-blue?style=for-the-badge)](https://github.com/WumiaoTech228/ForliMusicPlayer)
[![NodeJS](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=for-the-badge)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-orange?style=for-the-badge)](https://opensource.org/licenses/MIT)

> **ForliMusicPlayer** 是一款极致还原、视觉惊艳的 **Apple Music 网页版 1:1 复刻播放器**。它融合了流体彩色渐变背景、歌词滚动同步、网易云歌单解析与搜索、本地音频文件读取及 ID3 标签解析等功能，带给你殿堂级的视听享受。

---

## 🎨 视觉与核心特性 (Key Features)

*   **✨ 1:1 像素级复刻**：极致还原 Apple Music 经典的左侧固定边栏、毛玻璃拟物化设计、现代排版与微交互动画。
*   **🌈 智能流体渐变背景**：背景 Canvas 会根据当前播放音乐的封面自动提取主色调，并生成如梦如幻的流体动态渐变效果，还原 Apple Music 标志性的视觉动效。
*   **📝 实时动态歌词同步**：
    *   高精度歌词同步滚动与逐行点亮高亮。
    *   支持用户鼠标滚轮拖拽查看，并带自动回弹定位逻辑。
    *   无歌词时自动展示音符跳动提示，支持本地 `.lrc` 文件导入。
*   **🔍 网易云生态整合**：
    *   **歌单导入**：直接输入网易云音乐歌单 ID，一键解析导入整张歌单。
    *   **在线搜索**：内置代理搜索，快速检索网易云曲库歌曲，并支持高品质播放。
*   **📁 本地媒体深度读取**：
    *   可以直接拖拽或选择本地音频文件、文件夹导入播放。
    *   集成 `jsmediatags`，自动读取本地 MP3/M4A 文件的 ID3 信息，提取内嵌的**专辑封面、歌名、歌手**信息，本地音乐也能享受尊贵流体背景。
*   **🖥️ 全屏沉浸式播放模式**：
    *   一键切换至全屏大屏播放页，拥有超大歌词排版、柔和唱片倒影和背光氛围渲染。
    *   全屏模式下内置独立浮动待播清单面板与歌词开关。
*   **⚡ 极简无依赖后端**：
    *   Node.js 原生 HTTP 代理服务，免去任何复杂的 `npm install`。
    *   完美解决浏览器跨域（CORS）限制，轻松代理获取网易云音乐源、歌词及封面。

---

## 🛠️ 技术栈 (Tech Stack)

*   **前端核心**：HTML5 Semantic tags, Vanilla Javascript (ES6+)
*   **样式表现**：Vanilla CSS3 (Custom Properties 变量定义, Glassmorphism 毛玻璃特效, Canvas 流体动效)
*   **排版字体**：Inter, Outfit, San Francisco Font (SF Pro)
*   **外部库**：`jsmediatags.js` (本地 ID3 Tag 解析)
*   **后端服务**：Node.js HTTP Server (原生 `fetch` 转发，零依赖包)

---

## 📂 项目结构 (Project Structure)

```text
ForliMusicPlayer/
├── index.html        # 播放器主骨架 (Apple Music 布局、全屏层、弹窗组件)
├── style.css         # 极致视觉设计的 CSS 样式表 (包含动画与主题变量)
├── app.js            # 核心业务逻辑 (播放控制、Canvas 渐变算法、本地文件解析)
├── playlist.js       # 网易云歌单解析与本地存储管理
├── server.js         # Node.js 轻量后端代理服务 (解决跨域，路由转发)
├── default.svg       # 默认专辑封面占位图
├── .gitignore        # Git 忽略规则配置文件
└── README.md         # 项目使用说明文档
```

---

## 🚀 快速开始 (Getting Started)

### 1. 克隆仓库
```bash
git clone https://github.com/WumiaoTech228/ForliMusicPlayer.git
cd ForliMusicPlayer
```

### 2. 运行本地服务器
本项目**无需安装任何 node_modules 依赖**，但由于需要使用原生 `fetch` API，请确保您的 Node.js 版本在 **v18.0.0** 或以上。

直接使用 Node.js 启动：
```bash
node server.js
```

### 3. 打开播放器
服务启动后，在浏览器中访问：
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 💡 使用指南 (Usage Tips)

1.  **导入网易云歌单**：
    *   点击左侧边栏底部的 **“导入歌单”** 按钮。
    *   输入你喜欢的网易云歌单 ID（例如 `8529369110`），点击确认即可将歌单载入待播列表并自动缓存至本地。
2.  **播放本地音乐**：
    *   点击“打开本地音频”或“打开文件夹”，选择你电脑上的音频文件。
    *   程序会自动加载文件并自动解析 ID3 Tag。
3.  **全屏视觉享受**：
    *   点击播放器底部控制栏的专辑封面或右下角的全屏按钮，即可切换至 Apple Music 标志性的全屏毛玻璃歌词背景模式。

---

## 📄 开源协议 (License)

本项目基于 [MIT License](LICENSE) 协议开源。
