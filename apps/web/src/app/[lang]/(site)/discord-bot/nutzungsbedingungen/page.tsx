import { DiscordTermsDe, DiscordTermsEn } from '@/content/legal/discord-terms';
import { legalRoute } from '@/content/legal/page-factory';

const route = legalRoute('discordTerms', { de: DiscordTermsDe, en: DiscordTermsEn });
export const generateMetadata = route.generateMetadata;
export default route.Page;
