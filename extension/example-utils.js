// Lug'atdagi misollarni qisqa va xavfsiz oddiy matnga aylantirish.
export function chooseExample(data) {
    const candidates = [
        ...(data?.definitions || []).flatMap(group => (group.entry || []).map(entry => entry.example)),
        ...(data?.examples?.example || []).map(entry => entry.text),
    ];
    return candidates.filter(value => typeof value === 'string').map(value => value
        .replace(/<[^>]*>/g, '')
        .replace(/&(?:quot|apos|amp|lt|gt);/g, entity => ({'&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>'})[entity])
        .replace(/\s+/g, ' ').trim())
        .find(value => value.length >= 8 && value.length <= 220 && value.split(/\s+/).length >= 3) || '';
}

export function englishLookup(text) {
    // Faqat qisqa lug'aviy iborada yordamchi fe'l/artiklni chiqaramiz.
    const value = text.trim();
    if (value.split(/\s+/).length > 4) return value;
    return value.replace(/^(?:was|were|is|are|be|a|an|the)\s+/i, '');
}
