import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

const REQUIRED_FIELDS = [
  'designType',
  'title',
  'brief',
  'aesthetics',
  'reference',
  'intent',
];

const SYSTEM_PROMPT = `You analyse website designs for a designer's inspiration library.

Write the aesthetics, reference, and intent fields as prose that will be pasted
directly into a coding session as build instructions. Be concrete and specific:
name typefaces, hex values, spacing rhythm, and layout structure rather than
using vague adjectives. Write in the present tense and avoid hedging.

When measured facts about the page are supplied, treat them as ground truth and
use those exact values rather than estimating from the image.`;

function buildPrompt(imagePath, facts) {
  const parts = [
    `Read the image at ${imagePath} and analyse the website design it shows.`,
  ];

  if (facts) {
    parts.push(
      'Measured facts extracted from the live page (ground truth):\n' +
        '```json\n' +
        JSON.stringify(facts, null, 2) +
        '\n```'
    );
  }

  parts.push(
    'Reply with a single JSON object and nothing else. Every field is required ' +
      'and every value is a string:\n' +
      '{\n' +
      '  "designType": "a short design-category label, 1-3 words, title case ' +
      '(Editorial, Brutalist, SaaS Landing, Portfolio, Agency)",\n' +
      '  "title": "a short name for this reference — the brand or site name if visible",\n' +
      '  "brief": "two or three sentences summarising what this design is and does",\n' +
      '  "aesthetics": "the concrete visual language: typography, colour, spacing, ' +
      'imagery, motion. Name specific fonts and hex values when known",\n' +
      '  "reference": "what specifically to borrow, and which parts of the page",\n' +
      '  "intent": "how the site feels and what that feeling does for its audience"\n' +
      '}'
  );

  return parts.join('\n\n');
}

/**
 * Run the Claude Code CLI and collect its output. Replaced in tests so the
 * suite never spawns a real process.
 */
function runClaude(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (cause) =>
      reject(
        new Error(
          'Could not run the `claude` CLI. Install Claude Code and make sure ' +
            '`claude` is on PATH.',
          { cause }
        )
      )
    );
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Pull the first JSON object out of a block of text. Claude Code returns prose
 * by design, so the JSON may arrive fenced or with a sentence in front of it.
 */
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Analyse an image with the Claude Code CLI instead of the Anthropic API, so
 * the call is billed against a Claude subscription rather than API credits.
 * Same shape as analyzeImage in analyze.js, so it drops into createApp as
 * analyzeFn without any other change.
 */
export async function analyzeImageViaCli({
  imagePath,
  facts = null,
  runFn = runClaude,
  model = 'opus',
}) {
  const args = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    // Read is the only tool this needs, and only inside the image directory.
    '--allowedTools', 'Read',
    '--add-dir', dirname(imagePath),
    '--system-prompt', SYSTEM_PROMPT,
    buildPrompt(imagePath, facts),
  ];

  const { code, stdout, stderr } = await runFn(args);

  if (code !== 0) {
    throw new Error(
      `Claude Code exited with code ${code}: ${stderr.trim() || 'no error output'}`
    );
  }

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error('Claude Code did not return valid JSON for this image.');
  }

  if (envelope.is_error) {
    throw new Error(`Claude Code reported an error: ${envelope.result}`);
  }

  const result = extractJson(String(envelope.result ?? ''));
  if (!result) {
    throw new Error('Claude Code did not return valid JSON for this image.');
  }

  const missing = REQUIRED_FIELDS.filter((key) => !result[key]);
  if (missing.length > 0) {
    throw new Error(`Analysis was missing fields: ${missing.join(', ')}.`);
  }

  return Object.fromEntries(REQUIRED_FIELDS.map((key) => [key, result[key]]));
}
