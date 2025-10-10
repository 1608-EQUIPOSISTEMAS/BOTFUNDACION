/**
 * Detecta si un mensaje coincide con las keywords de una campaña
 * @param {string} messageText - Texto del mensaje recibido
 * @param {object} triggerKeywords - JSON con keywords, synonyms, exact_matches, excluded_words
 * @returns {object|null} - {matched: string, type: string} o null
 */
function matchKeywords(messageText, triggerKeywords) {
    if (!messageText || !triggerKeywords) {
        return null;
    }

    const textLower = messageText.toLowerCase().trim();
    const { exact_matches, keywords, synonyms, excluded_words } = triggerKeywords;
    
    // 1. PASO CRÍTICO: Verificar excluded_words primero
    if (excluded_words && Array.isArray(excluded_words)) {
        for (const word of excluded_words) {
            if (textLower.includes(word.toLowerCase())) {
                return null; // Excluir esta campaña
            }
        }
    }
    
    // 2. Verificar exact_matches (mayor prioridad)
    if (exact_matches && Array.isArray(exact_matches)) {
        for (const phrase of exact_matches) {
            if (textLower.includes(phrase.toLowerCase())) {
                return { 
                    matched: phrase, 
                    type: 'EXACT' 
                };
            }
        }
    }
    
    // 3. Tokenizar el mensaje para búsqueda de keywords individuales
    const tokens = textLower.split(/\s+/).filter(t => t.length > 0);
    
    // 4. Verificar keywords
    if (keywords && Array.isArray(keywords)) {
        for (const keyword of keywords) {
            const keywordLower = keyword.toLowerCase();
            // Buscar keyword completa o dentro de tokens
            if (tokens.includes(keywordLower) || textLower.includes(keywordLower)) {
                return { 
                    matched: keyword, 
                    type: 'KEYWORD' 
                };
            }
        }
    }
    
    // 5. Verificar synonyms (menor prioridad)
    if (synonyms && typeof synonyms === 'object') {
        for (const [mainWord, synonymList] of Object.entries(synonyms)) {
            if (Array.isArray(synonymList)) {
                for (const synonym of synonymList) {
                    const synonymLower = synonym.toLowerCase();
                    if (tokens.includes(synonymLower) || textLower.includes(synonymLower)) {
                        return { 
                            matched: mainWord, // Retornar la palabra principal
                            type: 'SYNONYM' 
                        };
                    }
                }
            }
        }
    }
    
    return null; // No hay match
}

module.exports = { matchKeywords };