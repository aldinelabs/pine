// A minimal animated GIF89a encoder for generate-installer-art.mjs.
// The installer art is two-tone (an olive surface and its foreground), so a
// 256-step ramp between the frame's lightest and darkest colours reproduces it,
// antialiasing included, without a quantization library.

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildRamp(frames) {
  let light = null;
  let dark = null;
  for (const frame of frames) {
    for (let index = 0; index < frame.length; index += 4) {
      const pixel = [frame[index], frame[index + 1], frame[index + 2]];
      const value = luminance(...pixel);
      if (light === null || value > light.value) light = { pixel, value };
      if (dark === null || value < dark.value) dark = { pixel, value };
    }
  }
  const palette = new Uint8Array(256 * 3);
  for (let step = 0; step < 256; step += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      palette[step * 3 + channel] = Math.round(
        light.pixel[channel] +
          ((dark.pixel[channel] - light.pixel[channel]) * step) / 255,
      );
    }
  }
  return { palette, light: light.value, dark: dark.value };
}

function lzw(indices) {
  const minimumCodeSize = 8;
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  let codeSize = minimumCodeSize + 1;
  const write = (code) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(buffer & 0xff);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  let table = new Map();
  let next = end + 1;
  write(clear);
  let prefix = indices[0];
  for (let index = 1; index < indices.length; index += 1) {
    const symbol = indices[index];
    const key = prefix * 256 + symbol;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    write(prefix);
    if (next < 4096) {
      table.set(key, next);
      next += 1;
      if (next > 1 << codeSize && codeSize < 12) codeSize += 1;
    } else {
      write(clear);
      table = new Map();
      next = end + 1;
      codeSize = minimumCodeSize + 1;
    }
    prefix = symbol;
  }
  write(prefix);
  write(end);
  if (bits > 0) bytes.push(buffer & 0xff);
  // Sub-blocks of at most 255 bytes, then a terminator.
  const blocks = [minimumCodeSize];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.slice(offset, offset + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return blocks;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array[]} frames RGBA pixels, one array per frame.
 * @param {number} delay Hundredths of a second per frame.
 */
export function encodeGif(width, height, frames, delay) {
  const { palette, light, dark } = buildRamp(frames);
  const span = Math.max(1, light - dark);
  const word = (value) => [value & 0xff, value >> 8];
  const out = [
    ...Buffer.from("GIF89a"),
    ...word(width),
    ...word(height),
    0xf7, // Global colour table, 8 bits per channel, 256 entries.
    0,
    0,
    ...palette,
    // Loop forever.
    0x21,
    0xff,
    0x0b,
    ...Buffer.from("NETSCAPE2.0"),
    3,
    1,
    0,
    0,
    0,
  ];
  for (const frame of frames) {
    const indices = new Uint8Array(width * height);
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      const offset = pixel * 4;
      const value = luminance(
        frame[offset],
        frame[offset + 1],
        frame[offset + 2],
      );
      indices[pixel] = Math.max(
        0,
        Math.min(255, Math.round(((light - value) / span) * 255)),
      );
    }
    out.push(0x21, 0xf9, 4, 0, ...word(delay), 0, 0);
    out.push(0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0);
    out.push(...lzw(indices));
  }
  out.push(0x3b);
  return Buffer.from(out);
}
