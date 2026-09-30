export type QuoteCategory =
  | "brutal-reality"
  | "shame-guilt"
  | "discipline"
  | "perspective"
  | "success-ambition"
  | "axom-original";

export type QuoteAttributionStatus =
  | "verified"
  | "commonly-attributed"
  | "paraphrased"
  | "axom-original"
  | "unverified";

export interface AxomQuote {
  id: string;
  text: string;
  author: string;
  category: QuoteCategory;
  intensity: 1 | 2 | 3 | 4 | 5;
  guilt: boolean;
  attributionStatus: QuoteAttributionStatus;
  attributionNote: string;
}

/** Exact text of the 100 numbered entries in `Quote Librabry v1.txt.rtf`. */
const QUOTE_TEXTS = [
  "The person you become is hidden inside the work you’re avoiding.",
  "Comfort has never introduced anyone to greatness.",
  "Your future is quietly watching what you do today.",
  "Every excuse sounds reasonable until someone else succeeds anyway.",
  "Discipline is choosing what you want most over what you want now.",
  "One day or day one. You decide.",
  "You cannot cheat your future self.",
  "No one is coming to rescue your potential.",
  "Talent is rented. Rent is due every day.",
  "Nothing changes if nothing changes.",
  "Dreams don’t die. They get abandoned.",
  "The clock never asks whether you felt motivated.",
  "Your habits are voting for the person you’ll become.",
  "The cost of discipline is always less than the cost of regret.",
  "You are always practicing something.",
  "Average is built one comfortable decision at a time.",
  "Action creates confidence. Waiting creates doubt.",
  "Your competition isn’t resting because you’re tired.",
  "Hard choices create easy lives.",
  "If you keep negotiating with laziness, laziness always wins.",
  "The version of you that dreamed about this life deserved better than today’s excuses.",
  "You prayed for opportunities you’re now too distracted to use.",
  "Your younger self believed you’d be farther by now.",
  "No one ruined your momentum today. Check your screen time.",
  "Imagine explaining your habits to the person who sacrificed everything for you.",
  "Regret is interest paid on procrastination.",
  "You know exactly what you’re avoiding.",
  "Every skipped session teaches your brain quitting is acceptable.",
  "You don’t hate studying. You hate starting.",
  "The guilt you feel tonight is tomorrow asking for help.",
  "The life you want cannot be built between notifications.",
  "Your goals don’t need another promise. They need another hour.",
  "Nobody remembers the intentions you never acted on.",
  "You can lie to everyone except your own potential.",
  "Somewhere, someone with half your talent is building twice your future.",
  "Avoidance feels safe until years disappear.",
  "The mirror keeps every receipt.",
  "Every day you postpone becoming disciplined, life keeps charging interest.",
  "Excuses are usually true. They’re just irrelevant.",
  "Your future isn’t angry. It’s disappointed.",
  "We are what we repeatedly do. Excellence, then, is not an act but a habit.",
  "Do the hard thing first.",
  "Small wins become unstoppable momentum.",
  "Consistency beats intensity.",
  "Your schedule reveals your priorities.",
  "Motivation is unreliable. Systems endure.",
  "Routine defeats resistance.",
  "Discipline is freedom.",
  "Success is rented. Rent is due daily.",
  "Master boring.",
  "The first five minutes decide the next five hours.",
  "Start before you’re ready.",
  "The hardest part is often standing up.",
  "Done beats perfect.",
  "Repetition builds identity.",
  "Momentum loves movement.",
  "Work while emotions are quiet.",
  "Train consistency, not heroics.",
  "Keep promises made to yourself.",
  "The work counts whether anyone notices or not.",
  "Comparison steals gratitude.",
  "A bad day is not a bad life.",
  "Progress is rarely dramatic.",
  "Storms produce stronger roots.",
  "Pressure creates diamonds, provided the carbon doesn’t file a complaint.",
  "Patience is active, not passive.",
  "Growth feels like discomfort.",
  "You don’t rise to goals. You fall to systems.",
  "Your pace is not your destination.",
  "The mountain never gets smaller. You get stronger.",
  "Every expert once looked ridiculous.",
  "Confidence follows competence.",
  "The seed grows underground first.",
  "Every masterpiece looked unfinished once.",
  "Time rewards the consistent.",
  "Stay hungry. Stay foolish.",
  "Fortune favors the bold.",
  "Greatness compounds.",
  "The best investment is yourself.",
  "Earn the confidence you seek.",
  "Nobody can outwork time, but many waste it.",
  "Vision without execution is fantasy.",
  "Success whispers before it shouts.",
  "Be impossible to ignore.",
  "Your work introduces you.",
  "Reputation is built in private.",
  "The world rewards value.",
  "Focus is a competitive advantage.",
  "Build skills that survive trends.",
  "Leave evidence of your effort.",
  "The person you become is the greatest project you’ll ever build.",
  "Every study session is another brick in a future no one else can see.",
  "The world doesn’t owe you motivation. Build discipline instead.",
  "Knowledge compounds. So does neglect.",
  "Today’s effort is tomorrow’s confidence.",
  "If today felt ordinary, remember that extraordinary lives are assembled from ordinary days repeated.",
  "Your future patients deserve today’s discipline.",
  "You don’t have to feel ready. You only have to begin.",
  "One focused hour outweighs ten distracted ones.",
  "Become someone your past self would trust with their dreams.",
] as const;

