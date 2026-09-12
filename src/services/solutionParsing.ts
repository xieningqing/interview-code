/**
 * Pure parsing helpers for model output.
 *
 * Kept free of Electron/OpenAI imports so the behaviour can be tested directly
 * (see scripts/test-solution-parsing.js). The parsing ladder is:
 *   1. strict JSON object
 *   2. field-by-field extraction from truncated JSON
 *   3. raw fallback that preserves the model output verbatim
 */

export type QuestionType = 'coding' | 'single_choice' | 'multiple_choice' | 'short_answer' | 'unknown';

export interface ProcessedSolution {
  questionType: QuestionType;
  answer: string;
  explanation: string;
  approach: string;
  code: string;
  timeComplexity: string;
  spaceComplexity: string;
  /** Set when the model output could not be parsed as JSON and is shown as-is. */
  rawOutput?: boolean;
}

export interface CompletionOutcome {
  content: string;
  reasoning: string;
  finishReason: string | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
}

const CODE_FENCE_PATTERN = /```[a-zA-Z0-9+#.\-]*[ \t]*\r?\n([\s\S]*?)```/g;

export function extractCodeFences(source: string): string[] {
  const blocks: string[] = [];

  for (const match of source.matchAll(CODE_FENCE_PATTERN)) {
    const block = match[1].replace(/\s+$/, '');
    if (block.trim()) blocks.push(block);
  }

  return blocks;
}

export function stripCodeFences(source: string): string {
  return source.replace(CODE_FENCE_PATTERN, '').trim();
}

export function hasMeaningfulResponse(solution: Partial<ProcessedSolution>): boolean {
  return [
    solution.answer,
    solution.explanation,
    solution.approach,
    solution.code,
    solution.timeComplexity,
    solution.spaceComplexity
  ].some(value => typeof value === 'string' && value.trim().length > 0);
}

export function normalizeQuestionType(value: unknown): QuestionType {
  switch (String(value || '').toLowerCase().replace(/-/g, '_').replace(/ /g, '_')) {
    case 'coding':
      return 'coding';
    case 'single':
    case 'single_choice':
    case 'singlechoice':
    case 'mcq_single':
      return 'single_choice';
    case 'multiple':
    case 'multiple_choice':
    case 'multiplechoice':
    case 'mcq':
    case 'mcq_multiple':
      return 'multiple_choice';
    case 'short_answer':
    case 'shortanswer':
      return 'short_answer';
    default:
      return 'unknown';
  }
}

export function normalizeProcessedSolution(
  solution: Partial<ProcessedSolution>
): ProcessedSolution {
  const explanation = solution.explanation || solution.approach || '';
  const questionType = normalizeQuestionType(solution.questionType);
  const inferredQuestionType = questionType !== 'unknown'
    ? questionType
    : solution.code
      ? 'coding'
      : 'unknown';

  return {
    questionType: inferredQuestionType,
    answer: solution.answer || '',
    explanation,
    approach: explanation,
    code: solution.code || '',
    timeComplexity: solution.timeComplexity || '',
    spaceComplexity: solution.spaceComplexity || '',
    rawOutput: solution.rawOutput === true ? true : undefined
  };
}

export function readPartialJsonStringValue(source: string, key: keyof ProcessedSolution) {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex === -1) return '';

  const colonIndex = source.indexOf(':', keyIndex);
  if (colonIndex === -1) return '';

  // Only a quoted string can be read safely here. Without this guard a value like
  // `"answer": null` would jump to the next field's opening quote and copy its name.
  let quoteIndex = colonIndex + 1;
  while (quoteIndex < source.length && /\s/.test(source[quoteIndex])) {
    quoteIndex += 1;
  }
  if (source[quoteIndex] !== '"') return '';

  let value = '';
  let escaping = false;

  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];

    if (escaping) {
      switch (char) {
        case 'n':
          value += '\n';
          break;
        case 'r':
          value += '\r';
          break;
        case 't':
          value += '\t';
          break;
        case '"':
          value += '"';
          break;
        case '\\':
          value += '\\';
          break;
        default:
          value += char;
          break;
      }
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') break;
    value += char;
  }

  return value;
}

