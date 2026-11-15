import { ImprintDe, ImprintEn } from '@/content/legal/imprint';
import { legalRoute } from '@/content/legal/page-factory';

const route = legalRoute('imprint', { de: ImprintDe, en: ImprintEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
