"""PyInstaller entrypoint for Eye Gaze HUD native backend."""

from backend.server import main

if __name__ == "__main__":
    raise SystemExit(main())