export function extractBalancedJsonObject(source: string): string | null {
  const startIndex = source.indexOf('{');
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === '\\') {
        escaping = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

/**
 * Strict JSON first, then field-by-field extraction so a truncated response still
 * yields as much structured content as it contains. Returns null only when there is
 * nothing usable at all - callers then fall back to the raw output.
 */
export function tryParseSolution(content: string): ProcessedSolution | null {
  if (!content.trim()) return null;

  const rawQuestionType = readPartialJsonStringValue(content, 'questionType');
  const fallback: Partial<ProcessedSolution> = {
    questionType: rawQuestionType ? normalizeQuestionType(rawQuestionType) : undefined,
    answer: readPartialJsonStringValue(content, 'answer'),
    explanation: readPartialJsonStringValue(content, 'explanation'),
    approach: readPartialJsonStringValue(content, 'approach'),
    code: readPartialJsonStringValue(content, 'code'),
    timeComplexity: readPartialJsonStringValue(content, 'timeComplexity'),
    spaceComplexity: readPartialJsonStringValue(content, 'spaceComplexity')
  };

  const jsonText = extractBalancedJsonObject(content);

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Partial<ProcessedSolution>;
      const parsedSolution: Partial<ProcessedSolution> = {
        questionType: parsed.questionType || fallback.questionType,
        answer: parsed.answer || fallback.answer,
        explanation: parsed.explanation || fallback.explanation,
        approach: parsed.approach || fallback.approach,
        code: parsed.code || fallback.code,
        timeComplexity: parsed.timeComplexity || fallback.timeComplexity,
        spaceComplexity: parsed.spaceComplexity || fallback.spaceComplexity
      };

      // Anything the model wrote outside the JSON object must not be thrown away.
      // Fence markers are stripped first so ```json wrappers leave nothing behind.
      const leftover = stripCodeFences(content.replace(jsonText, '\n'));
      if (leftover) {
        parsedSolution.explanation = [parsedSolution.explanation, leftover]
          .filter(Boolean)
          .join('\n\n');
      }

      if (hasMeaningfulResponse(parsedSolution)) {
        return normalizeProcessedSolution(parsedSolution);
      }
    } catch (error) {
      console.warn('Strict JSON parsing failed, falling back to partial extraction:', error);
    }
  }

  if (hasMeaningfulResponse(fallback)) {
    return normalizeProcessedSolution(fallback);
  }

  return null;
}

export interface RawFallbackOptions {
  content: string;
  reasoning: string;
  /** Only the final fallback may surface reasoning; per-attempt retries must not. */
  allowReasoning: boolean;
}

/**
 * Last resort: never discard what the model produced.
 *
 * - code fences are collected into `code` so they stay readable as code
 * - the remaining text goes to `explanation`
 * - text without any structure is kept verbatim in `answer`
 * - if the model produced no content at all, its reasoning is shown with a clear label
 */
export function buildFallbackSolution(options: RawFallbackOptions): ProcessedSolution | null {
  const text = options.content.trim();

  if (!text) {
    const thinking = options.reasoning.trim();
    if (!options.allowReasoning || !thinking) return null;

    return normalizeProcessedSolution({
      questionType: 'unknown',
      explanation: `【模型没有给出答案，以下只是它输出的思考过程原文】\n\n${thinking}`,
      rawOutput: true
    });
  }

  const codeBlocks = extractCodeFences(text);

  if (codeBlocks.length === 0) {
    // Nothing to split apart - keep every character of the raw output.
    return normalizeProcessedSolution({
      questionType: 'unknown',
      answer: text,
      rawOutput: true
    });
  }

  return normalizeProcessedSolution({
    questionType: 'coding',
    code: codeBlocks.join('\n\n'),
    explanation: stripCodeFences(text),
    rawOutput: true
  });
}

export function describeOutcome(outcome: CompletionOutcome | null): string {
  if (!outcome) return 'no response received';
  return [
    outcome.finishReason ? `finish_reason=${outcome.finishReason}` : '',
    outcome.completionTokens != null ? `completion_tokens=${outcome.completionTokens}` : '',
    outcome.reasoningTokens != null ? `reasoning_tokens=${outcome.reasoningTokens}` : '',
    `reasoning_chars=${outcome.reasoning.length}`,
    `content_chars=${outcome.content.length}`
  ].filter(Boolean).join(', ');
}
