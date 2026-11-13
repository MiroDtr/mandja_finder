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

export async function openPdf(file: File) {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await task.promise;
  return {
    pageCount: pdf.numPages,
    /** Renders one page (1-based) to a base64 JPEG. */
    async renderPage(pageNumber: number): Promise<string> {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 2000 / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const data = toBase64(canvas, 0.8);
      page.cleanup();
      return data;
    },
    close: () => void task.destroy(),
  };
}
