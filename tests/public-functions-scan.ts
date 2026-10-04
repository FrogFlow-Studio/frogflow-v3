import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Серверные функции без сессии продавца и оператора: те, у которых в теле (и в помощниках файла,
 * которые они зовут) нет гварда. Их список сверяется с docs/SECURITY-PUBLIC.md.
 */
const GUARD = /\b(requireAdmin\w*|requireOperator|guard\(\)|adminShops|switchAdminShop)\b/;

export type PublicFn = { id: string; file: string; name: string; text: string };

export function functionFiles(dir = "src/app"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...functionFiles(p));
    else if (e.endsWith(".functions.ts")) out.push(p);
  }
  return out.sort();
}

type Helper = { name: string; text: string };

function helpersOf(src: string): Helper[] {
  const out: Helper[] = [];
  for (const m of src.matchAll(
    /^(?:(?:export )?const (\w+) = (?:async )?\(?[^\n]*(?:\n {2,}[^\n]*)*|(?:export )?(?:async )?function (\w+)\([\s\S]*?^\})/gm,
  ))
    out.push({ name: (m[1] ?? m[2])!, text: m[0] });
  return out.filter((h) => !/createServerFn/.test(h.text));
}

/** Тело функции плюс тексты помощников файла, которые она зовёт (по цепочке). */
function withHelpers(body: string, helpers: Helper[]): string {
  let text = body;
  const seen = new Set<string>();
  for (let round = 0; round < 4; round++)
    for (const h of helpers)
      if (!seen.has(h.name) && new RegExp(`\\b${h.name}\\(`).test(text)) {
        seen.add(h.name);
        text += `\n${h.text}`;
      }
  return text;
}

export function allServerFns(): PublicFn[] {
  const out: PublicFn[] = [];
  for (const file of functionFiles()) {
    const src = readFileSync(file, "utf8");
    const helpers = helpersOf(src);
    const parts = src.split(/^export const (\w+) = createServerFn/m);
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i]!;
      const body = parts[i + 1]!.split(/^(?:export |const |function |async function |\/\*)/m)[0]!;
      out.push({
        id: `${file.replace(/^src\/app\//, "")}:${name}`,
        file,
        name,
        text: withHelpers(body, helpers),
      });
    }
  }
  return out;
}

export const publicFns = (): PublicFn[] => allServerFns().filter((f) => !GUARD.test(f.text));
