export function appendTeacherInputSlot(reference: string, label: string): string {
  const normalizedReference = reference.trim();
  const normalizedLabel = label.trim();
  if (!normalizedReference || !normalizedLabel) throw new Error("AI prompt reference and teacher input label are required");
  return `${normalizedReference}\n如果这一栏留空，请只问我一个澄清问题。\n\n${normalizedLabel}\n`;
}
