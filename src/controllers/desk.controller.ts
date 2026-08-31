import { Request, Response } from "express";

type DeskQuote = { text: string; author: string };
const fallbacks: DeskQuote[] = [
  { text: "Great things are done by a series of small things brought together.", author: "Vincent van Gogh" },
  { text: "It always seems impossible until it is done.", author: "Nelson Mandela" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
];
let cached: { quote: DeskQuote; expiresAt: number } | null = null;

export async function getDeskQuote(_req: Request, res: Response) {
  if (cached && cached.expiresAt > Date.now()) return res.json({ success: true, quote: cached.quote, source: "cache" });
  try {
    const response = await fetch("https://zenquotes.io/api/random", { signal: AbortSignal.timeout(4000) });
    const data = await response.json() as Array<{ q?: string; a?: string }>;
    const item = data[0];
    if (!response.ok || !item?.q || !item?.a) throw new Error("Quote service returned no quote.");
    cached = { quote: { text: item.q.slice(0, 240), author: item.a.slice(0, 80) }, expiresAt: Date.now() + 60 * 60 * 1000 };
  } catch {
    const dayIndex = Math.floor(Date.now() / 86_400_000) % fallbacks.length;
    cached = { quote: fallbacks[dayIndex], expiresAt: Date.now() + 15 * 60 * 1000 };
  }
  return res.json({ success: true, quote: cached.quote });
}
