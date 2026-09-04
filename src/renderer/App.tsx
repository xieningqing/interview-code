import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import './App.css';

interface Screenshot {
  id: number;
  preview: string;
  path: string;
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

type PageDirection = 'previous' | 'next';

interface CodeResultPage {
  type: 'code';
  title: string;
  lines: string[];
  startLine: number;
  totalLines: number;
}

interface ComplexityResultPage {
  type: 'complexity';
  title: string;
  timeComplexity: string;
  spaceComplexity: string;
}

interface TextResultPage {
  type: 'text';
  title: string;
  content: string;
}

type ResultPage = CodeResultPage | ComplexityResultPage | TextResultPage;

type SolutionStyle = React.CSSProperties & Record<`--${string}`, string>;

declare global {
  interface Window {
    electron: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      quit: () => void;
      takeScreenshot: () => Promise<void>;
      processScreenshots: () => Promise<void>;
      resetQueue: () => Promise<void>;
      onProcessingComplete: (callback: (result: string) => void) => void;
      onProcessingStream: (callback: (delta: string) => void) => void;
      onResultPageCommand: (callback: (direction: PageDirection) => void) => void;
      onScreenshotTaken: (callback: (data: Screenshot) => void) => void;
      onProcessingStarted: (callback: () => void) => void;
      onQueueReset: (callback: () => void) => void;
    };
  }
}

const CODE_LINES_PER_PAGE = 22;

const readPartialJsonStringValue = (source: string, key: keyof ProcessedSolution) => {
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
};

const formatStreamPreview = (rawText: string) => {
  const questionType = readPartialJsonStringValue(rawText, 'questionType');
  const answer = readPartialJsonStringValue(rawText, 'answer');
  const explanation = readPartialJsonStringValue(rawText, 'explanation');
  const code = readPartialJsonStringValue(rawText, 'code');
  const timeComplexity = readPartialJsonStringValue(rawText, 'timeComplexity');
  const spaceComplexity = readPartialJsonStringValue(rawText, 'spaceComplexity');

  if (!questionType && !answer && !explanation && !code && !timeComplexity && !spaceComplexity) {
    return rawText;
  }

  const parts: string[] = [];

  if (questionType) {
    parts.push(`Type: ${questionType}`);
  }

  if (answer) {
    parts.push(`Answer:\n${answer}`);
  }

  if (explanation) {
    parts.push(`Explanation:\n${explanation}`);
  }

  if (code) {
    parts.push(`Solution:\n${code}`);
  }

  if (timeComplexity || spaceComplexity) {
    parts.push(
      [
        timeComplexity ? `Time: ${timeComplexity}` : '',
        spaceComplexity ? `Space: ${spaceComplexity}` : ''
      ].filter(Boolean).join('\n')
    );
  }

  return parts.filter(Boolean).join('\n\n');
};

const normalizeQuestionType = (value: unknown): QuestionType => {
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
};

const normalizeResult = (value: Partial<ProcessedSolution>): ProcessedSolution => {
  const explanation = value.explanation || value.approach || '';
  const questionType = normalizeQuestionType(value.questionType);

  return {
    questionType: questionType !== 'unknown'
      ? questionType
      : value.code
        ? 'coding'
        : 'unknown',
    answer: value.answer || '',
    explanation,
    approach: explanation,
    code: value.code || '',
    timeComplexity: value.timeComplexity || '',
    spaceComplexity: value.spaceComplexity || ''
  };
};

