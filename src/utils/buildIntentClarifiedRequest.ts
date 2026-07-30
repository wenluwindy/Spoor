export function buildIntentClarifiedRequest(
  original: string,
  selectedQuestions: string[],
  extra: string | undefined,
  labels: { selectedIntro: string; extraSection: string },
): string {
  const parts = [original.trim()];
  if (selectedQuestions.length > 0) {
    parts.push('', labels.selectedIntro);
    for (const q of selectedQuestions) {
      parts.push(`- ${q}`);
    }
  }
  const tail = extra?.trim();
  if (tail) {
    parts.push('', `${labels.extraSection}：${tail}`);
  }
  return parts.join('\n');
}
