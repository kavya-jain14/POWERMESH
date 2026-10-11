import process from "node:process";
import sharp from "sharp";

const maxRequestBytes = 14 * 1024 * 1024;
const maxInputBytes = 10 * 1024 * 1024;

async function readRequest() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  const source = body || process.argv[2];
  if (!source) throw new Error("MISSING_REQUEST");
  return JSON.parse(source);
}

function parseRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_REQUEST");
  }
  const { inputBase64, format, maxWidth, quality } = input;
  if (!new Set(["webp", "jpeg", "png"]).has(format)) throw new Error("INVALID_FORMAT");
  if (!Number.isInteger(maxWidth) || maxWidth < 256 || maxWidth > 4096 || maxWidth % 64 !== 0) {
    throw new Error("INVALID_MAX_WIDTH");
  }
  if (!Number.isInteger(quality) || quality < 40 || quality > 95) {
    throw new Error("INVALID_QUALITY");
  }
  if (
    inputBase64 !== undefined &&
    (typeof inputBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(inputBase64))
  ) {
    throw new Error("INVALID_INPUT");
  }
  const demoSource = Buffer.from(
    `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="900" fill="#111"/><circle cx="800" cy="450" r="260" fill="#c7ff3d"/><text x="800" y="470" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#111">PowerMesh</text></svg>`,
  );
  const data = inputBase64 === undefined ? demoSource : Buffer.from(inputBase64, "base64");
  if (data.length === 0 || data.length > maxInputBytes) throw new Error("INVALID_INPUT_SIZE");
  return { data, format, maxWidth, quality };
}

async function transform({ data, format, maxWidth, quality }) {
  const image = sharp(data, { failOn: "warning", limitInputPixels: 40_000_000 }).rotate().resize({
    width: maxWidth,
    withoutEnlargement: true,
    fit: "inside",
  });
  if (format === "webp") return image.webp({ quality }).toBuffer();
  if (format === "jpeg") return image.jpeg({ quality, mozjpeg: true }).toBuffer();
  return image.png({ quality, compressionLevel: 9 }).toBuffer();
}

try {
  const output = await transform(parseRequest(await readRequest()));
  process.stdout.write(output);
} catch {
  process.stderr.write("IMAGE_TRANSFORM_FAILED\n");
  process.exitCode = 1;
}