const SOURCE_ATTRIBUTIONS: Partial<Record<number, { author: string; status: QuoteAttributionStatus; note: string }>> = {
  5: { author: "Abraham Lincoln", status: "commonly-attributed", note: "Source file labels this attribution as disputed." },
  6: { author: "Common proverb", status: "commonly-attributed", note: "Presented as a common proverb; no original author supplied." },
  9: { author: "J. J. Watt", status: "unverified", note: "Source file attributes this to J. J. Watt without a verification source." },
  10: { author: "Common saying", status: "commonly-attributed", note: "Presented as a common saying; no original author supplied." },
  13: { author: "James Clear", status: "paraphrased", note: "Source file explicitly identifies this as a paraphrased idea." },
  19: { author: "Jerzy Gregorek", status: "unverified", note: "Source file attributes this to Jerzy Gregorek without a verification source." },
  41: { author: "Will Durant", status: "paraphrased", note: "Source file describes this as Will Durant summarizing Aristotle." },
  48: { author: "Jocko Willink", status: "unverified", note: "Source file attributes this to Jocko Willink without a verification source." },
  61: { author: "Theodore Roosevelt", status: "unverified", note: "Source file supplies this attribution without a verification source." },
  76: { author: "Steve Jobs", status: "unverified", note: "Source file supplies this attribution without a verification source." },
};

function sourceCategory(number: number): { category: QuoteCategory; intensity: 1 | 2 | 3 | 4 | 5; guilt: boolean } {
  if (number <= 20) return { category: "brutal-reality", intensity: 4, guilt: false };
  if (number <= 40) return { category: "shame-guilt", intensity: 5, guilt: true };
  if (number <= 60) return { category: "discipline", intensity: 3, guilt: false };
  if (number <= 75) return { category: "perspective", intensity: 2, guilt: false };
  if (number <= 90) return { category: "success-ambition", intensity: 3, guilt: false };
  return { category: "axom-original", intensity: 3, guilt: false };
}

function attribution(number: number) {
  const explicit = SOURCE_ATTRIBUTIONS[number];
  if (explicit) return explicit;
  if (number <= 4 || (number >= 7 && number <= 8) || (number >= 11 && number <= 18) || number === 20 || (number >= 21 && number <= 40) || number >= 91) {
    return { author: "AXOM", status: "axom-original" as const, note: "Identified as an AXOM Original in the source file." };
  }
  return { author: "Unattributed", status: "unverified" as const, note: "No attribution was supplied in the source file." };
}

/** Library v1: the exact 100 numbered entries from the source file. Pinned. */
export const AXOM_QUOTE_LIBRARY_V1: readonly AxomQuote[] = Object.freeze(QUOTE_TEXTS.map((text, index) => {
  const number = index + 1;
  const source = attribution(number);
  return {
    id: `quote-${String(number).padStart(3, "0")}`,
    text,
    author: source.author,
    ...sourceCategory(number),
    attributionStatus: source.status,
    attributionNote: source.note,
  };
}));

