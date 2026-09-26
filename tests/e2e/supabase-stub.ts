/**
 * Подставная Supabase для сквозного прогона в CI: ключей настоящей базы там
 * нет, а живые тесты ходят в прод. Отвечает как пустая база — любой выбор
 * даёт пустой список, запись проходит. Этого хватает, чтобы проверить, что
 * собранное приложение поднимается, страницы рисуются, а серверные функции
 * и маршруты /api отвечают, а не падают целиком, как после #30.
 */
import { createServer } from "node:http";

export function startSupabaseStub(port: number) {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const accept = String(req.headers.accept ?? "");
      res.setHeader("content-type", "application/json");
      // .single(): одной строки нет — как PostgREST.
      if (accept.includes("vnd.pgrst.object")) {
        res.statusCode = 406;
        res.end(JSON.stringify({ code: "PGRST116", message: "0 rows", details: null, hint: null }));
        return;
      }
      if (req.url?.startsWith("/storage/")) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_found", message: "Object not found" }));
        return;
      }
      if (req.url?.startsWith("/rest/v1/rpc/")) {
        res.end("null");
        return;
      }
      res.statusCode = req.method === "GET" || req.method === "HEAD" ? 200 : 201;
      res.end("[]");
    });
  });
  return new Promise<() => Promise<void>>((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve(() => new Promise<void>((r) => server.close(() => r()))),
    ),
  );
}
