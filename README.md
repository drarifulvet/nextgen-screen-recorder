# NextGen Screen Recorder — by NextGen IT

A free Windows screen recorder. It records your **screen**, a **camera bubble**, your **voice** and **computer sound** into one MP4 video, can **stream live** to YouTube, Facebook and others, and has presenter tools and simple editing built in.

**Free, no time limit, no watermark. Your videos stay on your computer.**

Version 0.3.0 · Windows 10 (version 2004 or newer) and Windows 11, 64-bit · 7 November 2026

---

## Features

**Recording**
- Record a whole screen, one window, or a dragged **area**
- Camera bubble you can **drag, resize** and shape (circle or rounded square), with **background blur**
- Microphone and computer sound together; **mute** and **hide camera** mid-recording
- 720p or 1080p, 30 or 60 frames per second
- Saved as **standard MP4** (H.264 video, AAC sound) that plays in every app and phone
- **Crash recovery**: an interrupted recording can be recovered next time you open the app

**Live streaming**
- Go live to **YouTube, Facebook, Twitch** or any RTMP/RTMPS service (LinkedIn Live, X, Restream and others) with a stream key
- 720p or 1080p; a full-quality copy is saved to the Library at the same time
- **Break** button shows viewers "Be right back" and turns off your sound
- Reconnects automatically if the internet drops

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

While drawing (pen on):

| Keys | Action |
|---|---|
| Alt+Shift+1 / 2 / 3 / 4 | Red / yellow / lime / blue pen |
| Alt+Shift+Z | Undo last drawing |
| Alt+Shift+X | Clear all drawings |
| Alt+Shift+F | Mouse mode: keep drawings, click your slides (press again to draw) |
| Alt+Shift+D | Pen off (drawings are cleared) |

Arrow keys, Page Up/Down and Space keep changing your slides while the pen is on.

---

## For users

### Install (two choices)
Download from the [Releases page](https://github.com/drarifulvet/nextgen-screen-recorder/releases/latest):

- **Installer** (`NextGen-Screen-Recorder-Setup-…zip`): adds Start-menu and desktop shortcuts.
  1. Right-click the zip and choose **Extract All… → Extract**.
  2. Double-click **NextGen-Screen-Recorder-Setup-0.3.0.exe**.
- **Portable** (`NextGen-Screen-Recorder-Portable-…zip`): no installation; runs from any folder or a USB stick.
  1. Right-click the zip and choose **Extract All… → Extract**.
  2. Open the **NextGen Screen Recorder** folder and double-click **NextGen Screen Recorder.exe**.
  3. Settings and stream keys are kept in **NextGen Recorder Data** inside that folder. Stream keys are encrypted for your Windows account, so on another PC you paste them again.

For either one:
- If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. (The app is new and not yet code-signed.)
- For the installer, click **Next**, then **Install**, then open the app from the desktop shortcut.

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

### Go live
1. In **Go live**, switch on **Stream while recording** and choose the platform.
2. Click **Add stream key** and follow the three steps shown:
   - **YouTube**: YouTube Studio → Create → Go live → Stream → copy the Stream key.
   - **Facebook**: Facebook Live Producer → Streaming software → copy the Stream key. (Facebook requires accounts at least 60 days old; Pages and professional profiles need 100 followers.)
   - **Twitch**: Creator Dashboard → Settings → Stream → copy the Primary Stream key.
   - **Other**: paste the Server URL (rtmp:// or rtmps://) and Stream key from your platform.
3. Choose **720p** (needs about 5 Mbps upload) or **1080p** (about 8 Mbps).
4. Click **Go live** (or press Alt+Shift+R). The bar shows **LIVE** once viewers can see you.
5. **Break** shows viewers "Be right back" and turns off your sound; **Back live** returns. **Stop** ends the broadcast and saves the copy.

Keep your stream key private: anyone with it can broadcast on your channel.

### Approximate file sizes
About **45 MB per minute at 1080p** and **27 MB per minute at 720p** (30 fps). 60 fps is about 1.5 times larger.

---

## For developers

### Run from source (Windows)
1. Install **Node.js 22 LTS** from nodejs.org.
2. In this folder, run `npm install` (this also downloads FFmpeg and the blur model).
3. Run `npm start`.

### Build the installer
Run `npm run dist`. The installer and the portable zip appear in `dist\`.
On Linux, install Wine first (the installer step uses it).

### Project layout
| Path | What it does |
|---|---|
| `main.js` | Windows, shortcuts, area selection, drawing overlay, click tracking, library, FFmpeg jobs, stream keys, updates, tray, crash recovery, portable mode |
| `live.js` | Live streaming: platform presets, FFmpeg RTMP/RTMPS sender, reconnecting |
| `preload.js` | Safe bridge between the pages and the app |
| `renderer/index.html`, `app.js`, `styles.css` | Main screen: Record, Library and Settings |
| `renderer/controlbar.*` | Floating control bar (hidden from recordings) |
| `renderer/region.*`, `frame.html` | Area selector and the dashed area frame |
| `renderer/draw.*` | Draw-on-screen overlay |
| `scripts/prepare.js` | Downloads FFmpeg and the MediaPipe blur model |
| `scripts/afterPack.js` | Stamps the icon and version details on the .exe |
| `scripts/portable.js` | Makes the portable zip from the Windows build |
| `web/NextGen-Recorder.html` | Browser version for quick reviews (Chrome or Edge) |

### Releasing a new version
1. Change `"version"` in `package.json` (for example `0.3.0`).
2. Run `npm run dist`, then zip the installer (the portable zip is made for you).
3. On GitHub, create a release with the tag `v0.3.0` and attach both zips. Keep "Setup" and "Portable" in the file names: the app uses them to offer each user the right download.
4. Users' apps will show a "new version available" notice automatically.

### Third-party components
- Electron (MIT)
- MediaPipe Tasks Vision (Apache 2.0) for background blur
- uiohook-napi (MIT) for click rings
- FFmpeg 6.0 (GPL build with x264, from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.0)), run as a separate program for trimming, GIFs, smaller copies and standard MP4. Its source code is available from [ffmpeg.org](https://ffmpeg.org/download.html) and the ffmpeg-static release page.
