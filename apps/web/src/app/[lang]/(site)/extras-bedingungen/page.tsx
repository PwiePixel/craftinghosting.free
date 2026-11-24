import { ExtrasTermsDe, ExtrasTermsEn } from '@/content/legal/extras-terms';
import { legalRoute } from '@/content/legal/page-factory';

const route = legalRoute('extrasTerms', { de: ExtrasTermsDe, en: ExtrasTermsEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
