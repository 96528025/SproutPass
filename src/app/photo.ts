// OWNER: B4. Photo helpers shared by the real and mock adapters.

/** Re-encode an image as JPEG no larger than maxPx on its long side. null if the browser can't decode it. */
export async function shrinkToBlob(file: Blob, maxPx: number, quality = 0.85): Promise<Blob | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  } catch {
    return null;
  }
}

/** Big phone photos → ≤ maxPx JPEG File (uploads faster); small or undecodable files pass through. */
export async function shrinkForUpload(file: File, maxPx = 1280): Promise<File> {
  if (file.size < 600_000) return file;
  const blob = await shrinkToBlob(file, maxPx);
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

/** Small data: URL (mock only: survives the localStorage snapshot and shows in other tabs). */
export async function toSmallDataUrl(file: File, maxPx = 320): Promise<string> {
  const blob = (await shrinkToBlob(file, maxPx, 0.7)) ?? file;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
