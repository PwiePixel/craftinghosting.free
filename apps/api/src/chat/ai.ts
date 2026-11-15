/**
 * Anbindung an Claude über das offizielle SDK. Es wird immer das günstigste Modell verwendet (Claude Haiku)
 * – für kurze Support-Antworten reicht es, und das Monatsbudget hält deutlich länger.
 */
import Anthropic from '@anthropic-ai/sdk';
import { CHAT_MODEL } from '@chfree/shared';
import { HANDOFF_MARK } from './knowledge';

export interface AiAnswer {
  text: string;
  /** Die KI möchte an das Team übergeben */
  handoff: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export class ChatAiError extends Error {
  constructor(
    /** Meldung für den Admin-Bereich */
    readonly adminMessage: string,
  ) {
    super(adminMessage);
  }
}

/**
 * Fragt Claude. `system` ist bei jeder Anfrage gleich und wird deshalb zwischengespeichert (Prompt-Cache):
 * Folgeanfragen zahlen für das Wissen nur noch ein Zehntel.
 */
export async function askClaude(input: { apiKey: string; system: string; messages: Anthropic.MessageParam[]; maxAnswerTokens: number }): Promise<AiAnswer> {
  const client = new Anthropic({ apiKey: input.apiKey, maxRetries: 1, timeout: 25_000 });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: CHAT_MODEL,
      // Kurzes Nachdenken zählt mit zur Obergrenze – deshalb etwas Luft über der gewünschten Antwortlänge
      max_tokens: input.maxAnswerTokens + 800,
      // Niedriger Aufwand: Support-Fragen sind einfach; das Modell denkt dann kaum und antwortet schnell und günstig
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      messages: input.messages,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ChatAiError('Der API-Schlüssel wird von Anthropic nicht akzeptiert. Bitte unter Admin → Chat prüfen.');
    }
    if (error instanceof Anthropic.RateLimitError) throw new ChatAiError('Anthropic meldet: Anfrage-Limit erreicht (429). Der Chat antwortet vorübergehend ohne KI.');
    if (error instanceof Anthropic.BadRequestError) throw new ChatAiError(`Anthropic lehnt die Anfrage ab (400): ${error.message.slice(0, 160)}`);
    if (error instanceof Anthropic.APIError) throw new ChatAiError(`Anthropic meldet einen Fehler (${error.status ?? 'Verbindung'}): ${error.message.slice(0, 160)}`);
    throw new ChatAiError('Die Verbindung zu Anthropic ist fehlgeschlagen.');
  }
  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  // Aus Sicherheitsgründen abgelehnt → wie „kann nicht helfen“ behandeln
  if (response.stop_reason === 'refusal') return { text: '', handoff: true, usage };
  // Inhalt nach Typ lesen: Vor der Antwort können (leere) Denk-Blöcke stehen
  let text = '';
  for (const block of response.content) if (block.type === 'text') text += block.text;
  const handoff = text.includes(HANDOFF_MARK);
  text = text.split(HANDOFF_MARK).join('').trim();
  return { text, handoff: handoff || !text, usage };
}

/** Prüft den Schlüssel, ohne Guthaben zu verbrauchen (Abruf der Modell-Beschreibung) */
export async function checkApiKey(apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  try {
    const model = await client.models.retrieve(CHAT_MODEL);
    return model.display_name;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ChatAiError('Der API-Schlüssel wird von Anthropic nicht akzeptiert.');
    if (error instanceof Anthropic.NotFoundError) throw new ChatAiError(`Das Modell ${CHAT_MODEL} ist für diesen Schlüssel nicht verfügbar.`);
    if (error instanceof Anthropic.APIError) throw new ChatAiError(`Anthropic meldet einen Fehler (${error.status ?? 'Verbindung'}).`);
    throw new ChatAiError('Die Verbindung zu Anthropic ist fehlgeschlagen.');
  }
}
