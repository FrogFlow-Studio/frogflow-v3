// Проверка сборки для Vercel: каждая функция в .vercel/output/functions должна
// быть самодостаточной. Ссылка (symlink) наружу своей папки .func на Vercel
// указывает в никуда — функция падает с 500 на любом запросе. Так уже было:
// Nitro копировал основную функцию с абсолютной ссылкой на tslib.
import { lstat, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// Папка functions сборки: по умолчанию .vercel/output/functions, или первый аргумент
// (verify собирает Vercel-вариант во временную папку).
const root = process.argv[2] ?? ".vercel/output/functions";

async function walk(dir, func, bad) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await readlink(path);
      const outside = relative(func, resolve(dirname(path), target)).startsWith("..");
      // Сама функция-ссылка на основную (junction от Nitro) — законна, если относительна.
      if (isAbsolute(target) || (outside && !path.endsWith(".func")))
        bad.push(`${path} -> ${target}`);
      continue;
    }
    if (entry.isDirectory()) {
      await walk(path, path.endsWith(".func") ? path : func, bad);
    }
  }
}

const exists = await lstat(root).catch(() => null);
if (!exists) {
  console.log("check-vercel-output: .vercel/output нет (сборка не для Vercel) — пропускаю");
} else {
  const bad = [];
  await walk(root, root, bad);
  if (bad.length) {
    console.error("check-vercel-output: ссылки, которых не будет на Vercel:\n" + bad.join("\n"));
    process.exit(1);
  }
  console.log("check-vercel-output: функции самодостаточны");
}
