"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionTarget = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

function abortRecognition(recognition: SpeechRecognitionLike | null): void {
  if (!recognition) return;
  recognition.onstart = null;
  recognition.onerror = null;
  recognition.onend = null;
  recognition.onresult = null;
  recognition.abort();
}

export function speechRecognitionConstructor(target: SpeechRecognitionTarget): SpeechRecognitionConstructor | null {
  const constructor = target.SpeechRecognition || target.webkitSpeechRecognition;
  return typeof constructor === "function" ? constructor as SpeechRecognitionConstructor : null;
}

export function appendSpeechTranscript(current: string, transcript: string): string {
  const next = transcript.trim();
  if (!next) return current;
  if (!current) return next;
  return `${current}${/\s$/u.test(current) ? "" : " "}${next}`;
}

export function finalSpeechTranscript(event: SpeechRecognitionEventLike): string {
  const transcripts: string[] = [];
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result?.isFinal ? result[0]?.transcript?.trim() : "";
    if (transcript) transcripts.push(transcript);
  }
  return transcripts.join(" ");
}

export function useSpeechDictation({ lang, onTranscript }: { lang: string; onTranscript: (transcript: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;

  useEffect(() => {
    setSupported(Boolean(speechRecognitionConstructor(window as unknown as SpeechRecognitionTarget)));
    return () => {
      abortRecognition(recognitionRef.current);
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const abort = useCallback(() => {
    abortRecognition(recognitionRef.current);
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Constructor = speechRecognitionConstructor(window as unknown as SpeechRecognitionTarget);
    if (!Constructor) return;
    const recognition = new Constructor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => { setError(null); setListening(true); };
    recognition.onresult = (event) => {
      const transcript = finalSpeechTranscript(event);
      if (transcript) transcriptRef.current(transcript);
    };
    recognition.onerror = (event) => {
      setError(event.error || "recognition-failed");
      setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
    };
    abortRecognition(recognitionRef.current);
    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError("start-failed");
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, start, stop, abort, toggle };
}
