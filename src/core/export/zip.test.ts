import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readZip } from "../../../tests/zip-reader";
import { zipFiles } from "./zip";

describe("ZIP для полной выгрузки", () => {
  const files = [
    { name: "orders.csv", data: "\uFEFF№;Сумма\r\n1;5000" },
    { name: "покупатели.csv", data: "Имя\r\nАнна\r\n".repeat(2000) },
    { name: "empty.csv", data: "" },
  ];

  it("файлы читаются обратно байт в байт, имена в UTF-8", () => {
    const back = readZip(zipFiles(files));
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    for (const [i, f] of back.entries()) expect(f.data.toString("utf8")).toBe(files[i]!.data);
  });

  it("архив открывает обычный unzip (если он есть в системе)", () => {
    let hasUnzip = true;
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    try {
      writeFileSync(join(dir, "a.zip"), zipFiles(files));
      execFileSync("unzip", ["-t", "-q", join(dir, "a.zip")], { stdio: "ignore" });
      execFileSync("unzip", ["-q", join(dir, "a.zip"), "orders.csv", "-d", dir]);
      expect(readFileSync(join(dir, "orders.csv"), "utf8")).toBe(files[0]!.data);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