/**
 * Library v2 (2026-09): AXOM Originals written for the product voice — calm,
 * clinical, anti-overload. Discipline without shame; none are guilt-category.
 * Append-only: ids are stable (quote-101 onward) so favorites/hidden survive.
 */
const AXOM_ORIGINAL_V2_TEXTS = [
  "Show up small. Show up again.",
  "The block you finish is worth more than the plan you perfect.",
  "Calm is a skill. Practice it between questions.",
  "You are allowed to be tired and still be consistent.",
  "Retrieval feels uncomfortable because it is working.",
  "A wrong answer today is a right answer on exam day.",
  "Protect the first hour. It sets the tone for the rest.",
  "Enough is a number. Find yours, then stop.",
  "Rest is part of the protocol, not a break from it.",
  "The goal is contact with the material, not a war with it.",
  "Every card you review is a patient you will recognize.",
  "Precision first. Speed follows.",
  "Your notes are the map. Questions are the terrain.",
  "Don’t chase the perfect day. Stack honest ones.",
  "The syllabus is long. So is your runway.",
  "Missed yesterday? Today still counts in full.",
  "Attention is the scarcest thing you own. Spend it on purpose.",
  "One more question is how the hard concepts finally land.",
  "Understanding is slower than memorizing, and it lasts far longer.",
  "The anxiety fades. The knowledge stays.",
  "Treat your focus like a sterile field.",
  "You don’t need more time. You need fewer tabs.",
  "Close the loop before you open a new one.",
  "Recovery is not falling behind. It is how you stay in the race.",
  "Mastery is repetition that stopped feeling boring.",
  "Learn it like someone’s life depends on it. Someday it will.",
  "The exam measures one morning. Your habits built it.",
  "Finish the lecture you started before opening the one you fear.",
  "Honest logs beat impressive ones.",
  "Keep the streak kind and the standard high.",
  "The hardest question on the page is the one teaching you most.",
  "Momentum is built in minutes, not in moods.",
  "Put the phone in another room. Put your future in this one.",
  "Your best study days rarely feel special while you are in them.",
  "Don’t negotiate with the timer. Start it.",
  "Confusion is the doorway, not the wall.",
  "A clear desk, a clear block, a closed door.",
  "Be the learner who reviews mistakes on purpose.",
  "Today, just outwork the version of you from last week.",
  "Evidence over feelings: log the work and let it speak.",
  "You are building clinical judgment one decision at a time.",
  "Hard days are still data. Keep them.",
  "Mercy for yourself, rigor for the material.",
  "The plan is a promise. The review is the proof.",
  "Every attending you admire once missed this exact question.",
  "Study like the patient is already in the room.",
  "Accuracy climbs quietly for weeks, then shows up all at once.",
  "Stop when you hit enough. Tomorrow needs you too.",
  "A tired mind still keeps what it retrieved.",
  "Your worst week of studying still moved you forward.",
  "Make the next step so small you can’t refuse it.",
  "Nobody sees the early-morning flashcards. Your patients will feel them.",
  "Questions first. Feelings later.",
  "You can’t cram judgment. You can only build it.",
  "There is no shortcut around physiology, only a path through it.",
  "Earn the weekend with a focused Tuesday.",
  "A good block ends with one note for tomorrow.",
  "Busy is not the same as better.",
  "What you review today, you won’t have to relearn next month.",
  "Take the break before burnout takes it for you.",
  "Stop rehearsing the start. Start.",
  "Your attention is the instrument. Keep it tuned.",
  "Breathe. Sip water. Next question.",
  "One chapter fully understood beats three skimmed.",
  "Future you is counting on present you to press start.",
  "Keep the promise small enough to keep.",
  "The work is quiet. The results are not.",
  "Discipline is memory: remembering why you started.",
  "Doubt is loudest at the start of every block. Start anyway.",
  "Progress hides in the reviews you almost skipped.",
  "The material doesn’t care how you feel. Luckily, it doesn’t need to.",
  "Consistency is the quiet flex.",
  "Know the mechanism and the facts will follow.",
  "Measure the day by what now makes sense, not by hours spent.",
  "Your future self is already grateful. Don’t keep them waiting.",
  "Be steady. Steady wins long races.",
  "Lock in. The world will still be there in fifty minutes.",
  "When in doubt, do one more pass.",
  "Every correct answer was once a mistake you studied.",
  "Build the doctor you would want treating your family.",
] as const;

