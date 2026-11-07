# NextGen Screen Recorder — by NextGen IT

A free Windows screen recorder. It records your **screen**, a **camera bubble**, your **voice** and **computer sound** into one MP4 video, with presenter tools and simple editing built in.

**Free, no time limit, no watermark. Your videos stay on your computer.**

Version 0.2.0 · Windows 10 (version 2004 or newer) and Windows 11, 64-bit · 7 November 2026

---

## Features

**Recording**
- Record a whole screen, one window, or a dragged **area**
- Camera bubble you can **drag, resize** and shape (circle or rounded square), with **background blur**
- Microphone and computer sound together; **mute** and **hide camera** mid-recording
- 720p or 1080p, 30 or 60 frames per second
- Saved as **standard MP4** (H.264 video, AAC sound) that plays in every app and phone
- **Crash recovery**: an interrupted recording can be recovered next time you open the app

**Presenter tools**
- **Draw on screen** while recording: pen, highlighter, arrow, box, 4 colours, undo, clear
- **Pointer highlight** and **click rings** in the video

**Library and editing**
- Every recording listed with a preview picture
- **Trim** the start and end, **export a GIF**, or **make a smaller copy** (your original is never changed)
- Rename, show in folder, move to the Recycle Bin

**Comfort**
- Keyboard shortcuts that work in any app
- Light and dark theme (follows Windows)
- First-run tour, system-tray menu, and a notice when a new version is out

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Alt+Shift+R | Start or stop recording |
| Alt+Shift+P | Pause or resume |
| Alt+Shift+M | Mute or unmute microphone |
| Alt+Shift+C | Show or hide camera |
| Alt+Shift+D | Draw on screen |

---

## For users

### Install
1. Download the latest `.zip` from the [Releases page](https://github.com/drarifulvet/nextgen-screen-recorder/releases).
2. Right-click the zip and choose **Extract All… → Extract**.
3. Double-click **NextGen-Screen-Recorder-Setup-0.2.0.exe**.
4. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. (The app is new and not yet code-signed.)
5. Click **Next**, then **Install**, then open the app from the desktop shortcut.

### First start
- Windows may ask to allow the camera and microphone: click **Allow**.
- If the camera or microphone list is empty, open **Settings → Privacy & security → Camera** (and **Microphone**) and switch on **Let desktop apps access your camera/microphone**.
- A short tour shows you around. You can replay it from **Settings → Help**.

### Record
1. **What to record**: choose **Screen**, **Window** or **Area** (for Area, click **Select area** and drag).
2. **Camera**: pick your webcam. Drag the bubble on the preview to move it; scroll over it to resize.
3. **Sound**: pick your microphone and speak; the green bar should move. Leave **Include computer sound** on for video and app sound. *Tip: wear headphones to avoid echo.*
4. Click **Start recording**, or press **Alt+Shift+R** in any app.
5. Use the floating bar to pause, mute, hide the camera, draw, or stop. The bar does not appear in your video.
6. Your video is saved to **Videos\NextGen Recorder** and appears in the **Library** tab.

### Approximate file sizes
About **45 MB per minute at 1080p** and **27 MB per minute at 720p** (30 fps). 60 fps is about 1.5 times larger.

---

## For developers

### Run from source (Windows)
1. Install **Node.js 22 LTS** from nodejs.org.
2. In this folder, run `npm install` (this also downloads FFmpeg and the blur model).
3. Run `npm start`.

### Build the installer
Run `npm run dist`. The installer appears in `dist\`.
On Linux, install Wine first (the installer step uses it).

### Project layout
| Path | What it does |
|---|---|
| `main.js` | Windows, shortcuts, area selection, drawing overlay, click tracking, library, FFmpeg jobs, updates, tray, crash recovery |
| `preload.js` | Safe bridge between the pages and the app |
| `renderer/index.html`, `app.js`, `styles.css` | Main screen: Record, Library and Settings |
| `renderer/controlbar.*` | Floating control bar (hidden from recordings) |
| `renderer/region.*`, `frame.html` | Area selector and the dashed area frame |
| `renderer/draw.*` | Draw-on-screen overlay |
| `scripts/prepare.js` | Downloads FFmpeg and the MediaPipe blur model |
| `scripts/afterPack.js` | Stamps the icon and version details on the .exe |
| `web/NextGen-Recorder.html` | Browser version for quick reviews (Chrome or Edge) |

### Releasing a new version
1. Change `"version"` in `package.json` (for example `0.3.0`).
2. Run `npm run dist`, then zip the installer.
3. On GitHub, create a release with the tag `v0.3.0` and attach the zip.
4. Users' apps will show a "new version available" notice automatically.

### Third-party components
- Electron (MIT)
- MediaPipe Tasks Vision (Apache 2.0) for background blur
- uiohook-napi (MIT) for click rings
- FFmpeg 6.0 (GPL build with x264, from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.0)), run as a separate program for trimming, GIFs, smaller copies and standard MP4. Its source code is available from [ffmpeg.org](https://ffmpeg.org/download.html) and the ffmpeg-static release page.
