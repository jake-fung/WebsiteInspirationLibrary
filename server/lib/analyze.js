import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    designType: {
      type: 'string',
      description:
        'A short design-category label, 1-3 words, title case. ' +
        'For example: Editorial, Brutalist, SaaS Landing, Portfolio, Agency.',
    },
    title: {
      type: 'string',
      description: 'A short name for this reference — the brand or site name if visible.',
    },
    brief: {
      type: 'string',
      description: 'Two or three sentences summarising what this design is and does.',
    },
    aesthetics: {
      type: 'string',
      description:
        'The concrete visual language: typography, colour, spacing, imagery, motion. ' +
        'Name specific fonts and hex values when they are known.',
    },
    reference: {
      type: 'string',
      description: 'What specifically to borrow from this design, and which parts of the page.',
    },
    intent: {
      type: 'string',
      description: 'How the site feels and what that feeling is doing for its audience.',
    },
  },
  required: ['designType', 'title', 'brief', 'aesthetics', 'reference', 'intent'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You analyse website designs for a designer's inspiration library.

Write the aesthetics, reference, and intent fields as prose that will be pasted
directly into a coding session as build instructions. Be concrete and specific:
name typefaces, hex values, spacing rhythm, and layout structure rather than
using vague adjectives. Write in the present tense and avoid hedging.

When measured facts about the page are supplied, treat them as ground truth and
use those exact values rather than estimating from the image.`;

export function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

export function mediaTypeFor(filePath) {
  const type = MEDIA_TYPES[extname(filePath).toLowerCase()];
  if (!type) throw new Error(`Unsupported image type: ${extname(filePath) || filePath}`);
  return type;
}

function factsBlock(facts) {
  if (!facts) return null;
  return {
    type: 'text',
    text:
      'Measured facts extracted from the live page (ground truth):\n' +
      '```json\n' +
      JSON.stringify(facts, null, 2) +
      '\n```',
  };
}

export async function analyzeImage({ imagePath, facts = null, client }) {
  if (!client) {
    throw new Error(
      'No Anthropic client configured. Set ANTHROPIC_API_KEY in .env to enable AI drafting.'
    );
  }

  const data = (await readFile(imagePath)).toString('base64');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(imagePath), data } },
  ];

  const block = factsBlock(facts);
  if (block) content.push(block);

  content.push({
    type: 'text',
    text: 'Analyse this website design and fill in every field.',
  });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 24000,
    // Thinking is on by default on Opus 5 and shares the max_tokens budget with
    // the response text. Low effort suits a perception task and leaves the
    // budget comfortably clear of the JSON.
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
    },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? 'unspecified';
    throw new Error(`Claude declined to analyze this image (${category}).`);
  }

  // Must precede the JSON.parse below: a truncated response is still parseable-
  // looking text, and reporting it as malformed JSON sends you debugging the
  // wrong thing.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'Analysis ran out of output budget before finishing. Retry, or raise max_tokens.'
    );
  }

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Claude did not return valid JSON for this image.');
  }
}
