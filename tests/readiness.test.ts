import { describe, expect, it } from "vitest";
import { ORDER_PATH, evaluate, parseInventory, readiness, run } from "../scripts/readiness.ts";

const MD = `# Опись

## Поломки, которые уже случились (1)

### fix(bot): не терять заказ

\`abc1234\`

Текст.

## Требования к поведению (3 проверок в 1 файлах)

### \`tests/a.test.ts\`

> Зачем.

- правило один
- правило два
- правило один
`;

const TEST = `it("по правилу один", () => {});`;
const read = (p: string) => (p === "tests/v2.test.ts" ? TEST : null);

describe("опись", () => {
  it("поломки и проверки по группам, повторы имени — с номером", () => {
    expect(parseInventory(MD)).toEqual([
      { group: "fix", key: "fix(bot): не терять заказ" },
      { group: "tests/a.test.ts", key: "правило один" },
      { group: "tests/a.test.ts", key: "правило два" },
      { group: "tests/a.test.ts", key: "правило один #2" },
    ]);
  });
});

describe("сопоставление", () => {
  const items = parseInventory(MD);

  it("тест, причины и «*» для остальных пунктов группы", () => {
    const { verdicts, errors } = evaluate(
      items,
      {
        fix: { "fix(bot): не терять заказ": "drop: бота нет" },
        "tests/a.test.ts": {
          "правило один": "tests/v2.test.ts › по правилу один",
          "*": "later: модуль не перенесён",
        },
      },
      read,
    );
    expect(errors).toEqual([]);
    expect(verdicts.map((v) => v.status)).toEqual(["drop", "covered", "later", "later"]);
  });

  it("не названное — дыра", () => {
    const { verdicts } = evaluate(items, {}, read);
    expect(verdicts.every((v) => v.status === "open")).toBe(true);
  });

  it("ошибка: несуществующий пункт, группа, файл, имя теста или формат", () => {
    const { errors } = evaluate(
      items,
      {
        "tests/a.test.ts": {
          "правило три": "drop: нет",
          "правило один": "tests/v2.test.ts › другое имя",
          "правило два": "tests/nope.test.ts › что-то",
          "правило один #2": "как-нибудь",
        },
        "tests/b.test.ts": {},
      },
      read,
    );
    expect(errors).toHaveLength(5);
  });

  it("готовность считается без «позже» и «не нужно»", () => {
    expect(readiness({ total: 10, covered: 3, open: 1, later: 4, drop: 2, live: 0 })).toBe(75);
    expect(readiness({ total: 1, covered: 0, open: 0, later: 1, drop: 0, live: 0 })).toBe(100);
  });
});

describe("docs/READINESS.md", () => {
  // Свежесть сводки не проверяется: каждый PR пересобирал docs/READINESS.md, и
  // открытые PR конфликтовали друг с другом после каждого слияния. Сводку
  // пересобирает отдельный PR (node scripts/readiness.ts), а здесь — только
  // что опись сопоставляется без ошибок: имена тестов и файлы существуют.
  it("сопоставление без ошибок (сводку пересобирает node scripts/readiness.ts)", () => {
    const r = run(process.cwd());
    expect(r.items.length).toBeGreaterThan(1000);
    expect(r.errors).toEqual([]);
  });

  it("файлы пути заказа есть в описи", () => {
    const groups = new Set(run(process.cwd()).items.map((i) => i.group));
    expect(ORDER_PATH.filter((g) => !groups.has(g))).toEqual([]);
  });
});
