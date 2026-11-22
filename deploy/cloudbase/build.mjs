/**
 * 构建 CloudBase 云函数包：把前端（index.html / styles.css / js / vendor）复制进 functions/rp/public
 *
 *   node build.mjs                       # 同源（默认）：前端由云函数自己返回
 *   RP_API_BASE=https://xxx.app.tcloudbase.com node build.mjs
 *                                        # 前端放静态托管、API 走云函数时，把函数地址写进 js/env.js
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');           // resume-polish/
const outDir = path.join(here, 'functions/rp/public');
const apiBase = (process.env.RP_API_BASE || '').replace(/\/+$/, '');

const ENTRIES = [
  ['index.html', 'index.html'],
  ['styles.css', 'styles.css'],
  ['js', 'js'],
  ['vendor', 'vendor'],
];

async function sizeOf(p) {
  const st = await stat(p);
  if (st.isFile()) return st.size;
  let sum = 0;
  for (const e of await readdir(p, { withFileTypes: true })) {
    sum += await sizeOf(path.join(p, e.name));
  }
  return sum;
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const [from, to] of ENTRIES) {
    const src = path.join(root, from);
    const dst = path.join(outDir, to);
    await cp(src, dst, { recursive: true });
  }

  // 需要跨域访问云函数时，把地址补进 env.js（env.js 是惰性读取，追加在末尾即可）
  if (apiBase) {
    const envFile = path.join(outDir, 'js/env.js');
    const old = await readFile(envFile, 'utf8');
    await writeFile(envFile, old + `\nwindow.RP_API_BASE = ${JSON.stringify(apiBase)};\n`, 'utf8');
  }

  const bytes = await sizeOf(outDir);
  console.log(`[build] 前端已复制到 ${path.relative(root, outDir)}`);
  console.log(`[build] RP_API_BASE = ${apiBase || '(同源，留空)'}`);
  console.log(`[build] 体积 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error('[build] 失败：', e);
  process.exit(1);
});