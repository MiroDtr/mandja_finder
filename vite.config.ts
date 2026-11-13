import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// In development, serve the Netlify function at /api/ai straight from Vite,
// so `npm run dev` works without the Netlify CLI.
function devApi(): Plugin {
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use("/api/ai", async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const mod = await server.ssrLoadModule("/netlify/functions/ai.mts");
          const response: Response = await mod.default(
            new Request("http://localhost/api/ai", {
              method: req.method,
              headers: {
                "content-type": String(req.headers["content-type"] ?? ""),
                "x-app-password": String(req.headers["x-app-password"] ?? ""),
              },
              body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }
          res.end();
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), devApi()] };
});
