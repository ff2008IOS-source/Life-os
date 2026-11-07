import { plainStudyText } from "./academic-context";
const stop = new Set([
  "what",
  "about",
  "next",
  "topics",
  "should",
  "study",
  "hello",
  "please",
  "this",
  "that",
  "with",
  "have",
  "does",
  "will",
  "want",
  "need",
]);
export function materialRelevance(
  title: string,
  body: string,
  question: string,
  assessment: string,
) {
  const text = plainStudyText(body, 40000);
  const terms =
    (question + " " + assessment)
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter((t) => !stop.has(t)) ?? [];
  const scope =
    /midterm|exam|test|cover(?:age|s|ed)?|chapters?|study guide|syllabus|review/i;
  let score = scope.test(title) ? 8 : 0;
  score += scope.test(text) ? 4 : 0;
  for (const t of new Set(terms))
    score +=
      (title.toLowerCase().includes(t) ? 4 : 0) +
      (text.toLowerCase().includes(t) ? 1 : 0);
  const expected = assessment.match(/(?:exam|midterm|test)\s*#?\s*(\d+)/i)?.[1];
  const actual = title.match(/(?:exam|midterm|test)\s*#?\s*(\d+)/i)?.[1];
  if (expected && actual && expected !== actual)
    return { score: 0, excerpt: "" };
  const paragraphs = text.split(/(?<=[.!?])\s+|\n+/);
  let best = 0,
    bestScore = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const n =
      (/cover|chapters?|tested|units|include|scope/i.test(p)
        ? 10
        : scope.test(p)
          ? 2
          : 0) + terms.filter((t) => p.toLowerCase().includes(t)).length;
    if (n > bestScore) {
      best = i;
      bestScore = n;
    }
  }
  const position = text.indexOf(paragraphs[best] ?? "");
  const start = Math.max(0, position - 150);
  return { score, excerpt: text.slice(start, start + 1200) };
}
