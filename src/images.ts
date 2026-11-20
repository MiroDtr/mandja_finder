import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function toBase64(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

function drawScaled(source: CanvasImageSource, width: number, height: number, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A photo, downscaled for the AI, plus a small thumbnail data URL. */
export async function preparePhoto(file: File): Promise<{ image: string; thumb: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const image = toBase64(drawScaled(bitmap, bitmap.width, bitmap.height, 1568), 0.85);
  const thumb = drawScaled(bitmap, bitmap.width, bitmap.height, 160).toDataURL("image/jpeg", 0.7);
  bitmap.close();
  return { image, thumb };
}

interface TextItem {
  str: string;
  transform: number[];
}

/** Same layout as scripts/offers.mjs: one line per row, each piece tagged with its x position in %. */
function layoutText(items: TextItem[], viewport: pdfjs.PageViewport): string {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    const s = it.str?.trim();
    if (!s) continue;
    const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    const py = (y / viewport.height) * 100;
    let row = rows.find((r) => Math.abs(r.y - py) < 0.8);
    if (!row) rows.push((row = { y: py, parts: [] }));
    row.parts.push({ x: Math.round((x / viewport.width) * 100), s });
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .map((r) => `y${Math.round(r.y)}: ` + r.parts.sort((a, b) => a.x - b.x).map((p) => `[x${p.x}] ${p.s}`).join("  "))
    .join("\n");
}

export async function openPdf(file: File) {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await task.promise;
  return {
    pageCount: pdf.numPages,
    /**
     * One page (1-based) as a base64 JPEG plus its text layer laid out by position.
     * Returns null for pages whose text has no prices (covers, ads) so they are not sent to the AI.
     */
    async readPage(pageNumber: number): Promise<{ image: string; text: string } | null> {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const text = layoutText((await page.getTextContent()).items as TextItem[], base);
      if (text.length > 40 && !/\d+[.,]\d{2}/.test(text)) {
        page.cleanup();
        return null;
      }
      const viewport = page.getViewport({ scale: 1400 / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const image = toBase64(canvas, 0.8);
      page.cleanup();
      return { image, text: text.length > 40 ? text : "" };
    },
    close: () => void task.destroy(),
  };
}
