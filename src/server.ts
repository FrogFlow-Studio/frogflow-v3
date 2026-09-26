type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let entry: Promise<ServerEntry> | undefined;

function getEntry(): Promise<ServerEntry> {
  if (!entry) {
    entry = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return entry;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      return await (await getEntry()).fetch(request, env, ctx);
    } catch (error) {
      const { reportError } = await import("@/lib/errors");
      await reportError(error, {
        where: "server",
        extra: { method: request.method, path: new URL(request.url).pathname },
      });
      return new Response("Внутренняя ошибка", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};
