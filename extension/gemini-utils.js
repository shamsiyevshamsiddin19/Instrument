/* Pure helpers for Gemini's structured quick-translation response. */

export function targetsFor(source) {
    return source === 'UZ' ? ['RU', 'EN'] :
        source === 'EN' ? ['UZ', 'RU'] : ['UZ', 'EN'];
}

export function buildTranslationPrompt(text, requestedSource = 'auto') {
    const hint = requestedSource === 'auto' ?
        'Detect the source language yourself.' :
        `Treat the source language as ${requestedSource.toUpperCase()}.`;
    return `Translate the selected text faithfully. ${hint}\n` +
        'Supported source languages are Uzbek (UZ), Russian (RU), and English (EN). ' +
        'If UZ, return RU and EN. If EN, return UZ and RU. If RU, return UZ and EN. ' +
        'Keep names, numbers, punctuation, and line breaks when meaningful. ' +
        'Return only the JSON object required by the response schema.\n\n' +
        `Selected text:\n${text}`;
}

export function parseGeminiTranslation(candidateText, requestedSource = 'auto') {
    if (typeof candidateText !== 'string' || !candidateText.trim())
        throw new Error('Gemini bo‘sh javob qaytardi.');

    let payload;
    try {
        payload = JSON.parse(candidateText);
    } catch (_error) {
        throw new Error('Gemini JSON javobi noto‘g‘ri.');
    }

    let source = typeof payload.src === 'string' ? payload.src.trim().toUpperCase() : '';
    if (requestedSource !== 'auto') source = requestedSource.toUpperCase();
    if (!['UZ', 'RU', 'EN'].includes(source))
        throw new Error('Gemini manba tilini aniqlay olmadi.');

    if (!Array.isArray(payload.items))
        throw new Error('Gemini tarjimalari topilmadi.');

    const wanted = targetsFor(source);
    const byTag = new Map();
    for (const item of payload.items) {
        const tag = typeof item?.tag === 'string' ? item.tag.trim().toUpperCase() : '';
        const value = typeof item?.text === 'string' ? item.text.trim() : '';
        if (wanted.includes(tag) && value && !byTag.has(tag)) byTag.set(tag, value);
    }

    if (!wanted.every(tag => byTag.has(tag)))
        throw new Error('Gemini to‘liq ikki tarjima qaytarmadi.');

    return {
        src: source,
        items: wanted.map(tag => ({tag, text: byTag.get(tag), error: null})),
    };
}
