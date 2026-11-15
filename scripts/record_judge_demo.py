"""Record a manual, real Scout browser walkthrough on macOS with narration.

Unlock Scout and show ONLY its browser window on the main display first.
This records the full main display; hide unrelated windows and notifications.
"""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo"
if sys.platform != "darwin":
    raise SystemExit("This recorder uses macOS screencapture. Use your platform's screen recorder instead.")
OUT.mkdir(exist_ok=True)
audio = OUT / "judge-narration.m4a"
if not audio.exists():
    raw = OUT / "judge-narration.aiff"
    subprocess.run(["say", "-v", "Samantha", "-r", "155", "-f", str(OUT / "judge-narration.txt"), "-o", str(raw)], check=True)
    subprocess.run(["ffmpeg", "-y", "-i", str(raw), "-c:a", "aac", str(audio)], check=True)
    raw.unlink()
duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(audio)], text=True))
print("Recording starts in 8 seconds. Show the unlocked Scout browser on the main display.")
print("Follow docs/JUDGE_DEMO.md. No passwords or keys should be visible.")
time.sleep(8)
raw_video = OUT / "judge-screen.mov"
record = subprocess.Popen(["/usr/sbin/screencapture", "-D1", "-v", "-C", "-V" + str(int(duration) + 2), str(raw_video)])
sound = subprocess.Popen(["afplay", str(audio)])
record.wait()
sound.wait()
if record.returncode or not raw_video.exists():
    raise SystemExit("Recording failed. Enable Screen Recording for your terminal in macOS System Settings, then retry.")
video = OUT / "scout-judge-demonstration.mp4"
subprocess.run(["ffmpeg", "-y", "-i", str(raw_video), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)], check=True)
print("Saved:", video)
