# Changelog

## 0.3.0 — 11 November 2026

### Added
- **Go live** to YouTube, Facebook, Twitch or any RTMP/RTMPS service using a stream key, one platform at a time
  - 720p (4 Mbps) or 1080p (6 Mbps) at 30 fps, H.264 + AAC with a keyframe every 2 seconds
  - A full-quality copy is saved to the Library while you stream
  - **Break**: Pause while live shows viewers a "Be right back" screen and turns off your sound; the saved copy skips the break
  - Reconnects automatically if the internet drops, and keeps recording if the stream can't continue
  - LIVE / CONNECTING / RECONNECTING / OFFLINE status on the control bar
  - Stream keys are stored encrypted (Windows DPAPI) and never shown in full
- **Portable version**: a zip folder that runs without installing; settings, stream keys and the Library list stay in a "NextGen Recorder Data" folder next to the app
- The update notice offers portable users the portable download

## 0.2.2 — 7 November 2026

### Fixed
- Control bar was cut off at the bottom: the drawing-tools row showed half-hidden even with the pen off
- The bar now sizes itself to its buttons, so nothing is clipped at any Windows display scale (100–150%+) or text size
- Shorter on-bar messages so they always fit

## 0.2.1 — 7 November 2026

### Fixed
- Control bar buttons (colours, tools, Undo, Clear, Done) could not be clicked while drawing, because the drawing layer covered the bar on Windows
- Slides could not be changed while drawing: arrow keys, Page Up/Down and Space now always reach PowerPoint (or any other app), even with the pen on
- Clicking the control bar no longer takes the keyboard away from your presentation

### Added
- **Mouse mode** (cursor button on the bar, or Alt+Shift+F): drawings stay on screen while your clicks go to the slides; pick any pen tool or colour to draw again
- Drawing shortcuts: Alt+Shift+1/2/3/4 for red/yellow/lime/blue, Alt+Shift+Z undo, Alt+Shift+X clear
- The bar shows which colour and tool are active, also when changed by shortcut, with a short confirmation message

## 0.2.0 — 7 November 2026

### Added
- Record a dragged **area** of the screen, with a dashed frame that does not appear in the video
- **Draw on screen** while recording: pen, highlighter, arrow, box, 4 colours, undo and clear
- **Pointer highlight** and **click rings** in the video
- Camera bubble you can **drag and resize**, **circle or rounded** shape, and **background blur**
- **Mute** the microphone and **hide the camera** while recording
- **Keyboard shortcuts** that work in any app (Alt+Shift+R, P, M, C, D)
- **60 fps** option
- **Library** of recordings with preview pictures, rename, show in folder and Recycle Bin
- **Trim**, **export GIF** and **make a smaller copy**, each saved as a new file
- **Standard MP4** output (H.264 + AAC) that plays everywhere
- **Crash recovery** of interrupted recordings
- **Light and dark theme**, **Settings** page, **first-run tour** and **system-tray** menu
- **New-version notice** using GitHub releases

### Changed
- Recordings save straight to `Videos\NextGen Recorder` (you can ask to choose each time in Settings)

## 0.1.0 — 7 November 2026
- First prototype: screen + camera bubble + microphone + computer sound in one video
