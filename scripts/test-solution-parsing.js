/**
 * Deterministic tests for the model-output parsing ladder.
 * Run with: npm run test:parsing   (compiles first, then executes against dist/)
 *
 * No network and no Electron involved - these are pure functions, so the assertions
 * below are reproducible and can be run after any change to the parsing rules.
 */

const path = require('path');

const parsingPath = path.join(__dirname, '..', 'dist', 'services', 'solutionParsing.js');

let parsing;
try {
  parsing = require(parsingPath);
} catch (error) {
  console.error(`Could not load ${parsingPath}`);
  console.error('Run the TypeScript build first: npm run build');
  console.error(error.message);
  process.exit(1);
}

const { tryParseSolution, buildFallbackSolution, extractCodeFences } = parsing;

const FENCE = '```';
const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
  console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
}

function group(title) {
  console.log(`\n${title}`);
}

/** Every meaningful line of the original must survive somewhere in the result. */
function checkLossless(label, original, solution) {
  const combined = squash([solution.answer, solution.explanation, solution.code].join(' '));
  const missing = original
    .split('\n')
    .map(squash)
    .filter((line) => line && line !== FENCE && line !== `${FENCE}cpp` && line !== `${FENCE}java`)
    .filter((line) => !combined.includes(line));

  check(`${label}: no content lost`, missing.length === 0, missing.length ? `missing: ${JSON.stringify(missing)}` : undefined);
}

// ---------------------------------------------------------------------------
group('1. Well-formed JSON keeps the structured path (no raw fallback)');

const validJson = JSON.stringify({
  questionType: 'coding',
  answer: '',
  explanation: 'Use a hash map plus a doubly linked list.',
  code: 'class LRUCache {};',
  timeComplexity: 'O(1)',
  spaceComplexity: 'O(n)'
});

const structured = tryParseSolution(validJson);
check('parses', Boolean(structured));
check('questionType is coding', structured && structured.questionType === 'coding');
check('code parsed', structured && structured.code === 'class LRUCache {};');
check('explanation parsed', structured && structured.explanation.startsWith('Use a hash map'));
check('complexity parsed', structured && structured.timeComplexity === 'O(1)' && structured.spaceComplexity === 'O(n)');
check('not marked as raw output', structured && !structured.rawOutput);

// ---------------------------------------------------------------------------
group('2. Truncated JSON still yields the fields that were emitted');

const truncated =
  '{"questionType":"coding","answer":"","explanation":"Sliding window over the string.",'
  + '"code":"int main() {\\n  unordered_map<int,int> seen;\\n';

const partial = tryParseSolution(truncated);
check('parses partially', Boolean(partial));
check('explanation recovered', partial && partial.explanation === 'Sliding window over the string.');
check('truncated code recovered', partial && partial.code.includes('unordered_map<int,int> seen;'));
check('not marked as raw output', partial && !partial.rawOutput);

// ---------------------------------------------------------------------------
group('3. Non-string values must not bleed into the next field');

const nullValue =
  '{"questionType":"coding","answer":null,"explanation":"Two pointers.","code":"void f(){}",'
  + '"timeComplexity":"O(n)","spaceComplexity":"O(1)"}';

const nullParsed = tryParseSolution(nullValue);
check('parses', Boolean(nullParsed));
check('answer stays empty instead of becoming a key name', nullParsed && nullParsed.answer === '', nullParsed ? `got ${JSON.stringify(nullParsed.answer)}` : undefined);
check('explanation intact', nullParsed && nullParsed.explanation === 'Two pointers.');

const nullTruncated = '{"questionType":"coding","answer":null,"explanation":"Two pointers."';
const nullPartial = tryParseSolution(nullTruncated);
check('partial path: answer stays empty', nullPartial && nullPartial.answer === '', nullPartial ? `got ${JSON.stringify(nullPartial.answer)}` : undefined);
check('partial path: explanation intact', nullPartial && nullPartial.explanation === 'Two pointers.');

// ---------------------------------------------------------------------------
group('4. Markdown answer with two code blocks keeps both blocks and all prose');

const markdown = [
  'Approach: keep a hash map from key to list node.',
  '',
  `${FENCE}cpp`,
  'class LRUCache {};',
  FENCE,
  '',
  'Time complexity: O(1) per operation, space complexity: O(capacity).',
  '',
  `${FENCE}cpp`,
  'int main() { return 0; }',
  FENCE
].join('\n');