export const AXOM_ORIGINALS_V2: readonly AxomQuote[] = Object.freeze(AXOM_ORIGINAL_V2_TEXTS.map((text, index) => ({
  id: `quote-${String(101 + index).padStart(3, "0")}`,
  text,
  author: "AXOM",
  category: "axom-original" as const,
  intensity: 2 as const,
  guilt: false,
  attributionStatus: "axom-original" as const,
  attributionNote: "AXOM Original — library v2 (September 2026).",
})));

/** Product-authored lines are versioned separately from the supplied library. */
export const AXOM_ORIGINALS_V3: readonly AxomQuote[] = Object.freeze([
  "Make a small piece of the unknown more familiar.",
  "A careful answer begins with a better question.",
  "Give your attention a place to stay.",
  "The page is a place to think, not a place to perform.",
  "Leave room in your certainty for new evidence.",
  "The useful detail is often the one you nearly passed over.",
  "A good explanation makes its assumptions visible.",
  "Keep the question open long enough to learn from it.",
  "Aim for work you can stand behind when the room is quiet.",
  "Build something your future attention can rely on.",
  "You can revise the plan without abandoning the purpose.",
  "Let the next attempt be informed by the last.",
  "Some days the achievement is a clearer question.",
  "The first draft gives your judgment something to work with.",
  "Do the part that brings the rest into focus.",
  "Your standards should make the work clearer, not impossible.",
  "The margin is where a borrowed idea becomes your own question.",
  "A precise uncertainty is more useful than a vague confidence.",
  "Put the mechanism beside the fact.",
  "Read until you can name what you still do not understand.",
  "Good work leaves a path that another mind can follow.",
  "A quiet hour can hold a difficult idea.",
  "Leave a trace of the reasoning, not just the result.",
  "The point of a system is to return your attention to the work.",
  "Choose a stopping point that gives tomorrow a beginning.",
  "A useful routine has room for an unusual day.",
  "Let the evidence earn the conclusion.",
  "The next revision is allowed to be smaller than the first ambition.",
  "Learn the distinction that changes the decision.",
  "There is a craft to noticing what matters.",
  "Make the invisible assumption legible.",
  "Care is a method as much as an intention.",
  "The work becomes yours when you can explain your choices.",
  "What you leave out should be a decision, too.",
  "Follow the thread until the pieces fit.",
  "A complete thought is worth giving time to.",
  "Return to the difficult paragraph with a different question.",
  "Keep a place for the evidence that changes your mind.",
  "The next useful thing is often close at hand.",
  "Let your tools carry the repetition. Keep the judgment.",
  "Today’s task can be modest and still matter.",
  "Build the understanding that makes the shortcut safe.",
  "Do enough to see the next decision clearly.",
  "A good stopping point preserves the thread.",
  "Make the work easier to return to.",
  "The question deserves your curiosity before your conclusion.",
  "A careful revision is a form of respect for the reader.",
  "Bring one more thing into focus before you leave.",
].map((text, index) => ({ id: `axom-original-v3-${String(index + 1).padStart(3, "0")}`, text, author: "AXOM", category: "axom-original" as const, intensity: 2 as const, guilt: false, attributionStatus: "axom-original" as const, attributionNote: "Written for AXOM — Originals volume 3, September 2026." })));

/** The full, append-only library. v1 is pinned; later volumes only append. */
export const AXOM_QUOTES: readonly AxomQuote[] = Object.freeze([...AXOM_QUOTE_LIBRARY_V1, ...AXOM_ORIGINALS_V2, ...AXOM_ORIGINALS_V3]);

export const QUOTE_CATEGORY_LABELS: Record<QuoteCategory, string> = {
  "axom-original": "AXOM Originals",
  discipline: "Discipline",
  perspective: "Perspective",
  "success-ambition": "Ambition",
  "brutal-reality": "Brutal reality",
  "shame-guilt": "Guilt & shame",
};
