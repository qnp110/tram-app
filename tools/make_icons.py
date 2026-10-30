"""
Generate the app icons (icons/icon-192.png, icons/icon-512.png) from the tram pictogram.

Design: a square split along the diagonal from the top-left to the bottom-right corner.
The bottom-left triangle is blue (#1F3295), the top-right triangle white, and the white tram
pictogram sits in the blue triangle's corner.

Only the Python standard library is used (zlib + struct), so no third-party packages are needed.
Run from the repository root:  python3 tools/make_icons.py
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "icons" / "Tram_Zürich_Symbol_cropped.png"
SIZES = (192, 512)

BLUE = (0x1F, 0x32, 0x95)
WHITE = (0xFF, 0xFF, 0xFF)

# Placement of the pictogram as fractions of the icon size, measured from the bottom-left corner.
# Its top-right corner must stay below the diagonal: MARGIN + SIDE < 1 - MARGIN - SIDE, i.e. MARGIN + SIDE < 0.5.
SIDE = 0.40
MARGIN = 0.06

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def read_png(path):
    """
    Decode an 8-bit, non-interlaced RGB or RGBA PNG.

    Returns (width, height, channels, pixels) where pixels is a flat bytearray, row by row.
    """
    data = path.read_bytes()
    if data[:8] != PNG_SIGNATURE:
        raise ValueError(f"{path} is not a PNG")

    pos, idat = 8, bytearray()
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        pos += 12 + length  # length + tag + body + CRC
        if tag == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break

    if depth != 8 or interlace != 0 or color_type not in (2, 6):
        raise ValueError("Only 8-bit non-interlaced RGB/RGBA PNGs are supported")
    channels = 4 if color_type == 6 else 3

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    pixels = bytearray(height * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(height):
        kind = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        # Undo the per-row PNG filter. "a" = byte to the left, "b" = byte above, "c" = above-left.
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            if kind == 1:
                line[x] = (line[x] + a) & 0xFF
            elif kind == 2:
                line[x] = (line[x] + b) & 0xFF
            elif kind == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 0xFF
            elif kind == 4:
                c = prev[x - channels] if x >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + predictor) & 0xFF
        pixels[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, pixels


def write_png(path, size, rgb_rows):
    """Encode square RGB image rows (each a bytes object of size * 3) as a PNG file."""

    def chunk(tag, body):
        """One PNG chunk: length, tag, body, CRC over tag + body."""
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in rgb_rows)  # filter type 0 (none) per row
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def tram_mask(width, height, channels, pixels):
    """
    Turn the source image into a coverage mask in [0, 1]: 1 = white pictogram, 0 = background.

    The source's blue background is detected from its top-left pixel. "Whiteness" uses the smallest
    RGB channel, which is low for blue and 255 for white, so antialiased edges keep their soft values.
    """
    bg_min = min(pixels[0:3])
    span = 255 - bg_min
    mask = []
    for p in range(0, len(pixels), channels):
        whiteness = (min(pixels[p], pixels[p + 1], pixels[p + 2]) - bg_min) / span
        alpha = pixels[p + 3] / 255 if channels == 4 else 1.0
        mask.append(max(0.0, min(1.0, whiteness)) * alpha)
    return mask


def downscale(mask, width, height, out):
    """Box-filter the mask to an out x out grid: each output pixel is the mean of the source pixels it covers."""
    sums = [0.0] * (out * out)
    counts = [0] * (out * out)
    for y in range(height):
        row = (y * out // height) * out
        for x in range(width):
            k = row + x * out // width
            sums[k] += mask[y * width + x]
            counts[k] += 1
    return [s / c if c else 0.0 for s, c in zip(sums, counts)]


def lerp(c0, c1, t):
    """Blend two RGB colours, t = 0 gives c0, t = 1 gives c1."""
    return tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))


def render(size, mask, width, height):
    """Compose one icon of size x size pixels and return its RGB rows."""
    side = round(SIDE * size)
    left = round(MARGIN * size)
    top = size - left - side
    tram = downscale(mask, width, height, side)

    n = 4  # 4 x 4 supersampling for a smooth diagonal
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # Fraction of the pixel below the diagonal y = x (y grows downwards, so "below" means y > x).
            blue = sum((y + (j + .5) / n) > (x + (i + .5) / n) for i in range(n) for j in range(n)) / (n * n)
            color = lerp(WHITE, BLUE, blue)
            if left <= x < left + side and top <= y < top + side:
                color = lerp(color, WHITE, tram[(y - top) * side + (x - left)])
            row += bytes(color)
        rows.append(bytes(row))
    return rows


def main():
    """Read the source pictogram once and write every icon size."""
    width, height, channels, pixels = read_png(SOURCE)
    mask = tram_mask(width, height, channels, pixels)
    for size in SIZES:
        target = ROOT / "icons" / f"icon-{size}.png"
        write_png(target, size, render(size, mask, width, height))
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
