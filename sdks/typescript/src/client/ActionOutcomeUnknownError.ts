import { message, resolveText, type LocalizedText } from '../i18n';

/** A dispatched action may have committed; replay would risk a duplicate. */
export class ActionOutcomeUnknownError extends Error {
  readonly localizedMessage = message('runtime.uncertainOutcome');
  constructor(readonly detail: string) {
    super(resolveText(message('runtime.uncertainOutcome')));
    this.name = 'ActionOutcomeUnknownError';
  }
}

/** Validation rejected a target before an action was dispatched. Replan safely. */
export class ActionValidationError extends Error {
  constructor(readonly localizedMessage: LocalizedText) {
    super(resolveText(localizedMessage));
    this.name = 'ActionValidationError';
  }
}
