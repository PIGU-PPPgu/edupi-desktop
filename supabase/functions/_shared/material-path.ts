const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeMaterialId(value: unknown): string | null {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 160
    || value === "." || value === ".."
    || !/^[\p{L}\p{N}._-]+$/u.test(value)
  ) return null;
  return value;
}

export function materialUploadObjectKey(
  workspaceId: string,
  materialId: unknown,
  fileName: string,
): string | null {
  const safeId = safeMaterialId(materialId);
  if (
    !UUID.test(workspaceId) || !safeId
    || !fileName || fileName.length > 180 || fileName === "." || fileName === ".."
    || !/^[\p{L}\p{N}._ -]+$/u.test(fileName)
  ) return null;

  const objectKey = `${workspaceId}/${safeId}/${crypto.randomUUID()}-${fileName}`;
  // Check the path as the Storage HTTP request will see it, after URL normalization.
  const normalizedPath = decodeURIComponent(
    new URL(`/${objectKey}`, "https://edupi-storage.invalid").pathname,
  );
  return normalizedPath === `/${objectKey}` ? objectKey : null;
}
