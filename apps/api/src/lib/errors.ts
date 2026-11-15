import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { issueMessage, type Locale, type Localized } from '@chfree/shared';
import { resolveText, type LText } from './text';

/** Text in beiden Sprachen – kurz für Fehlermeldungen */
export const L = (de: string, en: string): Localized => ({ de, en });

type Text = LText;

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public text: Text,
    public fields?: Record<string, Text>,
  ) {
    super(resolveText(text, 'de'));
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, 'unauthorized', L('Bitte melde dich an.', 'Please sign in.')),
  forbidden: (msg: Text = L('Keine Berechtigung.', 'Permission denied.')) => new ApiError(403, 'forbidden', msg),
  notFound: (msg: Text = L('Nicht gefunden.', 'Not found.')) => new ApiError(404, 'not_found', msg),
  conflict: (code: string, msg: Text) => new ApiError(409, code, msg),
  badRequest: (code: string, msg: Text, fields?: Record<string, Text>) => new ApiError(400, code, msg, fields),
  unavailable: (
    msg: Text = L('Der Dienst ist vorübergehend nicht erreichbar. Bitte versuche es gleich erneut.', 'The service is temporarily unavailable. Please try again shortly.'),
  ) => new ApiError(503, 'service_unavailable', msg),
};

export function zodFields(error: ZodError, locale: Locale): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issueMessage(issue, locale);
  }
  return fields;
}

function resolveFields(fields: Record<string, Text> | undefined, locale: Locale) {
  if (!fields) return undefined;
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, resolveText(v, locale)]));
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | ApiError | ZodError, request, reply) => {
    const locale: Locale = request.lang ?? 'de';
    if (error instanceof ApiError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: resolveText(error.text, locale), fields: resolveFields(error.fields, locale) } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: resolveText(L('Bitte überprüfe deine Eingaben.', 'Please check your input.'), locale),
          fields: zodFields(error, locale),
        },
      });
    }
    const fe = error as FastifyError;
    if (fe.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'rate_limited', message: resolveText(L('Zu viele Anfragen. Bitte warte einen Moment.', 'Too many requests. Please wait a moment.'), locale) } });
    }
    if (fe.statusCode && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'bad_request', message: fe.message } });
    }
    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: resolveText(L('Ein interner Fehler ist aufgetreten.', 'An internal error occurred.'), locale) } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: resolveText(L('Endpunkt nicht gefunden.', 'Endpoint not found.'), request.lang ?? 'de') } });
  });
}
