# Retrieval quality — design note (2026-07-06)

`THAI_TO_UIDS` (`lib/suttacentral.ts:15`) is a hand-maintained substring map;
questions outside it fall through to `rewriteThaiQuery` (Groq llama-3.1-8b
Thai→English rewrite) or `extractEnKeywords` for English input, then search
SuttaCentral's English-only `/api/search/instant`. This map is the retrieval
quality ceiling: it only catches the ~20 keyword phrases someone has already
added.

## Empirical gap found this session

Live test (2026-07-06): "What is loving-kindness (metta) in Buddhism?" —
answered correctly from general knowledge and even mentioned the Karaniya
Metta Sutta by name in the reply text, but `sources: []` — the sutta was
never actually retrieved/cited, meaning `extractEnKeywords` + SuttaCentral
search didn't find it even though it clearly exists on SuttaCentral
(`snp1.8`). This is a real instance of the ceiling, not a hypothetical one.

## Options (not decided — needs its own pass)

1. **Grow `THAI_TO_UIDS`/keyword coverage by hand.** Zero new infra, but only
   scales linearly with maintainer effort; the metta gap above shows even
   common topics get missed.
2. **Embedding index over sutta titles/blurbs.** Would catch paraphrases and
   synonyms the keyword map can't, but needs a vector store — conflicts with
   the project's free-tier/no-new-services constraint (ponytail agreement)
   unless done with something already free-tier-compatible (e.g. a local
   embedding + brute-force cosine search over a few thousand sutta titles,
   no external vector DB).
3. **Tune SuttaCentral's own search harder.** `/api/search/instant` is
   English-only and keyword/AND-based (see `[[suttacentral-api-facts]]`
   memory) — worth checking if it has query params for fuzzier matching
   before building anything new.

## Recommendation

Don't build speculatively here — this needs a held-out test set (the
9-case matrix approach from the `e710f15` fix, expanded) to compare options
before picking one. Option 3 is worth a cheap first look since it needs no
new code, just API exploration.
