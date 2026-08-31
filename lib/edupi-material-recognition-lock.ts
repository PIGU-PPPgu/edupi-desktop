const MAX_CONCURRENT_RECOGNITIONS = 2;

type RecognitionAdmissionState = { activeIds: Set<string>; activeCount: number };

declare global {
  var __edupiMaterialRecognitionAdmission: RecognitionAdmissionState | undefined;
}

export class MaterialRecognitionAdmissionError extends Error {
  constructor(public readonly code: "recognition_busy" | "recognition_capacity", message: string) {
    super(message);
    this.name = "MaterialRecognitionAdmissionError";
  }
}

function state(): RecognitionAdmissionState {
  return globalThis.__edupiMaterialRecognitionAdmission ||= { activeIds: new Set(), activeCount: 0 };
}

export async function withMaterialRecognitionLock<T>(stagingId: string, operation: () => Promise<T>): Promise<T> {
  const admission = state();
  if (admission.activeIds.has(stagingId)) throw new MaterialRecognitionAdmissionError("recognition_busy", "这份材料正在识别，请稍候。");
  if (admission.activeCount >= MAX_CONCURRENT_RECOGNITIONS) throw new MaterialRecognitionAdmissionError("recognition_capacity", "当前识别任务较多，请稍后重试。");
  admission.activeIds.add(stagingId);
  admission.activeCount += 1;
  try {
    return await operation();
  } finally {
    admission.activeIds.delete(stagingId);
    admission.activeCount = Math.max(0, admission.activeCount - 1);
  }
}
