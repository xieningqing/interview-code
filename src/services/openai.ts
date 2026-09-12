import { app } from 'electron';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import {
  buildFallbackSolution,
  describeOutcome,
  tryParseSolution,
  type CompletionOutcome,
  type ProcessedSolution
} from './solutionParsing';

const envPath = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath), '.env')
  : path.resolve(__dirname, '../../.env');

const envResult = dotenv.config({ path: envPath });
if (envResult.error && process.env.NODE_ENV !== 'test') {
  console.warn(`Could not load environment file: ${envPath}`);
}

let openai: OpenAI | null = null;
let language = process.env.APP_LANGUAGE || "Python";
const openaiBaseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
const openaiModel = process.env.OPENAI_MODEL?.trim() || undefined;

const DEFAULT_MAX_TOKENS = 8192;
const MAX_TOKENS_CEILING = 32768;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Reasoning models (deepseek-v4-flash-vision-exp and friends) bill their internal
// reasoning against max_tokens, so a small budget gets fully consumed by the
// thinking pass and the model returns empty content.
const openaiMaxTokens = Math.min(
  readPositiveInt(process.env.OPENAI_MAX_TOKENS, DEFAULT_MAX_TOKENS),
  MAX_TOKENS_CEILING
);

const parsedTemperature = Number.parseFloat(process.env.OPENAI_TEMPERATURE || '');
const openaiTemperature = Number.isFinite(parsedTemperature) ? parsedTemperature : 0.3;

const normalizeThinkingMode = (value: string | undefined): 'enabled' | 'disabled' | null => {
  const mode = (value || '').trim().toLowerCase();
  if (mode === 'enabled' || mode === 'on' || mode === 'true') return 'enabled';
  if (mode === 'disabled' || mode === 'off' || mode === 'none' || mode === 'false') return 'disabled';
  return null;
};

// Default to "disabled": the overlay needs to answer fast, and turning thinking off
// keeps the whole token budget available for the answer itself. Providers that do
// not understand the parameter are handled by the fallback in executeAttempt.
const openaiThinkingMode = normalizeThinkingMode(process.env.OPENAI_THINKING ?? 'disabled');

let thinkingBody: Record<string, unknown> | null = openaiThinkingMode
  ? { thinking: { type: openaiThinkingMode } }
  : null;

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

interface ProcessScreenshotsOptions {
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onAttemptRestart?: () => void;
}

type MessageContent = 
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface CompletionParams {
  maxTokens: number;
  stream: boolean;
  useJsonMode: boolean;
}

function buildEmptyResponseError(outcome: CompletionOutcome | null): string {
  const details = describeOutcome(outcome);

  // The exact symptom produced by a reasoning model that ran out of max_tokens
  // before it started writing the actual answer.
  if (outcome && !outcome.content && outcome.reasoning) {
    return `The model used its entire token budget on internal reasoning and never produced an answer (${details}). `
      + `Raise OPENAI_MAX_TOKENS or set OPENAI_THINKING="disabled" in ${envPath}.`;
  }

  return `Model returned an empty or non-JSON response (${details}).`;
}

