import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";

const host = "127.0.0.1";
const port = 3100;
const publicRoot = resolve(import.meta.dirname, "../apps/web/out");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function resolvePublicFile(pathname) {
  const normalizedPath = pathname.replace(/^\/+|\/+$/g, "");
  const requestedPath =
    normalizedPath.length === 0
      ? "index.html"
      : extname(normalizedPath).length > 0
        ? normalizedPath
        : `${normalizedPath}.html`;
  const filePath = resolve(publicRoot, requestedPath);
  const pathFromRoot = relative(publicRoot, filePath);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    return undefined;
  }

  return filePath;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}:${port}`).pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  const filePath = resolvePublicFile(pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new Error("Not a file");
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": fileStats.size,
      "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    if (pathname.includes("/__next.") && pathname.endsWith(".txt")) {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end();
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Static test server ready at http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
