import { app } from 'electron';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

const envPath = app.isPackaged
  ? path.join(path.dirname(process.execPath), '.env')
  : path.resolve(__dirname, '../../.env');

const envResult = dotenv.config({ path: envPath });
if (envResult.error && process.env.NODE_ENV !== 'test') {
  console.warn(`Could not load environment file: ${envPath}`);
}

let openai: OpenAI | null = null;
let language = process.env.APP_LANGUAGE || "Python";
const openaiBaseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
const openaiModel = process.env.OPENAI_MODEL?.trim() || undefined;
const openaiMaxTokens = Number.parseInt(process.env.OPENAI_MAX_TOKENS || '4000', 10);

interface Config {
  apiKey: string;
  language: string;
}

function updateConfig(config: Config) {
  if (!config.apiKey) {
    throw new Error('OpenAI API key is required');
  }
  
  try {
    openai = new OpenAI({
      apiKey: config.apiKey.trim(),
      ...(openaiBaseURL ? { baseURL: openaiBaseURL } : {})
    });
    language = config.language || 'Python';
    // console.log('OpenAI client initialized with new config');
  } catch (error) {
    console.error('Error initializing OpenAI client:', error);
    throw error;
  }
}

// Initialize with environment variables if available
if (process.env.OPENAI_API_KEY) {
  try {
    updateConfig({
      apiKey: process.env.OPENAI_API_KEY,
      language: process.env.APP_LANGUAGE || 'Python'
    });
  } catch (error) {
    console.error('Error initializing OpenAI with environment variables:', error);
  }
}

type QuestionType = 'coding' | 'single_choice' | 'multiple_choice' | 'short_answer' | 'unknown';

interface ProcessedSolution {
  questionType: QuestionType;
  answer: string;
  explanation: string;
  approach: string;
  code: string;
  timeComplexity: string;
  spaceComplexity: string;
}

interface ProcessScreenshotsOptions {
  onTextDelta?: (delta: string) => void;
}

type MessageContent = 
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function parseJsonResult(content: string): ProcessedSolution {
  const fallback: Partial<ProcessedSolution> = {
    questionType: normalizeQuestionType(
      readPartialJsonStringValue(content, 'questionType')
    ),
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
      return normalizeProcessedSolution({
        questionType: parsed.questionType || fallback.questionType,
        answer: parsed.answer || fallback.answer,
        explanation: parsed.explanation || fallback.explanation,
        approach: parsed.approach || fallback.approach,
        code: parsed.code || fallback.code,
        timeComplexity: parsed.timeComplexity || fallback.timeComplexity,
        spaceComplexity: parsed.spaceComplexity || fallback.spaceComplexity
      });
    } catch (error) {
      console.warn('Strict JSON parsing failed, falling back to partial extraction:', error);
    }
  }

  if (
    fallback.questionType ||
    fallback.answer ||
    fallback.explanation ||
    fallback.approach ||
    fallback.code ||
    fallback.timeComplexity ||
    fallback.spaceComplexity
  ) {
    return normalizeProcessedSolution(fallback);
  }

  throw new Error('Model returned an empty or non-JSON response');
}

function normalizeQuestionType(value: unknown): QuestionType {
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

function normalizeProcessedSolution(
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
    spaceComplexity: solution.spaceComplexity || ''
  };
}

function readPartialJsonStringValue(source: string, key: keyof ProcessedSolution) {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex === -1) return '';

  const colonIndex = source.indexOf(':', keyIndex);
  if (colonIndex === -1) return '';

  const quoteIndex = source.indexOf('"', colonIndex + 1);
  if (quoteIndex === -1) return '';

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

function extractBalancedJsonObject(source: string): string | null {
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

export async function processScreenshots(
  screenshots: { path: string }[],
  options: ProcessScreenshotsOptions = {}
): Promise<ProcessedSolution> {
  if (!openai) {
    throw new Error(`OpenAI client not initialized. Set OPENAI_API_KEY in ${envPath}.`);
  }
  if (!openaiModel) {
    throw new Error('OPENAI_MODEL is required. Set it in your .env file.');
  }

  try {
    const messages = [
      {
        role: "system" as const,
        content: `You are a visual question-answering assistant for coding interviews and written technical tests. Carefully read all screenshots and identify the question type before answering.
                 Classify the question as exactly one of: "coding", "single_choice", "multiple_choice", "short_answer", or "unknown".
                 For single_choice, select exactly one option.
                 For multiple_choice, select every correct option and include all selected option labels in the answer. Do not reduce a multiple-choice question to only one option.
                 Return only valid JSON in the following format:
                 {
                   "questionType": "coding | single_choice | multiple_choice | short_answer | unknown",
                   "answer": "For single-choice questions, include exactly one selected option label and answer text. For multiple-choice questions, include all selected option labels and answer text. For short-answer questions, give the concise answer. Leave empty for coding questions.",
                   "explanation": "Explain why the answer is correct. For coding questions, describe the approach in easy explanatory words.",
                   "code": "For coding questions, provide the complete ${language} solution. Leave empty for non-coding questions.",
                   "timeComplexity": "For coding questions, give Big O time complexity with the reason. Leave empty for non-coding questions.",
                   "spaceComplexity": "For coding questions, give Big O space complexity with the reason. Leave empty for non-coding questions."
                 }`
      },
      {
        role: "user" as const,
        content: [
          { type: "text", text: "Here is a coding interview question. Please analyze and provide a solution." } as MessageContent
        ]
      }
    ];

    // Add screenshots as image URLs
    for (const screenshot of screenshots) {
      const base64Image = await fs.readFile(screenshot.path, { encoding: 'base64' });
      messages.push({
        role: "user" as const,
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          } as MessageContent
        ]
      });
    }

    // Get response from OpenAI as a stream and keep the full text for parsing.
    const stream = await openai.chat.completions.create({
      model: openaiModel,
      messages: messages as any,
      max_tokens: Number.isFinite(openaiMaxTokens) && openaiMaxTokens > 0 ? openaiMaxTokens : 4000,
      temperature: 0.7,
      response_format: { type: "json_object" },
      stream: true
    });

    let content = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (!delta) continue;

      content += delta;
      options.onTextDelta?.(delta);
    }

    return parseJsonResult(content);
  } catch (error) {
    console.error('Error processing screenshots:', error);
    throw error;
  }
}

export default {
  processScreenshots,
  updateConfig
};
