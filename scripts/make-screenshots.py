"""Build the README gallery from the screenshots captured by test/e2e.cjs.

The suite writes raw captures to test/shots/ (git-ignored, 2x device scale).
This picks the frames worth publishing, downscales the wide ones and saves
them as tracked assets under screenshots/.

    NODE_PATH="$(npm root -g)" node test/e2e.cjs   # captures test/shots/*.png
    python scripts/make-screenshots.py
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'test', 'shots')
DST = os.path.join(ROOT, 'screenshots')

# captured frame -> published name, max width (None keeps the original size)
# widths target ~2x the size the README table renders them at
GALLERY = [
    ('13-region-selecting.png', 'region-select.png', 1400),
    ('14-region-result-popup.png', 'region-result.png', 520),
    ('02-popup-result-url.png', 'popup-result.png', 520),
    ('11-float-window.png', 'float-window.png', None),
    ('15-float-region-result.png', 'float-result.png', 520),
    ('05-history.png', 'history.png', 520),
    ('07-scanner-found.png', 'camera-scanner.png', 1280),
    ('09-scanner-mobile.png', 'camera-mobile.png', 520),
]

os.makedirs(DST, exist_ok=True)
missing = [name for name, _, _ in GALLERY if not os.path.exists(os.path.join(SRC, name))]
if missing:
    raise SystemExit('missing captures, run the e2e suite first: ' + ', '.join(missing))

total = 0
for name, out, max_width in GALLERY:
    image = Image.open(os.path.join(SRC, name)).convert('RGBA')
    if max_width and image.width > max_width:
        size = (max_width, round(image.height * max_width / image.width))
        image = image.resize(size, Image.LANCZOS)
    path = os.path.join(DST, out)
    image.save(path, optimize=True)
    total += os.path.getsize(path)
    print(f'{out:22} {image.width}x{image.height}  {os.path.getsize(path) // 1024} KB')

print(f'\n{len(GALLERY)} images, {total // 1024} KB total')
