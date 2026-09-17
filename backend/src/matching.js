// Ported verbatim from app.js's analyzeMatch()/tokenize()/buildJobVocabulary()
// (lines ~206-264) so the server computes exactly the same match score the
// client used to compute in the browser. This is the same cosine-similarity
// term-frequency approach — not a real AI/ML model, no external API calls —
// per the app's own comment. Kept identical on purpose: TRACE, DON'T INVENT.

const STOPWORDS = new Set([
  "the", "and", "for", "are", "with", "you", "your", "our", "will", "have", "has", "that", "this", "from",
  "into", "able", "who", "can", "all", "any", "not", "but", "was", "were", "been", "being", "such", "than",
  "then", "them", "they", "their", "there", "here", "what", "when", "where", "which", "while", "about",
  "above", "after", "again", "against", "each", "few", "more", "most", "other", "some", "own", "same",
  "should", "would", "could", "also", "etc", "job", "role", "position", "work", "working", "company",
  "team", "candidate", "candidates", "applicant", "applicants", "must", "need", "needed", "including",
  "include", "includes", "years", "year", "using", "use", "used", "within", "well", "good", "strong",
  "ability", "responsibilities", "requirements", "responsible", "experience",
]);

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").split(/\s+/)
    .map((w) => w.trim().replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function buildJobVocabulary(description, requirements) {
  const weights = {};
  tokenize(description).forEach((w) => (weights[w] = (weights[w] || 0) + 1));
  tokenize(requirements).forEach((w) => (weights[w] = (weights[w] || 0) + 2.5));
  return weights;
}

function analyzeMatch(description, requirements, resumeText) {
  const jobWeights = buildJobVocabulary(description, requirements);
  const jobVocab = Object.keys(jobWeights);
  const resumeTokens = tokenize(resumeText);
  const resumeTF = {};
  resumeTokens.forEach((t) => (resumeTF[t] = (resumeTF[t] || 0) + 1));
  if (jobVocab.length === 0 || resumeTokens.length === 0) {
    return { score: 0, matchedKeywords: [], missingKeywords: jobVocab.slice(0, 8) };
  }
  let dot = 0, jobMag = 0, resumeMag = 0;
  jobVocab.forEach((term) => {
    const jobVal = jobWeights[term];
    const resumeVal = resumeTF[term] ? 1 + Math.log(resumeTF[term]) : 0;
    dot += jobVal * resumeVal; jobMag += jobVal * jobVal; resumeMag += resumeVal * resumeVal;
  });
  let cosine = 0;
  if (jobMag > 0 && resumeMag > 0) cosine = dot / (Math.sqrt(jobMag) * Math.sqrt(resumeMag));
  const score = Math.round(Math.min(1, cosine) * 100);
  const sorted = [...jobVocab].sort((a, b) => jobWeights[b] - jobWeights[a]);
  return {
    score,
    matchedKeywords: sorted.filter((t) => resumeTF[t]).slice(0, 8),
    missingKeywords: sorted.filter((t) => !resumeTF[t]).slice(0, 8),
  };
}

// Ported from analyzeCVToCVSimilarity() (app.js ~line 273) — used by
// PB-07 CV-to-CV Similarity Comparison.
function analyzeCVToCVSimilarity(resumeTextA, resumeTextB) {
  const aTokens = tokenize(resumeTextA);
  const bTokens = tokenize(resumeTextB);
  if (!aTokens.length || !bTokens.length) return 0;

  const aTF = {}, bTF = {};
  aTokens.forEach((t) => (aTF[t] = (aTF[t] || 0) + 1));
  bTokens.forEach((t) => (bTF[t] = (bTF[t] || 0) + 1));

  const vocabulary = new Set([...Object.keys(aTF), ...Object.keys(bTF)]);
  let dot = 0, aMag = 0, bMag = 0;
  vocabulary.forEach((term) => {
    const aVal = aTF[term] ? 1 + Math.log(aTF[term]) : 0;
    const bVal = bTF[term] ? 1 + Math.log(bTF[term]) : 0;
    dot += aVal * bVal;
    aMag += aVal * aVal;
    bMag += bVal * bVal;
  });

  if (!aMag || !bMag) return 0;
  return Math.round((dot / (Math.sqrt(aMag) * Math.sqrt(bMag))) * 100);
}

module.exports = { analyzeMatch, analyzeCVToCVSimilarity, tokenize };
