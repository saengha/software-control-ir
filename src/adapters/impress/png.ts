import { deflateSync, inflateSync } from "node:zlib";

export interface RgbRaster {
  width: number;
  height: number;
  pixels: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filter: number, row: Buffer, prev: Buffer, bpp: number) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? row[i - bpp]! : 0;
    const up = prev[i] ?? 0;
    const upLeft = i >= bpp ? prev[i - bpp]! : 0;
    const x = row[i]!;
    if (filter === 1) row[i] = (x + left) & 255;
    else if (filter === 2) row[i] = (x + up) & 255;
    else if (filter === 3) row[i] = (x + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[i] = (x + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`unsupported png filter ${filter}`);
  }
}

/** Decode a non-interlaced 8-bit RGB or RGBA PNG into packed RGB bytes. */
export function decodePngRgb(buffer: Buffer): RgbRaster {
  if (buffer.length < 8 || buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bit = 0;
  let color = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bit = data[8] ?? 0;
      color = data[9] ?? 0;
      if (data[12] !== 0) throw new Error("interlaced png is not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const channels = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (bit !== 8 || channels === 0 || width < 1 || height < 1) {
    throw new Error(`unsupported png ${width}x${height} bit=${bit} color=${color}`);
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src] ?? 0;
    src += 1;
    inflated.copy(row, 0, src, src + stride);
    src += stride;
    unfilter(filter, row, prev, channels);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const j = x * channels;
      pixels[i] = row[j] ?? 0;
      pixels[i + 1] = row[j + 1] ?? 0;
      pixels[i + 2] = row[j + 2] ?? 0;
    }
    row.copy(prev);
  }
  return { width, height, pixels };
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const crcInput = Buffer.concat([header.subarray(4, 8), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([header, data, crc]);
}

/** 8-bit RGB PNG, filter none. Used as the vision screenshot payload. */
export function encodePngRgb(raster: RgbRaster): Buffer {
  const { width, height, pixels } = raster;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
