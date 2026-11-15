'use client';

import { useState } from 'react';
import type { ZodType } from 'zod';
import { issueMessage } from '@chfree/shared';
import { useDict, useLang } from '@/i18n/client';
import { ApiClientError } from './api/client';

/** Kleiner Formular-Helfer: Validierung mit den gemeinsamen Schemas + API-Fehler. */
export function useForm<T>(schema?: ZodType<T>) {
  const lang = useLang();
  const t = useDict();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(values: unknown, action: (data: T) => Promise<void>) {
    setError(null);
    setFieldErrors({});
    let data = values as T;
    if (schema) {
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        const errs: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? '_');
          if (!errs[key]) errs[key] = issueMessage(issue, lang);
        }
        setFieldErrors(errs);
        return;
      }
      data = parsed.data;
    }
    setPending(true);
    try {
      await action(data);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError(t.common.unexpectedError);
      }
    } finally {
      setPending(false);
    }
  }

  return { fieldErrors, error, pending, submit, setError, setFieldErrors };
}
