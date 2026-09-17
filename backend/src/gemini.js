// CV Quality Score via Gemini — separate from matching.js's analyzeMatch()
// (which is plain TF/cosine similarity against a job's description, no AI
// call). This module sends the CV text + job context to Gemini and asks for
// a rubric-scored quality assessment, not a job-match percentage.
//
// Rubric (must sum to 100, mirrors the weights agreed with the team):
//   educationScore    (0-20)  degree level: none/diploma/bachelor's/master's/PhD
//   experienceScore   (0-25)  relevance + years of job-title-matching experience
//   skillsScore       (0-20)  overlap between CV skills and the job's requirements
//   certificationScore(0-10)  relevant professional certifications mentioned
//   structureScore    (0-15)  clear sections, dates, contact info, completeness
//   achievementScore  (0-10)  quantified/measurable outcomes vs. vague duty lists
//
// GEMINI_API_KEY must be set in backend/.env — this call only ever happens
// server-side (never expose the key to the frontend).

const MODEL = "gemini-2.0-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const RUBRIC_PROMPT = `You are scoring a candidate's CV for overall quality using a fixed rubric. This is NOT about whether the candidate fits the job's skills exactly — that is scored elsewhere. Score honestly based only on what is written in the CV text below.

Job title: {{jobTitle}}
Job requirements (for skills/experience relevance context only): {{jobRequirements}}

CV text:
"""
{{resumeText}}
"""

Score the CV using EXACTLY this rubric (integers only, each within its max):
- educationScore (0-20): 0 = no degree mentioned, 8 = diploma, 14 = bachelor's degree, 18 = master's/MSc, 20 = PhD/doctorate.
- experienceScore (0-25): based on how many years and how directly the candidate's past job titles/roles relate to "{{jobTitle}}".
- skillsScore (0-20): based on how many skills/technologies from the job requirements appear in the CV.
- certificationScore (0-10): relevant professional certifications explicitly mentioned (0 if none).
- structureScore (0-15): CV completeness and clarity — has contact info, clear sections (education/experience/skills), consistent dates.
- achievementScore (0-10): quantified/measurable outcomes (e.g. "increased X by 30%", "led a team of 5") vs. vague generic duty descriptions.

Respond with ONLY valid JSON, no markdown fences, no extra text, in exactly this shape:
{"educationScore":0,"experienceScore":0,"skillsScore":0,"certificationScore":0,"structureScore":0,"achievementScore":0,"reasoning":"one short paragraph explaining the scores"}`;

function buildPrompt(jobTitle, jobRequirements, resumeText) {
  return RUBRIC_PROMPT
    .replace(/{{jobTitle}}/g, jobTitle || "Unspecified role")
    .replace(/{{jobRequirements}}/g, jobRequirements || "Not specified")
    .replace("{{resumeText}}", (resumeText || "").slice(0, 12000)); // keep prompt bounded
}

const MAX_SCORES = {
  educationScore: 20,
  experienceScore: 25,
  skillsScore: 20,
  certificationScore: 10,
  structureScore: 15,
  achievementScore: 10,
};

function clampScores(raw) {
  const out = {};
  for (const [key, max] of Object.entries(MAX_SCORES)) {
    const n = Number(raw[key]);
    out[key] = Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
  }
  out.reasoning = typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 2000) : "";
  return out;
}

// Throws on any failure (missing key, network error, bad response shape) —
// the route calling this is responsible for turning that into a clean HTTP
// error so a Gemini outage never corrupts applicant data or blocks the rest
// of the app (this feature is HR-triggered and supplementary, not core path).
async function scoreCVQuality(jobTitle, jobRequirements, resumeText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in backend/.env — CV quality scoring is unavailable.");
  }
  if (!resumeText || !resumeText.trim()) {
    throw new Error("This applicant has no CV text to score.");
  }

  const prompt = buildPrompt(jobTitle, jobRequirements, resumeText);

  const response = await fetch(`${API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned a response that was not valid JSON.");
  }

  const scores = clampScores(parsed);
  const totalQualityScore = Object.keys(MAX_SCORES).reduce((sum, key) => sum + scores[key], 0);

  return { totalQualityScore, breakdown: scores };
}

module.exports = { scoreCVQuality, MAX_SCORES };
