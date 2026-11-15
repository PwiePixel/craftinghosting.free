import { legalRoute } from '@/content/legal/page-factory';
import { RulesDe, RulesEn } from '@/content/legal/rules';

const route = legalRoute('rules', { de: RulesDe, en: RulesEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
