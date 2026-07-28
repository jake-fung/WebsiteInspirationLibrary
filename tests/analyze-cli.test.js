import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImageViaCli } from '../server/lib/analyze-cli.js';

const GOOD_RESULT = {
  designType: 'Editorial',
  title: 'Kinfolk',
  brief: 'Editorial minimalism.',
  aesthetics: 'Warm off-white #FAF9F7, serif display.',
  reference: 'Hero and article index.',
  intent: 'Unhurried and considered.',
};

function stubRunner(output) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      return output;
    },
  };
}

const envelope = (text) => ({
  code: 0,
  stdout: JSON.stringify({ type: 'result', is_error: false, result: text }),
  stderr: '',
});

test('analyzeImageViaCli returns the parsed structured result', async () => {
  const runner = stubRunner(envelope(JSON.stringify(GOOD_RESULT)));
  const result = await analyzeImageViaCli({
    imagePath: '/tmp/shots/a.png',
    runFn: runner.run,
  });
  assert.deepEqual(result, GOOD_RESULT);
});

test('analyzeImageViaCli runs claude in print mode with json output', async () => {
  const runner = stubRunner(envelope(JSON.stringify(GOOD_RESULT)));
  await analyzeImageViaCli({ imagePath: '/tmp/shots/a.png', runFn: runner.run });

  const args = runner.calls[0];
  assert.ok(args.includes('--print'), 'must be non-interactive');
  assert.equal(args[args.indexOf('--output-format') + 1], 'json');
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
});

test('analyzeImageViaCli grants read access to the image only', async () => {
  const runner = stubRunner(envelope(JSON.stringify(GOOD_RESULT)));
  await analyzeImageViaCli({ imagePath: '/tmp/shots/a.png', runFn: runner.run });

  const args = runner.calls[0];
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read');
  assert.equal(args[args.indexOf('--add-dir') + 1], '/tmp/shots');
  assert.ok(
    args.some((a) => a.includes('/tmp/shots/a.png')),
    'the prompt must name the image path'
  );
});

test('analyzeImageViaCli includes extracted facts in the prompt', async () => {
  const runner = stubRunner(envelope(JSON.stringify(GOOD_RESULT)));
  await analyzeImageViaCli({
    imagePath: '/tmp/shots/a.png',
    facts: { colors: { background: '#FAF9F7' } },
    runFn: runner.run,
  });

  assert.ok(
    runner.calls[0].some((a) => a.includes('#FAF9F7')),
    'facts should be passed as ground truth'
  );
});

test('analyzeImageViaCli extracts JSON wrapped in prose or fences', async () => {
  const runner = stubRunner(
    envelope('Here you go:\n```json\n' + JSON.stringify(GOOD_RESULT) + '\n```\n')
  );
  const result = await analyzeImageViaCli({
    imagePath: '/tmp/shots/a.png',
    runFn: runner.run,
  });
  assert.deepEqual(result, GOOD_RESULT);
});

test('analyzeImageViaCli rejects a result missing required fields', async () => {
  const runner = stubRunner(envelope(JSON.stringify({ title: 'Kinfolk' })));
  await assert.rejects(
    () => analyzeImageViaCli({ imagePath: '/tmp/shots/a.png', runFn: runner.run }),
    /missing fields: designType, brief, aesthetics, reference, intent/
  );
});

test('analyzeImageViaCli reports a non-zero exit with the stderr text', async () => {
  const runner = stubRunner({ code: 1, stdout: '', stderr: 'Invalid API key' });
  await assert.rejects(
    () => analyzeImageViaCli({ imagePath: '/tmp/shots/a.png', runFn: runner.run }),
    /Claude Code exited with code 1: Invalid API key/
  );
});

test('analyzeImageViaCli reports an is_error envelope', async () => {
  const runner = stubRunner({
    code: 0,
    stdout: JSON.stringify({ type: 'result', is_error: true, result: 'rate limited' }),
    stderr: '',
  });
  await assert.rejects(
    () => analyzeImageViaCli({ imagePath: '/tmp/shots/a.png', runFn: runner.run }),
    /Claude Code reported an error: rate limited/
  );
});

test('analyzeImageViaCli reports unparseable output as such', async () => {
  const runner = stubRunner(envelope('no json at all'));
  await assert.rejects(
    () => analyzeImageViaCli({ imagePath: '/tmp/shots/a.png', runFn: runner.run }),
    /did not return valid JSON/
  );
});
