import type { ViewNode } from '../types';
import { NativeBridge } from '../native/NativeBridge';
import { sensitiveScreenKind } from '../privacy/sensitiveScreen';
import { classifyGoalIntent, type AssistIntent, type IntentResult } from './intentClassify';
import { verifiedGoalOcrLabels, verifiedWalletChoices } from './ocrTarget';
import {
  assistHintsModelText,
  rankNodesForGoal,
  type RankedNode,
} from './nodeRank';

export type OnDeviceAssistResult = {
  intent: AssistIntent;
  confidence: number;
  tokens: string[];
  ocrTokens: string[];
  /** Goal-derived labels verified against local OCR, never raw page text. */
  goalOcrLabels?: string[];
  /** Only allowlisted public wallet product names, verified locally. */
  walletChoices?: string[];
  ranked: RankedNode[];
  /** Compact planner block (empty when nothing useful). */
  modelText: string;
  backend: string;
};

export type BuildAssistOptions = {
  /** Skip Vision OCR (tests / hosts without camera-style capture). Default false. */
  skipOcr?: boolean;
  /** Cap OCR tokens merged into ranking. */
  maxOcrTokens?: number;
};

/**
 * On-device assist: JS intent + node rank, optional native OCR.
 * Enriches the cloud planner `ui_screen_model` — does not replace the LLM.
 */
export async function buildOnDeviceAssist(
  goal: string,
  tree: ViewNode | null | undefined,
  opts: BuildAssistOptions = {},
): Promise<OnDeviceAssistResult> {
  const classified: IntentResult = classifyGoalIntent(goal);
  if (sensitiveScreenKind(tree)) {
    return { intent: classified.intent, confidence: classified.confidence,
      tokens: [], ocrTokens: [], ranked: [], modelText: '', backend: 'local-private-screen' };
  }
  let ocrTokens: string[] = [];
  let ocrTexts: Awaited<
    ReturnType<typeof NativeBridge.recognizeScreenText>
  >['texts'] = [];
  let backend = 'js';

  if (!opts.skipOcr && NativeBridge.isAvailable()) {
    try {
      const ocr = await NativeBridge.recognizeScreenText({
        maxTokens: opts.maxOcrTokens ?? 24,
        hideOverlays: true,
      });
      ocrTokens = (ocr.tokens || []).filter(Boolean).slice(0, opts.maxOcrTokens ?? 24);
      ocrTexts = (ocr.texts || []).slice(0, 64);
      if (ocr.backend) backend = `js+${ocr.backend}`;
    } catch {
      // Soft-fail: dump-only assist still helps the planner.
    }
  }

  const ranked = tree
    ? rankNodesForGoal(tree, {
        intent: classified.intent,
        tokens: classified.tokens,
        ocrTokens,
        limit: 8,
      })
    : [];

  const modelText = assistHintsModelText(
    classified.intent,
    classified.confidence,
    ranked,
    ocrTokens,
    backend,
    ocrTexts,
  );

  return {
    intent: classified.intent,
    confidence: classified.confidence,
    tokens: classified.tokens,
    ocrTokens,
    goalOcrLabels: verifiedGoalOcrLabels(goal, tree, ocrTexts),
    walletChoices: verifiedWalletChoices(goal, tree, ocrTexts),
    ranked,
    modelText,
    backend,
  };
}

/** Sync path for unit tests / hosts that already have OCR tokens. */
export function buildOnDeviceAssistSync(
  goal: string,
  tree: ViewNode | null | undefined,
  ocrTokens: string[] = [],
  backend = 'js',
): OnDeviceAssistResult {
  const classified = classifyGoalIntent(goal);
  if (sensitiveScreenKind(tree)) return { intent: classified.intent,
    confidence: classified.confidence, tokens: [], ocrTokens: [], ranked: [],
    modelText: '', backend: 'local-private-screen' };
  const ranked = tree
    ? rankNodesForGoal(tree, {
        intent: classified.intent,
        tokens: classified.tokens,
        ocrTokens,
        limit: 8,
      })
    : [];
  return {
    intent: classified.intent,
    confidence: classified.confidence,
    tokens: classified.tokens,
    ocrTokens,
    ranked,
    modelText: assistHintsModelText(
      classified.intent,
      classified.confidence,
      ranked,
      ocrTokens,
      backend,
    ),
    backend,
  };
}
