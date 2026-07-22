import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;
const as = nlp.as;

const stopTerms = new Set([
  "ability",
  "application",
  "applications",
  "company",
  "experience",
  "qualification",
  "qualifications",
  "responsibility",
  "responsibilities",
  "software",
  "system",
  "systems",
  "team",
  "tools",
  "work",
  "working"
]);

function normalizeTerm(value: string) {
  return value
    .replace(/[^\w+#./ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(normalizeTerm).filter(Boolean)));
}

export function extractNlpTerms(text: string) {
  const doc = nlp.readDoc(text);
  const nounLikeTerms = doc
    .tokens()
    .filter((token) => {
      const pos = token.out(its.pos);
      const normal = token.out(its.normal);
      return (
        !token.out(its.stopWordFlag) &&
        normal.length > 2 &&
        !stopTerms.has(normal.toLowerCase()) &&
        ["NOUN", "PROPN", "ADJ"].includes(pos)
      );
    })
    .out(its.normal, as.freqTable) as Array<[string, number]>;

  const entities = doc.entities().out(its.value) as string[];

  return unique([
    ...entities,
    ...nounLikeTerms
      .filter(([, count]) => count > 1)
      .map(([term]) => term)
      .slice(0, 24)
  ]);
}

export function extractSentenceCandidates(text: string, pattern: RegExp) {
  const doc = nlp.readDoc(text);
  return unique(
    (doc.sentences().out() as string[]).filter((sentence) => pattern.test(sentence))
  ).slice(0, 8);
}
