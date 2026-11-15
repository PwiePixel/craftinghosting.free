import { notFound } from 'next/navigation';

/** Alle unbekannten Pfade → 404-Seite in der passenden Sprache */
export default function CatchAll() {
  notFound();
}
