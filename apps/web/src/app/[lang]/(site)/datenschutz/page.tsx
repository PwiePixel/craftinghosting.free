import { legalRoute } from '@/content/legal/page-factory';
import { PrivacyDe, PrivacyEn } from '@/content/legal/privacy';

const route = legalRoute('privacy', { de: PrivacyDe, en: PrivacyEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