const rawFallback = buildFallbackSolution({ content: markdown, reasoning: '', allowReasoning: false });
check('produces a result', Boolean(rawFallback));
check('marked as raw output', rawFallback && rawFallback.rawOutput === true);
check('classified as coding', rawFallback && rawFallback.questionType === 'coding');
check('first code block kept', rawFallback && rawFallback.code.includes('class LRUCache {};'));
check('second code block kept', rawFallback && rawFallback.code.includes('int main() { return 0; }'));
check('prose kept', rawFallback && rawFallback.explanation.includes('Approach: keep a hash map'));
check('interstitial prose kept', rawFallback && rawFallback.explanation.includes('Time complexity: O(1) per operation'));
if (rawFallback) checkLossless('markdown', markdown, rawFallback);

// ---------------------------------------------------------------------------
group('5. Short plain-text answer is returned, never discarded');

const shortProse = 'Use a hash map.';
const shortResult = buildFallbackSolution({ content: shortProse, reasoning: '', allowReasoning: false });
check('short text still produces a result', Boolean(shortResult));
check('short text preserved verbatim', shortResult && shortResult.answer === shortProse);
check('marked as raw output', shortResult && shortResult.rawOutput === true);

// ---------------------------------------------------------------------------
group('6. Unparseable garbage is preserved verbatim');

const garbage = "{ 'answer': something broken, 'code': [1,2";
const garbageResult = buildFallbackSolution({ content: garbage, reasoning: '', allowReasoning: false });
check('produces a result', Boolean(garbageResult));
check('text preserved verbatim', garbageResult && garbageResult.answer === garbage, garbageResult ? `got ${JSON.stringify(garbageResult.answer)}` : undefined);
check('no structured parse', tryParseSolution(garbage) === null);
if (garbageResult) checkLossless('garbage', garbage, garbageResult);

// ---------------------------------------------------------------------------
group('7. Reasoning is only used as the very last resort');

const emptyAttempt = buildFallbackSolution({ content: '', reasoning: 'thinking hard...', allowReasoning: false });
check('per-attempt retry does not use reasoning', emptyAttempt === null);

const lastResort = buildFallbackSolution({ content: '', reasoning: 'thinking hard...', allowReasoning: true });
check('final fallback uses reasoning', Boolean(lastResort));
check('reasoning preserved', lastResort && lastResort.explanation.includes('thinking hard...'));
check('reasoning is clearly labelled, not presented as an answer', lastResort && lastResort.explanation.includes('思考过程'));
check('no answer field filled from reasoning', lastResort && lastResort.answer === '');
check('marked as raw output', lastResort && lastResort.rawOutput === true);

const nothing = buildFallbackSolution({ content: '', reasoning: '', allowReasoning: true });
check('empty content and empty reasoning yields null (caller reports the error)', nothing === null);

check('whitespace-only content is treated as empty', buildFallbackSolution({ content: '   \n  ', reasoning: '', allowReasoning: false }) === null);

// ---------------------------------------------------------------------------
group('8. Code fence extraction handles multiple languages and skips empty blocks');

const fences = extractCodeFences('```python\nprint(1)\n```\n```java\nint a = 1;\n```\n```\n\n```');
check('two non-empty blocks extracted', fences.length === 2);
check('python block kept', fences[0] === 'print(1)');
check('java block kept', fences[1] === 'int a = 1;');

// ---------------------------------------------------------------------------
group('9. Text outside a valid JSON object is appended, not dropped');

const noteText = 'Note: the top of the screenshot was cut off, so the signature may differ.';
const jsonWithNote = `${validJson}\n\n${noteText}`;
const withNote = tryParseSolution(jsonWithNote);
check('parses', Boolean(withNote));
check('json fields kept', withNote && withNote.code === 'class LRUCache {};' && withNote.explanation.includes('Use a hash map'));
check('trailing note preserved', Boolean(withNote && withNote.explanation.includes('the top of the screenshot was cut off')));

const fencedJson = `${FENCE}json\n${validJson}\n${FENCE}`;
const fencedResult = tryParseSolution(fencedJson);
check('fenced JSON still parses', Boolean(fencedResult));
check('fenced JSON fields intact', fencedResult && fencedResult.code === 'class LRUCache {};');
check('no fence markers leak into the result', Boolean(fencedResult && !fencedResult.explanation.includes(FENCE)), fencedResult ? JSON.stringify(fencedResult.explanation) : undefined);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
