import { Router } from "express";

const router = Router();

router.get("/:z/:x/:y.png", async (req, res) => {
  const { z, x, y } = req.params;
  if (![z, x, y].every((value) => /^\d+$/.test(value))) {
    res.status(400).json({ error: "Invalid tile coordinates" });
    return;
  }

  const upstream = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { "User-Agent": "MovilApp/1.0 map tiles" },
    });
  } catch (error) {
    console.error("Map tile upstream request failed", { z, x, y, error });
    res.status(502).json({ error: "Map tile upstream unavailable" });
    return;
  }

  if (!response.ok) {
    res.status(response.status).end();
    return;
  }

  res.setHeader("Content-Type", response.headers.get("content-type") ?? "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(await response.arrayBuffer()));
});

export default router;