const buildResultPages = (solution: ProcessedSolution): ResultPage[] => {
  const pages: ResultPage[] = [];
  const codeLines = solution.code ? solution.code.split('\n') : [];
  const isCoding = solution.questionType === 'coding' || Boolean(solution.code);
  const answerTitle = solution.questionType === 'single_choice'
    ? 'Single Choice Answer'
    : solution.questionType === 'multiple_choice'
      ? 'Multiple Choice Answers'
      : 'Answer';

  if (isCoding) {
    for (let index = 0; index < codeLines.length; index += CODE_LINES_PER_PAGE) {
      pages.push({
        type: 'code',
        title: 'Solution',
        lines: codeLines.slice(index, index + CODE_LINES_PER_PAGE),
        startLine: index + 1,
        totalLines: codeLines.length
      });
    }

    if (solution.timeComplexity || solution.spaceComplexity) {
      pages.push({
        type: 'complexity',
        title: 'Complexity',
        timeComplexity: solution.timeComplexity,
        spaceComplexity: solution.spaceComplexity
      });
    }

    if (solution.explanation) {
      pages.push({
        type: 'text',
        title: 'Approach',
        content: solution.explanation
      });
    }

    return pages;
  }

  if (solution.answer) {
    pages.push({
      type: 'text',
      title: answerTitle,
      content: solution.answer
    });
  }

  if (solution.explanation) {
    pages.push({
      type: 'text',
      title: 'Explanation',
      content: solution.explanation
    });
  }

  if (solution.code) {
    pages.push({
      type: 'code',
      title: 'Response',
      lines: codeLines,
      startLine: 1,
      totalLines: codeLines.length
    });
  }

  if (pages.length === 0) {
    pages.push({
      type: 'text',
      title: 'Answer',
      content: 'No answer was returned.'
    });
  }

  return pages;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const estimateMonospaceFontSize = (
  width: number,
  height: number,
  options: {
    min: number;
    max: number;
  }
) => {
  const widthSize = width / 56;
  const heightSize = height / 24;
  return clamp(Math.floor(Math.min(widthSize, heightSize)), options.min, options.max);
};

const App: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessedSolution | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamText, setStreamText] = useState('');
  const [resultPageIndex, setResultPageIndex] = useState(0);
  const [solutionStyle, setSolutionStyle] = useState<SolutionStyle>(() => ({
    '--solution-code-font-size': '14px',
    '--solution-code-line-height': '1.35',
    '--solution-body-font-size': '14px',
    '--solution-line-number-size': '11px',
    '--solution-stream-font-size': '14px',
    '--solution-max-height': '360px'
  }));
  const streamTextRef = useRef('');
  const resultPageCountRef = useRef(0);
  const shortcutsRowRef = useRef<HTMLDivElement | null>(null);
  const previewRowRef = useRef<HTMLDivElement | null>(null);
  const statusRowRef = useRef<HTMLDivElement | null>(null);

  const resultPages = useMemo(() => (result ? buildResultPages(result) : []), [result]);
  const activeResultPage = resultPages[resultPageIndex];
  const streamPreview = useMemo(() => formatStreamPreview(streamText), [streamText]);

  const goToResultPage = (direction: PageDirection) => {
    setResultPageIndex(prev => {
      const pageCount = resultPageCountRef.current;
      if (pageCount === 0) return prev;

      return direction === 'previous'
        ? Math.max(prev - 1, 0)
        : Math.min(prev + 1, pageCount - 1);
    });
  };

  useEffect(() => {
    resultPageCountRef.current = resultPages.length;
    setResultPageIndex(prev => (
      resultPages.length === 0 ? 0 : Math.min(prev, resultPages.length - 1)
    ));
  }, [resultPages.length]);

  useLayoutEffect(() => {
    const updateSolutionStyle = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const shortcutsHeight = shortcutsRowRef.current?.getBoundingClientRect().height ?? 0;
      const previewHeight = previewRowRef.current?.getBoundingClientRect().height ?? 0;
      const chromeHeight = shortcutsHeight + previewHeight + 96;
      const statusWidth = statusRowRef.current?.getBoundingClientRect().width ?? viewportWidth;
      const availableWidth = Math.max(statusWidth - 48, 320);
      const availableHeight = Math.max(viewportHeight - chromeHeight, 220);
      const fontSize = estimateMonospaceFontSize(availableWidth, availableHeight, {
        min: 14,
        max: 18
      });

      setSolutionStyle({
        '--solution-code-font-size': `${fontSize}px`,
        '--solution-code-line-height': '1.34',
        '--solution-body-font-size': `${fontSize}px`,
        '--solution-line-number-size': `${Math.max(11, Math.round(fontSize * 0.78))}px`,
        '--solution-stream-font-size': `${fontSize}px`,
        '--solution-max-height': `${Math.max(availableHeight - 24, 220)}px`
      });
    };

    let raf = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updateSolutionStyle);
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  useEffect(() => {
    console.log('Setting up event listeners...');

    // Listen for processing started events
    window.electron.onProcessingStarted(() => {
      console.log('Processing started');
      setIsProcessing(true);
      setResult(null);
      setResultPageIndex(0);
      streamTextRef.current = '';
      setStreamText('');
    });

    window.electron.onProcessingStream((delta) => {
      streamTextRef.current += delta;
      setStreamText(streamTextRef.current);
    });

    window.electron.onResultPageCommand((direction) => {
      goToResultPage(direction);
    });

    // Keyboard event listener
    const handleKeyDown = async (event: KeyboardEvent) => {
      console.log('Key pressed:', event.key);
	  
	 
      
      // Check if Cmd/Ctrl is pressed
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
	  
      const key = event.key.toLowerCase();
      if (isCmdOrCtrl && (key === 'arrowleft' || key === '<' || key === ',')) {
        event.preventDefault();
        goToResultPage('previous');
        return;
      }

      if (isCmdOrCtrl && (key === 'arrowright' || key === '>' || key === '.')) {
        event.preventDefault();
        goToResultPage('next');
        return;
      }
	  

      switch (key) {
        case 'h':
          console.log('Screenshot hotkey pressed');
          await handleTakeScreenshot();
          break;
        case 'enter':
          console.log('Process hotkey pressed');
          await handleProcess();
          break;
        case 'r':
          console.log('Reset hotkey pressed');
          await handleReset();
          break;
        case 'b':
          if (isCmdOrCtrl) {
            console.log('Toggle visibility hotkey pressed');
            // Toggle visibility logic here
          }
          break;
        case 'q':
          if (isCmdOrCtrl) {
            console.log('Quit hotkey pressed');
            handleQuit();
          }
          break;
      }
    };

    // Add keyboard event listener
    window.addEventListener('keydown', handleKeyDown);

    // Listen for processing complete events
    window.electron.onProcessingComplete((resultStr) => {
      console.log('Processing complete. Result:', resultStr);
      try {
        const parsedResult = normalizeResult(JSON.parse(resultStr) as Partial<ProcessedSolution>);
        setResult(parsedResult);
        setResultPageIndex(0);
      } catch (error) {
        console.error('Error parsing result:', error);
        setResult({
          questionType: 'unknown',
          answer: streamTextRef.current || resultStr,
          explanation: '',
          approach: '',
          code: '',
          timeComplexity: '',
          spaceComplexity: ''
        });
        setResultPageIndex(0);
      }
      setIsProcessing(false);
    });

    // Listen for new screenshots
    window.electron.onScreenshotTaken((screenshot) => {
      console.log('New screenshot taken:', screenshot);
      setScreenshots(prev => {
        const newScreenshots = [...prev, screenshot];
        console.log('Updated screenshots array:', newScreenshots);
        return newScreenshots;
      });
    });

    // Listen for queue reset
    window.electron.onQueueReset(() => {
      console.log('Queue reset triggered');
      setScreenshots([]);
      setResult(null);
      setResultPageIndex(0);
      streamTextRef.current = '';
      setStreamText('');
    });

    // Cleanup
    return () => {
      console.log('Cleaning up event listeners...');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000); // Hide error after 5 seconds
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleTakeScreenshot = async () => {
    console.log('Taking screenshot, current count:', screenshots.length);
    if (screenshots.length >= 4) {
      console.log('Maximum screenshots reached');
      return;
    }
    try {
      await window.electron.takeScreenshot();
      console.log('Screenshot taken successfully');
    } catch (error) {
      console.error('Error taking screenshot:', error);
    }
  };

  const handleProcess = async () => {
    console.log('Starting processing. Current screenshots:', screenshots);
    if (screenshots.length === 0) {
      console.log('No screenshots to process');
      return;
    }
    setIsProcessing(true);
    setResult(null);
    setResultPageIndex(0);
    streamTextRef.current = '';
    setStreamText('');
    setError(null);
    try {
      await window.electron.processScreenshots();
      console.log('Process request sent successfully');
    } catch (error: any) {
      console.error('Error processing screenshots:', error);
      setError(error?.message || 'Error processing screenshots');
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    console.log('Resetting queue...');
    await window.electron.resetQueue();
  };

  const handleQuit = () => {
    console.log('Quitting application...');
    window.electron.quit();
  };

  // Log state changes
  useEffect(() => {
    console.log('State update:', {
      isProcessing,
      result,
      screenshotCount: screenshots.length
    });
  }, [isProcessing, result, screenshots]);

  const formatCodeLines = (lines: string[], startLine: number) => {
    return lines.map((line, index) => (
      <div key={index} className="code-line">
        <span className="line-number">{startLine + index}</span>
        {line}
      </div>
    ));
  };

  const formatTextBlock = (content: string) => {
    return content.split('\n').map((line, index) => (
      <div key={index} className="text-line">
        {line || '\u00A0'}
      </div>
    ));
  };

  return (
    <div className="app">
      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}
      {/* Preview Row */}
      <div ref={shortcutsRowRef} className="shortcuts-row">
        <div className="shortcut"><code>⌘/Ctrl + H</code> Screenshot</div>
        <div className="shortcut"><code>⌘/Ctrl + ↵</code> Solution</div>
        <div className="shortcut"><code>⌘/Ctrl + R</code> Reset</div>
        <div className="shortcut"><code>⌘/Ctrl + &lt;/&gt;</code> Move/Page</div>
        <div className="shortcut"><code>⌘/Ctrl + B</code> Hide/Show</div>
        <div className="shortcut"><code>⌘/Ctrl + Q</code> Quit</div>
        <div className="hover-shortcuts">
          <div className="hover-shortcuts-content">
            <div className="shortcut"><code>⌘/Ctrl + B</code> Show/Hide</div>
            <div className="shortcut"><code>⌘/Ctrl + Q</code> Quit</div>
            <div className="shortcut"><code>⌘/Ctrl + ←/→</code> Move/Page</div>
            <div className="shortcut"><code>⌘/Ctrl + ↑/↓</code> Move Up/Down</div>
          </div>
        </div>
      </div>
      <div ref={previewRowRef} className="preview-row">
        {screenshots.map(screenshot => (
          <div key={screenshot.id} className="preview-item">
            <img src={screenshot.preview} alt="Screenshot preview" />
          </div>
        ))}
      </div>

      <div ref={statusRowRef} className="status-row" style={solutionStyle}>
        {isProcessing ? (
          <div className="processing">
            <div className="processing-label">
              Processing... ({screenshots.length} screenshots)
            </div>
            {streamPreview && (
              <pre className="stream-output">
                <code>{streamPreview}</code>
              </pre>
            )}
          </div>
        ) : result && activeResultPage ? (
          <div className="result">
            <div className="result-pager">
              <span>{resultPageIndex + 1}/{resultPages.length}</span>
            </div>

            {activeResultPage.type === 'code' ? (
              <div className="solution-section">
                <h3>
                  {activeResultPage.title}
                  <span className="page-subtitle">
                    Lines {activeResultPage.startLine}-{Math.min(activeResultPage.startLine + activeResultPage.lines.length - 1, activeResultPage.totalLines)} / {activeResultPage.totalLines}
                  </span>
                </h3>
                <pre>
                  <code>{formatCodeLines(activeResultPage.lines, activeResultPage.startLine)}</code>
                </pre>
              </div>
            ) : activeResultPage.type === 'text' ? (
              <div className="solution-section">
                <h3>{activeResultPage.title}</h3>
                <p className="text-block">
                  {formatTextBlock(activeResultPage.content)}
                </p>
              </div>
            ) : (
              <div className="solution-section">
                <h3>{activeResultPage.title}</h3>
                <p>Time: {activeResultPage.timeComplexity}</p>
                <p>Space: {activeResultPage.spaceComplexity}</p>
              </div>
            )}

          </div>
        ) : (
          <div className="empty-status">
            {screenshots.length > 0
              ? `Press Enter to process ${screenshots.length} screenshot${screenshots.length > 1 ? 's' : ''}`
              : 'Press H to take a screenshot'}
          </div>
        )}
      </div>

    </div>
  );
};

export default App; 
