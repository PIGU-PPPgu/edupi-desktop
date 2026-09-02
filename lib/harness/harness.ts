// Adapted from QM at b384c6548eb07d6531a26295367fdf9e8be4636a.
// Copyright (c) 2026 QM contributors. Licensed under MIT; see
// src-tauri/resources/third-party/qm/LICENSE.
import type { RpcSessionStartOptions } from "../rpc-manager.ts";
import type { HarnessScope } from "./scope.ts";

export type HarnessControlTransport = "in-process" | "sdk" | "http" | "json-rpc" | "api";
export type HarnessToolTransport = "in-process" | "plugin" | "dynamic" | "mcp";
export type HarnessCapability =
  | "abort"
  | "steer"
  | "images"
  | "thinking-level"
  | "provider-sessions";

export interface HarnessAdapterProfile {
  id: string;
  controlTransport: HarnessControlTransport;
  toolTransport: HarnessToolTransport;
  transcriptFormat: string;
  capabilities: ReadonlySet<HarnessCapability>;
}

export type HarnessSessionStartOptions = RpcSessionStartOptions;

export interface HarnessSessionStartInput {
  sessionId: string;
  sessionFile: string;
  cwd: string | undefined;
  options: HarnessSessionStartOptions;
  scope: HarnessScope;
}

export type HarnessSessionStartResult = Awaited<
  ReturnType<typeof import("../rpc-manager.ts").startRpcSession>
>;

export interface HarnessSessionController {
  start(input: HarnessSessionStartInput): Promise<HarnessSessionStartResult>;
}

export interface HarnessToolPresentation {
  name(coreName: string): string;
}

export interface Harness {
  profile: HarnessAdapterProfile;
  sessions: HarnessSessionController;
  models: Readonly<Record<string, never>>;
  tools: HarnessToolPresentation;
}

export type HarnessImplementation = HarnessSessionController;

const EMPTY_MODEL_UTILITIES = Object.freeze({}) as Readonly<Record<string, never>>;
const IDENTITY_TOOL_PRESENTATION: HarnessToolPresentation = { name: (coreName) => coreName };

export function defineHarness(
  profile: HarnessAdapterProfile,
  implementation: HarnessImplementation,
  tools: HarnessToolPresentation = IDENTITY_TOOL_PRESENTATION,
): Harness {
  return {
    profile,
    sessions: { start: implementation.start.bind(implementation) },
    models: EMPTY_MODEL_UTILITIES,
    tools,
  };
}
