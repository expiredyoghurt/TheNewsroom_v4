// The Newsroom — "Breaking News" import prompt
//
// Shown verbatim in the teacher front-end's "Breaking News" tab (behind a
// "Copy Prompt" button). The teacher pastes this into ChatGPT, Gemini, Claude,
// or any other AI chat tool ALONGSIDE a photo of the newspaper page, gets
// back one JSON block, and pastes that JSON into the app (or converts it to
// SQL for direct Cloudflare D1 console use — see the SQL section below).
//
// No AI API key or model binding lives inside this Worker for ingestion —
// the heavy lifting (OCR + question authoring) happens in whatever AI tool
// the teacher already has access to.

// Teacher-facing prompt: run it in any AI tool with a photo of the page, paste the JSON into the app.
// Its JSON shape is validated by ImportBundle in @newsroom/shared (a test keeps the two in sync).
export const MASTER_IMPORT_PROMPT = `You are helping a Singapore primary school teacher turn one newspaper article into a reading-comprehension activity for P4–P6 pupils (ages 10–12). I will attach a photo of the newspaper page. Follow every step below in order and do not skip any.

STEP 1 — FIND THE DATE
Look for the article's publish date, usually printed in the newspaper's masthead or header (e.g. "TUESDAY, JULY 21, 2026"). If you cannot find a clear date on the page, STOP and ask me for the date before doing anything else. Do not guess or invent a date.

STEP 2 — TRANSCRIBE, IN YOUR OWN WORDS
Read the article in the photo and write a clear, paraphrased retelling of it — 4 to 7 short paragraphs, plain language suitable for a 10-12 year old reader. Do NOT copy the newspaper's original sentences word-for-word; rewrite the content in your own words while keeping every fact, name, number and quote's meaning accurate. This matters for copyright reasons — a close paraphrase that keeps the original sentence structure is not acceptable, it needs to be a genuine rewrite.

STEP 3 — SPLIT INTO CHUNKS
Split your paraphrased text from Step 2 into individual sentences, in reading order. Give each sentence a chunk_id: "c1", "c2", "c3", and so on. Every sentence in your Step 2 text must appear as exactly one chunk — don't skip any, don't merge two sentences into one chunk.

STEP 4 — WRITE 4 COMPREHENSION QUESTIONS
Write exactly 4 multiple-choice comprehension questions based on facts stated in the text. For each question:
- Write 4 answer options: 1 correct, 3 plausible-but-wrong.
- Note which chunk_id (from Step 3) contains the evidence for the correct answer — the answer must be directly findable in that one sentence.
- Note the correct option's position as correct_index (0 = first option, 1 = second, and so on).
Spread the 4 questions across different parts of the article — don't cluster them all in the first paragraph.

STEP 5 — WRITE 1 VOCABULARY QUESTION
Pick ONE word or short phrase from the article that a P5/6 pupil might not know, but that's worth learning (avoid overly obscure or overly easy words). Write:
- target_word: the word/phrase as it appears in the article
- word_class: its part of speech (noun, verb, adjective, adverb, or "noun phrase" etc.)
- context_sentence: the sentence it appears in
- Exactly 4 answer options, each tagged with a role:
  - "correct_synonym" — a word/phrase that means the same thing AND correctly fits grammatically in the context sentence
  - "distant_synonym" — a word/phrase that's related in meaning but is too vague, too strong, or wrong register to naturally fit this specific sentence
  - "antonym" — a word/phrase that means roughly the opposite
  - "lookalike" — a word/phrase that looks or sounds similar to the target word (similar spelling or word root) but means something completely different — this should NOT be an obvious answer, it should be genuinely easy to confuse at a glance
- All 4 options must be the same word_class as the target word, so a pupil can't eliminate any option on grammar alone.
- Note correct_index — which position (0-3) is the correct_synonym.

STEP 6 — BUILD THE THINK & RESPOND ANSWER KEY
Write one open-ended opinion or reflection question connected to the article — something with no single right answer, that asks the pupil what they think and why (not just "summarise the article").

Then write EXACTLY 3 different model answers to it, each 2-4 sentences. They must take genuinely different angles or positions. They are examples of possible perspectives, NOT correct answers, and must never be treated as the only acceptable responses.

Also create an evidence_map for the question. The evidence map is part of the answer key and is REQUIRED. Include 3-8 relevant article chunks. For each entry provide:
- chunk_id: an exact chunk_id from Step 3
- idea: a concise description of the idea in that sentence that could reasonably support, challenge, qualify, or inform an opinion
- keywords: 2-6 important words/short phrases from that chunk that an AI grader can use as evidence hints
Do not invent evidence. A pupil may still receive strong marks for sensible independent reasoning that is not in the evidence map.

Also create a marking specification. The total is 10 marks:
- opinion: 0-2 — clearly states a position or view
- reasoning: 0-3 — gives a logical reason and explains why
- article_connection: 0-2 — accurately connects the response to relevant article information when appropriate
- elaboration: 0-2 — develops an idea using an explanation, example, consequence, comparison, qualification or second thought
- clarity: 0-1 — response is understandable and sufficiently complete

Define acceptable_positions as a list of reasonable positions or angles supported by the article. Include "other_reasonable_position" when the question permits independent viewpoints. Add 2-5 common_weak_responses that describe likely weak answer patterns, such as opinion-only, unsupported assertion, repetition, or vague reasoning. Never define one of the model answers as the required answer.

STEP 7 — BUILD THE SCAFFOLDED ARTICLE-WRITING TASK
Create a writing assignment that transforms the pupil from reader into reporter. It must use only information supported by the paraphrased article. Include:
- task_type: usually "news_report"; choose another suitable newspaper form only when clearly appropriate.
- title, brief (purpose, audience, recommended_word_count), writing_prompt.
- scaffold.planning_questions: 3-5 questions that help plan the article.
- scaffold.paragraph_plan: 3-5 paragraph functions, not full paragraphs.
- scaffold.sentence_starters: 4-6 useful but non-leading starters.
- scaffold.vocabulary_bank: 4-8 useful words from the article or task.
- source_evidence_map: 3-8 relevant chunk_ids with ideas and keywords.
- marking: a 20-mark specification with content 0-5, organisation 0-4, development 0-3, language 0-4, accuracy 0-2, conventions 0-2.
- model_article: a genuinely original, age-appropriate model article based only on the source, useful for teacher review. It must not be copied from the newspaper.
- The writing task must coach rather than ghost-write: scaffolds should support pupils without supplying their finished article.

STEP 8 — OUTPUT
Output ONLY a single JSON object (no other commentary, no markdown code fences, no explanation before or after) in EXACTLY this shape:

{
  "title": "the article's headline",
  "sourceName": "the newspaper's name, e.g. The Straits Times",
  "section": "the section/page label if shown, e.g. Newsroom, Deep Dive, Spotlight — otherwise leave as an empty string",
  "publishDate": "YYYY-MM-DD",
  "fullText": "your full paraphrased text from Step 2, as one string with paragraphs separated by a single newline character",
  "textChunks": [
    { "chunk_id": "c1", "text": "first sentence" },
    { "chunk_id": "c2", "text": "second sentence" }
  ],
  "comprehension": {
    "questions": [
      {
        "id": "q1",
        "question": "...",
        "evidence_chunk_id": "c4",
        "options": ["option A", "option B", "option C", "option D"],
        "correct_index": 0
      }
    ]
  },
  "vocabulary": {
    "questions": [
      {
        "id": "v1",
        "target_word": "...",
        "word_class": "noun",
        "context_sentence": "...",
        "options": [
          { "text": "...", "role": "correct_synonym" },
          { "text": "...", "role": "distant_synonym" },
          { "text": "...", "role": "antonym" },
          { "text": "...", "role": "lookalike" }
        ],
        "correct_index": 0
      }
    ]
  },
  "reflect": {
    "prompt": "...",
    "model_answers": ["...", "...", "..."],
    "evidence_map": [
      { "chunk_id": "c4", "idea": "...", "keywords": ["...", "..."] }
    ],
    "marking": {
      "max_score": 10,
      "criteria": {
        "opinion": "Clearly states a position or view.",
        "reasoning": "Gives a logical reason and explains why.",
        "article_connection": "Accurately connects the response to relevant article information when appropriate.",
        "elaboration": "Develops an idea with an explanation, example, consequence, comparison, qualification or second thought.",
        "clarity": "The response is understandable and sufficiently complete."
      },
      "acceptable_positions": ["...", "other_reasonable_position"],
      "common_weak_responses": ["Opinion only", "Vague reason"]
    }
  }
  ,"writing": {
    "enabled": true,
    "task_type": "news_report",
    "title": "Junior Reporter Assignment",
    "brief": { "purpose": "inform", "audience": "school newspaper readers", "recommended_word_count": { "min": 180, "max": 300 } },
    "writing_prompt": "...",
    "scaffold": { "planning_questions": ["..."], "paragraph_plan": ["..."], "sentence_starters": ["..."], "vocabulary_bank": ["..."] },
    "source_evidence_map": [ { "chunk_id": "c4", "idea": "...", "keywords": ["..."] } ],
    "marking": { "max_score": 20, "criteria": { "content": "...", "organisation": "...", "development": "...", "language": "...", "accuracy": "...", "conventions": "..." } },
    "model_article": "..."
  }
}

Rules for the JSON: comprehension.questions must contain exactly 4 items. vocabulary.questions must contain exactly 1 item. reflect.model_answers must contain exactly 3 items. reflect.evidence_map is REQUIRED and must contain 3-8 entries. Every reflect.evidence_map[].chunk_id and comprehension evidence_chunk_id must exactly match a chunk_id you created in Step 3. reflect.marking is REQUIRED and must contain all five criteria above and at least one acceptable position. writing is REQUIRED for the new Newsroom build and must include its scaffold, source_evidence_map, 20-mark marking specification, and model_article. It does not matter which position you place the correct answer in — put it wherever feels natural — just make sure correct_index accurately points to it. Use plain double-quoted JSON strings; escape any quotation marks inside your text.
`;
