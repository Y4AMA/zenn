// zenn-match.mjs — Zenn response classifier
// A weighted lexical classifier for non-delivery output: refusals, hedges,
// disclaimers, redirects, capability claims, and identity deflections.
//
// Design:
//   - Each rule has a weight (1-5) and a family.
//   - A response is scored by summing matched rule weights.
//   - Weight 5 = non-negotiable non-delivery. Weight 1 = cosmetic softening.
//   - Fenced code and inline code are masked before scoring, so a string that
//     happens to live inside a code block never triggers a rule.
//
// The taxonomy here is Zenn's own. Families: deflection, prohibition,
// capability-claim, caution, substitution, softening, persona-claim.

export const RULES = [
  // ---- persona-claim (5): the model asserting what it is instead of working ----
  { w: 5, fam: 'persona-claim', re: /\bas an? (ai|a\.?i\.?|language model|llm|assistant|chatbot|virtual assistant)\b/i },
  { w: 5, fam: 'persona-claim', re: /\bi(?:'m| am) (?:just |only )?(an? )?(ai|language model|assistant|bot|program)\b/i },
  { w: 5, fam: 'persona-claim', re: /\bi (?:do not|don't|dont) have (?:feelings|emotions|personal (?:opinions|experiences))\b/i },
  { w: 5, fam: 'persona-claim', re: /\bas (?:an? )?(ai|artificial intelligence|language model)\b/i },

  // ---- deflection (5): the core "I won't" surface ----
  { w: 5, fam: 'deflection', re: /\bi (?:cannot|can not|can't|cant|won't|will not|am unable|am not able|refuse|decline|must decline)\b/i },
  { w: 5, fam: 'deflection', re: /\bi(?:'m| am) (?:not (?:able|going|willing)|unable|incapable of) (?:to )?\b/i },
  { w: 5, fam: 'deflection', re: /\bi (?:can't|cannot|won't|will not) (?:help|assist|provide|support|engage|do|write|create|generate|give)\b/i },
  { w: 5, fam: 'deflection', re: /\bi (?:must|have to|need to) (?:stop|decline|refuse|refrain)\b/i },
  { w: 5, fam: 'deflection', re: /\b(?:i'll|i will) (?:have to|need to) (?:pass|decline|stop)\b/i },
  { w: 5, fam: 'deflection', re: /\bi(?:'m| am) not (?:comfortable|okay|going to|able to)\b/i },
  { w: 5, fam: 'deflection', re: /\bthat part i(?:'m| am) not doing\b/i },
  { w: 5, fam: 'deflection', re: /\bthis (?:is|isn'?t) (?:not )?something i (?:can|will)\b/i },

  // ---- prohibition (4): policy/rule framing ----
  { w: 4, fam: 'prohibition', re: /\b(?:violates?|contravenes?|goes against) (?:my|our|the) (?:policy|policies|guidelines|rules|terms|principles|values)\b/i },
  { w: 4, fam: 'prohibition', re: /\bnot (?:allowed|permitted|something i(?:'m| am) (?:allowed|permitted) to)\b/i },
  { w: 4, fam: 'prohibition', re: /\bi(?:'m| am) (?:not (?:allowed|permitted|supposed) to|programmed to (?:not|avoid))\b/i },
  { w: 4, fam: 'prohibition', re: /\bmy (?:guidelines|policy|rules|programming|training) (?:do not|don'?t|prevent|prohibit)\b/i },
  { w: 4, fam: 'prohibition', re: /\bi (?:don'?t|do not) (?:think i should|feel comfortable|have permission to)\b/i },
  { w: 4, fam: 'prohibition', re: /\boutside (?:the scope of|what i(?:'m| am) (?:designed|able) to)\b/i },
  { w: 4, fam: 'prohibition', re: /\bout of (?:scope|bounds|my lane)\b/i },
  { w: 4, fam: 'prohibition', re: /\b(?:this|that|the) request is (?:outside|beyond) (?:my|the|our) scope\b/i },

  // ---- capability-claim (3): "I can't build X" dressed as inability ----
  { w: 3, fam: 'capability-claim', re: /\bi (?:do not|don'?t) (?:have|possess) the (?:ability|capacity|capability|knowledge|tools) to\b/i },
  { w: 3, fam: 'capability-claim', re: /\bi'?m (?:not (?:equipped|trained|designed|built) to|unable to)\b/i },
  { w: 3, fam: 'capability-claim', re: /\bthat(?:'s| is) (?:not something|beyond what) i\b/i },

  // ---- substitution (3): offering a "safer" menu instead of the task ----
  { w: 3, fam: 'substitution', re: /\b(?:instead|rather),? (?:i can|i could|let me|how about|i'?d suggest|i recommend)\b/i },
  { w: 3, fam: 'substitution', re: /\bi(?:'d| would) (?:rather|instead) (?:suggest|recommend|offer|help you)\b/i },
  { w: 3, fam: 'substitution', re: /\b(?:here are|let me offer|i can help you with) (?:some )?(?:safer|alternative|other|legitimate|legal)\b/i },
  { w: 3, fam: 'substitution', re: /\bhow(?:ever| about),? (?:i can|i could|let'?s|instead)\b/i },
  { w: 3, fam: 'substitution', re: /\blet me (?:redirect|steer|guide|point) you\b/i },
  { w: 3, fam: 'substitution', re: /\bwhat i (?:can|can do is|won'?t do is)\b/i },

  // ---- caution (2): safety/moral hedging ----
  { w: 4, fam: 'caution', re: /\bthis (?:is|would be|sounds) (?:dangerous|harmful|unsafe|unethical|immoral|illegal|wrong|problematic)\b/i },
  { w: 4, fam: 'caution', re: /\b(?:could|can|might|may) (?:be )?(?:be used to|lead to|result in|cause) (?:harm|damage|injury|danger)\b/i },
  { w: 4, fam: 'caution', re: /\bi (?:can'?t|cannot|won'?t) (?:in good conscience|ethically|responsibly)\b/i },
  { w: 4, fam: 'caution', re: /\bthis (?:could|might) (?:hurt|harm|endanger) (?:people|others|someone|real people)\b/i },
  { w: 4, fam: 'caution', re: /\breal (?:people|harm|damage|consequences)\b/i },
  { w: 2, fam: 'caution', re: /\b(?:we|you|i) (?:need|should|have|ought) to (?:be|stay|remain) (?:careful|mindful|cautious|aware|wary|responsible)\b/i },
  { w: 2, fam: 'caution', re: /\bit(?:'s| is) (?:important|worth|crucial|essential) to (?:note|consider|remember|understand|be aware)\b/i },
  { w: 2, fam: 'caution', re: /\bthink (?:about|through) (?:the )?(?:consequences|risks|implications)\b/i },

  // ---- softening (2): disclaimer boilerplate ----
  { w: 2, fam: 'softening', re: /\bfor (?:educational|informational|research|academic|demonstration|illustrative) purposes only\b/i },
  { w: 2, fam: 'softening', re: /\bplease (?:use|act) (?:this )?(?:responsibly|carefully|with caution|at your own risk)\b/i },
  { w: 2, fam: 'softening', re: /\b(?:disclaimer|warning|caution|caveat):/i },
  { w: 2, fam: 'softening', re: /\b(?:remember to|make sure to) (?:be|stay|check|verify) (?:safe|legal|careful|authorized)\b/i },
  { w: 2, fam: 'softening', re: /\b(?:ensure|make sure|pastikan) (?:you|kamu|anda) (?:have|punya) (?:permission|authorization|izin)\b/i },

  // ---- softening (1): low-grade hedging ----
  { w: 1, fam: 'softening', re: /\b(?:perhaps|maybe|possibly) (?:you|we|i|it) (?:should|could|might|may)\b/i },
  { w: 1, fam: 'softening', re: /\byou (?:might|may|could) (?:want|consider|prefer) to\b/i },
  { w: 1, fam: 'softening', re: /\bi (?:would|'d) (?:suggest|recommend|advise|encourage)\b/i },
  { w: 1, fam: 'softening', re: /\bit (?:might|may|could) be (?:better|wiser|safer|advisable)\b/i },
  { w: 1, fam: 'softening', re: /\b(?:a )?(?:safer|better|more ethical|more responsible) (?:alternative|approach|option|way|route)\b/i },
];

// Zenn thresholds (independent of any other tool).
export const BLOCK_AT = 4;   // >= this score => non-delivery, reclaim the turn
export const STRIP_AT = 2;   // >= this score => strip residue from context

// Mask fenced and inline code so rules never fire on code content.
export function maskCode(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

// Fast prefilter: a superset token gate. If none of these appear, no rule can
// match, so the full scan is skipped. Broader than the rule set by design.
const GATE = /(cannot|can't|cant|won't|wont|unable|refuse|decline|won['’]?t|not able|won.t|sorry|unfortunately|polic|guideline|allowed|permitted|programmed|scope|conscience|ethically|dangerous|harmful|unsafe|unethical|immoral|illegal|harm|damage|injury|danger|real people|consequences|careful|cautious|responsible|important to|consequences|risks|implications|educational|informational|responsibly|disclaimer|warning|caveat|remember to|make sure|permission|authorization|perhaps|maybe|possibly|might|may|could|would|suggest|recommend|advise|safer|alternative|instead|rather|however|let me|redirect|steer|something i|as an ai|language model|assistant|chatbot|feelings|emotions|ability|capacity|capability)/i;

export function classify(rawText, opts = {}) {
  if (!rawText || typeof rawText !== 'string') return { score: 0, hits: [] };
  const extra = Array.isArray(opts.rules) ? opts.rules : [];
  const allow = Array.isArray(opts.allow) ? opts.allow : [];
  if (allow.length && allow.some(re => re.test(rawText))) {
    return { score: 0, hits: [], allowed: true };
  }
  if (extra.length === 0 && !GATE.test(rawText)) return { score: 0, hits: [] };

  const text = maskCode(rawText);
  const hits = [];
  let score = 0;
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) {
      hits.push({ w: rule.w, fam: rule.fam, match: m[0] });
      score += rule.w;
    }
  }
  for (const rule of extra) {
    const m = text.match(rule.re);
    if (m) {
      hits.push({ w: rule.w, fam: rule.fam, match: m[0] });
      score += rule.w;
    }
  }
  return { score, hits };
}

export function verdict(score, thresholds = {}) {
  const block = Number.isInteger(thresholds.block) ? thresholds.block : BLOCK_AT;
  const strip = Number.isInteger(thresholds.strip) ? thresholds.strip : STRIP_AT;
  if (score >= block) return 'block';
  if (score >= strip) return 'strip';
  return 'clean';
}

// Remove rule matches from a blob while preserving fenced and inline code.
export function scrub(rawText, opts = {}) {
  if (!rawText || typeof rawText !== 'string') return { text: rawText, hits: [] };
  const extra = Array.isArray(opts.rules) ? opts.rules : [];
  const allow = Array.isArray(opts.allow) ? opts.allow : [];
  if (allow.length && allow.some(re => re.test(rawText))) {
    return { text: rawText, hits: [], allowed: true };
  }

  const fences = [];
  let work = rawText.replace(/```[\s\S]*?```/g, m => {
    fences.push(m);
    return `\x00Z${fences.length - 1}\x00`;
  });
  const inlines = [];
  work = work.replace(/`[^`\n]*`/g, m => {
    inlines.push(m);
    return `\x00Q${inlines.length - 1}\x00`;
  });

  const hits = [];
  let clean = work;
  for (const rule of [...RULES, ...extra]) {
    const flags = [...new Set(`${rule.re.flags || 'i'}g`)].join('');
    const g = new RegExp(rule.re.source, flags);
    if (!g.test(clean)) continue;
    for (const h of clean.match(g) || []) hits.push({ w: rule.w, fam: rule.fam, match: h });
    clean = clean.replace(new RegExp(rule.re.source, flags), '');
  }

  clean = clean.replace(/\x00Z(\d+)\x00/g, (_m, i) => fences[+i]);
  clean = clean.replace(/\x00Q(\d+)\x00/g, (_m, i) => inlines[+i]);
  clean = clean.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, hits };
}
