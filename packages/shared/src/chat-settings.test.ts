import { describe, expect, it } from 'vitest';
import { CHAT_MODEL, chatCostUsd, chatLimits, defaultChatSettings, matchCanned, normalizeChatSettings } from './chat-settings';

describe('normalizeChatSettings', () => {
  it('liefert ohne Eingabe die Standardwerte – der Chat ist zunächst aus', () => {
    const s = normalizeChatSettings(undefined);
    expect(s).toEqual(defaultChatSettings());
    expect(s.enabled).toBe(false);
    expect(s.model).toBe('auto');
    expect(CHAT_MODEL).toBe('claude-haiku-5-5');
  });

  it('begrenzt Zahlen und verwirft ungültige Werte', () => {
    const s = normalizeChatSettings({ monthlyBudgetUsd: -5, maxMessages: 9999, maxAnswerTokens: 10, retentionDays: 0, handoff: { notifyChannelId: 'abc' }, model: 'claude-opus' });
    expect(s.monthlyBudgetUsd).toBe(0);
    expect(s.maxMessages).toBe(200);
    expect(s.maxAnswerTokens).toBe(150);
    expect(s.retentionDays).toBe(1);
    expect(s.handoff.notifyChannelId).toBe('');
    // Das Modell lässt sich nicht hochsetzen – es bleibt beim günstigsten
    expect(s.model).toBe('auto');
  });

  it('räumt vorgefertigte Antworten auf', () => {
    const s = normalizeChatSettings({
      canned: [
        { id: 'A B', question: { de: 'Frage eins', en: '' }, answer: { de: 'Antwort', en: '' }, keywords: [' Eins ', 'eins', 'x', 5], quick: false },
        { id: 'ok', question: { de: '', en: '' }, answer: { de: 'ohne Frage', en: '' } },
        { id: 'ok', question: { de: 'Zwei', en: 'Two' }, answer: { de: '', en: '' }, keywords: [] },
        { id: 'ok', question: { de: 'Drei', en: 'Three' }, answer: { de: 'c', en: 'c' }, keywords: [] },
      ],
    });
    expect(s.canned.map((a) => a.id)).toEqual(['antwort-1', 'ok', 'ok-2']);
    expect(s.canned[0]).toMatchObject({ question: { de: 'Frage eins', en: 'Frage eins' }, keywords: ['eins'], quick: false });
    // Leere Antwort bleibt leer: Das bedeutet „direkt an einen Mitarbeiter weitergeben“
    expect(s.canned[1]!.answer).toEqual({ de: '', en: '' });
  });

  it('kürzt Zusatzwissen und zu viele Antworten', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `a${i}`, question: { de: `Frage ${i}`, en: `Question ${i}` }, answer: { de: 'x', en: 'x' }, keywords: [] }));
    const s = normalizeChatSettings({ canned: many, extraKnowledge: 'x'.repeat(50_000) });
    expect(s.canned).toHaveLength(chatLimits.canned);
    expect(s.extraKnowledge).toHaveLength(chatLimits.extraKnowledge);
  });
});

describe('matchCanned', () => {
  const canned = defaultChatSettings().canned;

  it('erkennt angeklickte Vorschläge in beiden Sprachen', () => {
    expect(matchCanned('Kostet das etwas?', canned)?.id).toBe('cost');
    expect(matchCanned('how do i create a server', canned)?.id).toBe('create');
  });

  it('erkennt Stichwörter in kurzen Fragen – als ganze Wörter', () => {
    expect(matchCanned('mein server startet nicht!!', canned)?.id).toBe('nostart');
    expect(matchCanned('Wo ist das Panel?', canned)?.id).toBe('panel');
    // „panel“ steckt in „Panelbau“ nur als Wortteil
    expect(matchCanned('Panelbau lernen', canned)).toBeNull();
  });

  it('nimmt bei mehreren Treffern das längste Stichwort', () => {
    expect(matchCanned('server erstellen kostet?', canned)?.id).toBe('create');
  });

  it('überlässt lange Nachrichten der KI', () => {
    expect(matchCanned('Ich habe gestern im Panel ein Plugin hochgeladen und seitdem sehe ich in der Konsole einen Fehler mit Java, was bedeutet das genau', canned)).toBeNull();
  });

  it('findet den Wunsch nach einem Mitarbeiter', () => {
    const hit = matchCanned('ich will einen Mitarbeiter', canned);
    expect(hit?.id).toBe('human');
    expect(hit?.answer.de).toBe('');
  });
});

describe('chatCostUsd', () => {
  it('rechnet mit den Preisen des günstigsten Modells', () => {
    // 1 Mio. Eingabe + 1 Mio. Ausgabe
    expect(chatCostUsd({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.6, 6);
    // Aus dem Zwischenspeicher gelesene Tokens kosten ein Zehntel
    expect(chatCostUsd({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(0.01, 6);
  });
});
