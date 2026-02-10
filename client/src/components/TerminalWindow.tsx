import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalWindowProps {
  sessionId: string;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onTerminalReady?: (sessionId: string, write: (data: string) => void) => void;
}

export default function TerminalWindow({ sessionId, onInput, onResize, onTerminalReady }: TerminalWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const fitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedFit = useCallback(() => {
    if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
    fitTimeoutRef.current = setTimeout(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (fit && term && containerRef.current && containerRef.current.offsetHeight > 0) {
        try {
          fit.fit();
          onResize(sessionId, term.cols, term.rows);
        } catch {
          // container not ready yet
        }
      }
    }, 100);
  }, [sessionId, onResize]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Initial fit
    setTimeout(() => {
      try {
        fitAddon.fit();
        onResize(sessionId, term.cols, term.rows);
      } catch {
        // not ready
      }
    }, 50);

    // Forward user input
    term.onData((data) => {
      onInput(sessionId, data);
    });

    // Expose write function
    if (onTerminalReady) {
      onTerminalReady(sessionId, (data: string) => term.write(data));
    }

    // Observe container resize
    const observer = new ResizeObserver(() => debouncedFit());
    observer.observe(containerRef.current);
    observerRef.current = observer;

    return () => {
      if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, onInput, onResize, onTerminalReady, debouncedFit]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
