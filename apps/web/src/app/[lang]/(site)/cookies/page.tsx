import { CookiesDe, CookiesEn } from '@/content/legal/cookies';
import { legalRoute } from '@/content/legal/page-factory';

const route = legalRoute('cookies', { de: CookiesDe, en: CookiesEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
