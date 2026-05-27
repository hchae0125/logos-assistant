import { gmail_v1 } from 'googleapis';

export function cleanEmailBody(text: string): string {
  if (!text) return "";
  let cleaned = text;

  const quoteIndicators = [
    /on\s+[a-z]{3},\s+[a-z]{3}\s+\d+[\s\S]+?wrote:/i, 
    /on\s+\d{4}-\d{2}-\d{2}[\s\S]+?wrote:/i,           
    /---+\s*original\s*message\s*---+/i,              
    /from:\s*[^\s@]+@[^\s@]+/i                         
  ];

  for (const indicator of quoteIndicators) {
    const match = cleaned.match(indicator);
    if (match && match.index !== undefined) {
      cleaned = cleaned.substring(0, match.index);
    }
  }

  cleaned = cleaned
    .replace(/\s+/g, ' ') 
    .replace(/>+/g, '')   
    .replace(/iPhone에서 보냄|Sent from my iPhone|Galaxy에서 보냄/gi, ''); 

  if (cleaned.length > 1000) {
    cleaned = cleaned.substring(0, 1000) + "... [후략]";
  }
  return cleaned.trim();
}

export function extractText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  if (part.parts && part.parts.length > 0) {
    let accumulatedText = "";
    for (const subPart of part.parts) {
      accumulatedText += extractText(subPart);
    }
    return accumulatedText;
  }
  return "";
}