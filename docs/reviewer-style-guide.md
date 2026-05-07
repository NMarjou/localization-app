# PayAnalytics — Reviewer Style Guide

For language reviewers proofreading AI translations in Lokalise.

---

## 1. About PayAnalytics

PayAnalytics is a B2B SaaS platform used by HR teams, compensation
managers, and DEI leaders to **analyse pay equity** and support **pay
transparency** compliance. The application produces statistical analyses
(regression-based pay gap analysis, equal-pay-for-equal-value
comparisons, workforce analytics) and reporting outputs aligned with
local regulations (e.g. the EU Pay Transparency Directive, Iceland's
Equal Pay Standard, US state salary-range disclosure laws).

Users are professionals, not consumers. They expect precise, formal
language that reflects an analytical and legally-aware tool.

> Note for reviewers: for information about the latest product
> messaging and updates, refer to payanalytics.com.

---

## 2. Business context every reviewer should know

### Pay equity

The principle that employees should receive **equal pay for equal work,
or work of equal value**, regardless of gender, race, ethnicity, age,
or other protected characteristics. Analyses typically look at
compensation data with statistical controls (tenure, role level,
performance, location, etc.) to separate the **unadjusted pay gap**
(raw average difference) from the **adjusted pay gap** (the portion
that remains after explaining away legitimate compensable factors).

### Pay transparency

A practice — and increasingly a legal obligation — where employers
disclose pay ranges, gender pay-gap data, or actual pay levels.
Drivers include the **EU Pay Transparency Directive (Directive (EU)
2023/970)**, the **Icelandic Equal Pay Standard (ÍST 85)**, and US
state laws (e.g. California, Colorado, New York, Washington). PayAnalytics
helps customers comply with reporting obligations and communicate
findings internally and externally.

### Common terms reviewers will see

| English | What it means |
|---|---|
| Pay gap (adjusted / unadjusted) | Difference in average pay between groups, before/after statistical controls |
| Equal pay for work of equal value | Comparing different jobs deemed of equivalent value (job evaluation) |
| Compensation band / pay band / salary band | A defined min–max pay range for a role or grade |
| Job evaluation | Methodology to score jobs by responsibility, skill, effort, conditions |
| Comparator group / reference group | Population used as the baseline in a comparison |
| Regression analysis | Statistical model isolating the effect of one variable while controlling for others |
| Statistical significance / p-value | Probability the observed difference is due to chance |
| Workforce analytics | Broader people-data analysis (representation, attrition, hiring) |
| Total compensation | Base salary + variable pay + benefits |

These are **terms of art**. Translate them with the legally/technically
recognised equivalent in the target language — not a colloquial
paraphrase.

---

## 3. Voice & register

- **Audience**: HR analysts, compensation managers, DEI leads. Professional, comfortable with statistics and labour law.
- **Voice**: professional yet approachable. Clear, concise, confident but humble.
- **Register**: formal throughout. Always use the formal second-person form (`vous` / `Sie` / `usted` / `Lei` / `u` / `siz` / `Anda` / `você` / `Pan/Pani` etc. depending on language). **Never** the casual form.
- **Tone**: factual and precise. The product reports on legally sensitive data — avoid hedging language that could read as evasive.
- **Sentence length**: short. Aim for ≤15 words where possible.
- **Active voice** preferred over passive, where target-language norms allow.
- **Gender-neutral phrasing** where the source supports it (e.g. avoid defaulting to masculine when a neutral form exists in the target language).

### Don't

- Use regional colloquialisms.
- Use exclamation marks except where the source uses one and tone genuinely warrants it.
- Use all-caps for emphasis (acronyms excepted).
- Use contractions in formal-register languages.
- Translate brand or product names. Keep "PayAnalytics" verbatim.
- Translate ICU placeholders, HTML tags, or variables (`{name}`, `{{count}}`, `%s`, `<strong>`, `<em>`). Re-order them only as the target grammar requires.
- Translate technical identifiers (column names, file paths, code snippets) unless the source itself provides a localised label.

---

## 4. Terminology & consistency

- **Brand & product names** stay verbatim: `PayAnalytics`, feature names, module names.
- **Technical/statistical terms** translate to the target-language **term of art**, not a paraphrase. Examples:
  - "regression analysis" → French: *analyse de régression*; German: *Regressionsanalyse*; Spanish: *análisis de regresión*.
  - "pay gap" → French: *écart salarial*; German: *Lohnlücke / Entgeltlücke*; Spanish: *brecha salarial*.
  - "compensation band" → French: *fourchette de rémunération*; German: *Vergütungsband*; Spanish: *banda salarial*.
- **Abbreviations** (HRBP, DEI, FTE, etc.) — keep the English abbreviation if the target audience uses it that way; translate only when there's a well-established local equivalent.
- **Glossary** in Lokalise is authoritative. If the source matches a glossary entry, use the glossary translation. If you disagree, flag it for the project owner — don't unilaterally diverge.
- **Translation memory (TM)** entries are prior approved translations. Match TM exactly when a source string is repeated, even across screens.

---

## 5. Formatting & technical content

- **ICU placeholders**: `{name}`, `{firstName}`, `{count, plural, ...}` — keep names exactly. Position can move to fit grammar.
- **HTML tags**: `<strong>`, `<em>`, `<a href="...">`. Keep tags and attributes intact. Move the wrapped text as needed.
- **Variables**: `%s`, `%d`, `{{var}}`, `${var}` — never translate or modify.
- **Character limits**: if a `max_char_limit` is shown in Lokalise, stay within it. If you can't, flag for review rather than truncate awkwardly.
- **Numbers / dates / currencies**: use the target locale's conventions (separators, ordering). Don't convert currency values themselves.
- **Punctuation**: follow target-language rules (French non-breaking spaces, Spanish inverted marks, Japanese full-width).
- **Capitalisation**: follow target-language rules, not English title-case habits. Most languages use sentence case for headings.

---

## 6. What to fix vs. flag

**Fix and approve** when the AI translation has:

- Minor wording adjustments for naturalness
- Locale-correct punctuation/spacing
- Terminology aligned with the glossary
- Improved formal register
- Better grammatical agreement (gender, case, number)

**Flag and discuss** when:

- The source string is **ambiguous** and you need product context to choose between meanings.
- The glossary or TM has a translation you disagree with — flag for the project owner, don't override it silently.
- The source is **technically incorrect** (typo or factual error in the English itself).
- A term has **legal/regulatory weight** in the target market and you're unsure whether the chosen translation matches the local statute (e.g. specific labour-law wording).
- A character-limit overflow can't be resolved without losing meaning.

**Don't approve** translations that:

- Use the casual/informal second-person form anywhere.
- Translate placeholders, tags, or product names.
- Drop or invent meaning relative to the source.
- Use machine-tone phrasing (e.g. literal calques from English).

---

## Questions or escalations

Questions regarding the business context and the product itself are welcome and can be sent directly to the project owner through Argos.
