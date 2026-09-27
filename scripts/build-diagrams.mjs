import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "docs/diagrams/giteehelper-architecture.html");
const outputDir = path.join(root, "public");
const output = path.join(outputDir, "architecture.html");

await mkdir(outputDir, { recursive: true });
await copyFile(source, output);
console.log(`Archify architecture diagram copied to ${path.relative(root, output)}`);