function isFatalRequestError(error: Error): boolean {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (typeof status !== 'number') return false;
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

async function runCompletion(
  messages: unknown[],
  params: CompletionParams,
  options: ProcessScreenshotsOptions
): Promise<CompletionOutcome> {
  const request: Record<string, unknown> = {
    model: openaiModel,
    messages,
    max_tokens: params.maxTokens,
    temperature: openaiTemperature,
    ...(params.useJsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(thinkingBody || {}),
    stream: params.stream
  };

  if (!params.stream) {
    const response = await (openai!.chat.completions.create as any)(request);
    const choice = response?.choices?.[0];
    const message = choice?.message || {};
    const content = typeof message.content === 'string' ? message.content : '';
    const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';

    if (reasoning) options.onReasoningDelta?.(reasoning);
    if (content) options.onTextDelta?.(content);

    return {
      content,
      reasoning,
      finishReason: choice?.finish_reason ?? null,
      completionTokens: response?.usage?.completion_tokens ?? null,
      reasoningTokens: response?.usage?.completion_tokens_details?.reasoning_tokens ?? null
    };
  }

  const stream = await (openai!.chat.completions.create as any)(request);

  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let completionTokens: number | null = null;
  let reasoningTokens: number | null = null;

  for await (const chunk of stream) {
    // Some gateways deliver an error object inside the stream instead of failing
    // the request, and non-stream-shaped chunks can arrive with an empty choices list.
    const chunkError = (chunk as any)?.error;
    if (chunkError) {
      throw new Error(chunkError.message || String(chunkError));
    }

    const usage = (chunk as any)?.usage;
    if (usage) {
      completionTokens = usage.completion_tokens ?? completionTokens;
      reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
    }

    const choice = (chunk as any)?.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta || {};

    // Reasoning deltas must never be parsed as the answer, but they are the only
    // sign of life while a thinking model works through a large screenshot.
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      options.onReasoningDelta?.(delta.reasoning_content);
    }

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      options.onTextDelta?.(delta.content);
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  return { content, reasoning, finishReason, completionTokens, reasoningTokens };
}

/**
 * Runs one attempt, downgrading optional parameters that a provider rejects
 * instead of failing the whole request.
 */
async function executeAttempt(
  messages: unknown[],
  params: CompletionParams,
  options: ProcessScreenshotsOptions
): Promise<CompletionOutcome> {
  let useJsonMode = params.useJsonMode;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runCompletion(messages, { ...params, useJsonMode }, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (thinkingBody && /\bthinking\b/i.test(message)) {
        console.warn(`Provider rejected the thinking parameter, retrying without it: ${message}`);
        thinkingBody = null;
        continue;
      }

      if (useJsonMode && /response_format|json_object|json mode/i.test(message)) {
        console.warn(`Provider rejected response_format, retrying without JSON mode: ${message}`);
        useJsonMode = false;
        continue;
      }

      throw error;
    }
  }

  throw new Error('Model request failed after parameter fallback retries');
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
    const userContent: MessageContent[] = [
      { type: "text", text: "Here is a coding interview question. Please analyze and provide a solution." }
    ];

    // Every image belongs to the same user message: some providers silently ignore
    // images that arrive in separate trailing messages.
    for (const screenshot of screenshots) {
      const base64Image = await fs.readFile(screenshot.path, { encoding: 'base64' });
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64Image}`
        }
      });
    }

    const messages = [
      {
        role: "system" as const,
        content: `You are a visual question-answering assistant for coding interviews and written technical tests. Carefully read all screenshots and identify the question type before answering.
                 Classify the question as exactly one of: "coding", "single_choice", "multiple_choice", "short_answer", or "unknown".
                 For single_choice, select exactly one option.
                 For multiple_choice, select every correct option and include all selected option labels in the answer. Do not reduce a multiple-choice question to only one option.
                 Strict output requirements:
                 - Return exactly one JSON object as your reply. Keep any internal deliberation short and make sure the JSON object is always emitted.
                 - Do not include Markdown fences, comments, or any text outside the JSON object.
                 - Never return an empty object or leave every response field empty.
                 - Treat questionType as an advisory classification, not a reason to omit content.
                 - For coding questions, provide non-empty explanation, code, timeComplexity, and spaceComplexity fields. The answer field may be empty.
                 - For non-coding questions, provide non-empty answer and explanation fields. Leave code, timeComplexity, and spaceComplexity empty.
                 - If the question type is uncertain because the screenshot is large, partial, or unclear, use questionType "unknown" but still return every answer, explanation, code, and complexity field that can be inferred from the visible content.
                 - Use questionType "unknown" only when the screenshots do not contain enough information to classify the question, and explain the limitation in the explanation field. Never clear otherwise useful fields just because classification is uncertain.
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
        content: userContent
      }
    ];

    // A vision request against a reasoning model can burn the whole budget on
    // reasoning, so an empty first attempt is retried once with a doubled budget,
    // then once more without streaming / JSON mode as a last resort.
    const plan: CompletionParams[] = [
      { maxTokens: openaiMaxTokens, stream: true, useJsonMode: true },
      { maxTokens: Math.min(openaiMaxTokens * 2, MAX_TOKENS_CEILING), stream: false, useJsonMode: true },
      { maxTokens: Math.min(openaiMaxTokens * 2, MAX_TOKENS_CEILING), stream: false, useJsonMode: false }
    ];

    let lastOutcome: CompletionOutcome | null = null;
    let lastError: Error | null = null;

    for (let index = 0; index < plan.length; index += 1) {
      if (index > 0) {
        console.warn(`Retrying with max_tokens=${plan[index].maxTokens}, stream=${plan[index].stream}, json_mode=${plan[index].useJsonMode}`);
        options.onAttemptRestart?.();
      }

      try {
        const outcome = await executeAttempt(messages, plan[index], options);
        lastOutcome = outcome;
        console.log(`Model response: ${describeOutcome(outcome)}`);

        const solution = tryParseSolution(outcome.content);
        if (solution) return solution;

        // The model answered, just not in JSON: hand back its full output instead of
        // throwing it away. No retry - the content is already there.
        const rawFallback = buildFallbackSolution({
          content: outcome.content,
          reasoning: outcome.reasoning,
          allowReasoning: false
        });
        if (rawFallback) {
          console.warn(`Model ignored the JSON contract; returning its raw output (${outcome.content.length} chars).`);
          return rawFallback;
        }

        console.warn(`Attempt ${index + 1} produced no answer: ${describeOutcome(outcome)}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Attempt ${index + 1} failed: ${lastError.message}`);

        // Auth, model and bad-request errors will not improve with a bigger budget.
        if (isFatalRequestError(lastError)) throw lastError;
      }
    }

    // Every attempt came back empty. If the model at least produced reasoning, show
    // it clearly labelled rather than handing back a bare error.
    const lastResort = buildFallbackSolution({
      content: lastOutcome?.content || '',
      reasoning: lastOutcome?.reasoning || '',
      allowReasoning: true
    });
    if (lastResort) {
      console.warn('No answer text was produced; returning the raw reasoning as a last resort.');
      return lastResort;
    }

    if (lastError && !lastOutcome) throw lastError;

    throw new Error(buildEmptyResponseError(lastOutcome));
  } catch (error) {
    console.error('Error processing screenshots:', error);
    throw error;
  }
}

export default {
  processScreenshots,
  updateConfig
};
