import { legalRoute } from '@/content/legal/page-factory';
import { TermsDe, TermsEn } from '@/content/legal/terms';

const route = legalRoute('terms', { de: TermsDe, en: TermsEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
