/**
 * Correct obvious missing spaces in plaintext pasted into a narration script.
 * Preserve all other characters, including paragraphs and punctuation.
 * Never rewrite already saved narration or arbitrary HTML.
 */
export const normalizePastedNarration = (text: string): string => {
  // Ignore a URL or email token: punctuation is meaningful inside them.
  return text.split(/(\s+)/).map(token => {
    if (/^(?:https?:\/\/|www\.|\S+@\S+\.)/i.test(token)) return token;
    // "risk.Stop" -> "risk. Stop". Do not alter decimals, U.S.A., or file extensions.
    return token.replace(/([a-z0-9][.!?])(?=[A-Z][a-z])/g, '$1 ');
  }).join('');
};
