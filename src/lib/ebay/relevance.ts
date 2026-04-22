import { EbayComp } from '@/types'

/**
 * Post-filter eBay comps for relevance against a listing title.
 *
 * Strategy:
 *   1. Tokenize both the listing title and each comp title (lowercase, strip
 *      punctuation, drop stopwords, drop tokens <= 2 chars).
 *   2. Compute overlap ratio = (shared tokens) / (listing tokens).
 *   3. If the listing contains a known brand token, the comp MUST also
 *      contain that brand token to survive.
 *   4. Keep comps with overlap >= `minOverlap` (default 0.5).
 *   5. If fewer than `minSurvivors` comps survive, return the original
 *      unfiltered list — better to have noisy comps than zero data.
 *
 * This is deliberately conservative: it trims obvious mismatches (e.g. a
 * "Toro TimeCutter" listing pulling up "Toro weed trimmer" comps) without
 * requiring a taxonomy or ML.
 */
export interface RelevanceOptions {
  minOverlap?: number
  minSurvivors?: number
}

const STOP_WORDS = new Set([
  'for', 'sale', 'by', 'owner', 'obo', 'or', 'best', 'offer',
  'new', 'used', 'great', 'condition', 'like', 'works', 'good',
  'the', 'and', 'with', 'very', 'must', 'see', 'price', 'firm',
  'nice', 'clean', 'runs', 'excellent', 'perfect', 'part', 'parts',
  'only', 'all', 'one', 'two', 'three', 'four', 'five',
  'oem', 'original', 'set', 'lot', 'pack', 'piece', 'pieces',
  'free', 'ship', 'shipping', 'usa',
])

// Brands we care about for this project. If any token in the listing
// matches one of these, the comp must include it too.
const BRAND_TOKENS = new Set([
  'toro', 'husqvarna', 'scag', 'exmark', 'gravely', 'ferris',
  'ariens', 'kubota', 'simplicity', 'craftsman', 'troy-bilt',
  'troybilt', 'cub', 'cadet', 'deere', 'honda', 'stihl', 'echo',
  'ryobi', 'dewalt', 'milwaukee', 'makita', 'bosch',
  'clubcar', 'ezgo', 'yamaha', 'kawasaki', 'briggs', 'stratton',
  'bigtex', 'loadtrail', 'badboy', 'bad', 'boy',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
}

export function filterRelevantComps(
  listingTitle: string,
  comps: EbayComp[],
  opts: RelevanceOptions = {}
): EbayComp[] {
  const minOverlap = opts.minOverlap ?? 0.5
  const minSurvivors = opts.minSurvivors ?? 3

  if (!listingTitle || comps.length === 0) return comps

  const listingTokens = new Set(tokenize(listingTitle))
  if (listingTokens.size === 0) return comps

  // Detect brand in listing
  const listingBrand = Array.from(listingTokens).find(t => BRAND_TOKENS.has(t))

  const scored = comps.map(comp => {
    const compTokens = new Set(tokenize(comp.title || ''))

    // Hard requirement: if listing has a brand, comp must too
    if (listingBrand && !compTokens.has(listingBrand)) {
      return { comp, overlap: 0, kept: false }
    }

    let shared = 0
    for (const t of listingTokens) if (compTokens.has(t)) shared++
    const overlap = shared / listingTokens.size
    return { comp, overlap, kept: overlap >= minOverlap }
  })

  const survivors = scored.filter(s => s.kept).map(s => s.comp)

  if (survivors.length < minSurvivors) {
    // Too strict — back off and return unfiltered rather than give the user nothing.
    console.log(
      `Relevance filter kept only ${survivors.length} comps (min ${minSurvivors}); falling back to unfiltered list of ${comps.length}.`
    )
    return comps
  }

  console.log(
    `Relevance filter: kept ${survivors.length} of ${comps.length} comps (brand="${listingBrand ?? 'none'}", minOverlap=${minOverlap}).`
  )
  return survivors
}
