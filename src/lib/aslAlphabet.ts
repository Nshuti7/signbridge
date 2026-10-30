/**
 * Map of characters to their corresponding ASL SVG paths.
 * 
 * TO UPDATE IMAGES: 
 * Simply replace the files in /public/asl/ (e.g., /public/asl/A.svg) 
 * with high-quality hand-shape illustrations. The code will automatically 
 * reference them by the character key.
 */

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const digits = '0123456789'.split('');
const allChars = [...letters, ...digits];

export const aslAlphabet: Record<string, string> = allChars.reduce((acc, char) => {
  acc[char] = `/asl/${char}.svg`;
  return acc;
}, {} as Record<string, string>);

// Type helper for components to check if a character is signable
export const isSignable = (char: string): boolean => {
  return aslAlphabet.hasOwnProperty(char.toUpperCase());
};